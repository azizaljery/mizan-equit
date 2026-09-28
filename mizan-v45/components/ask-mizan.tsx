'use client';
import {asksAboutGold} from '@/lib/gold-core';
import {QuietNote} from './quiet-note';
import {SectionHeading} from './managed-sections';
import {useEffect,useRef,useState} from 'react';
import {DEFAULT_SETTINGS} from '@/lib/site-settings';
import type {Company} from '@/lib/market-data';
import {useMizanSettings} from './settings-context';
import {Explain} from './explain';
import {Forecasts} from './forecasts';
import {fmt} from '@/lib/analysis';
type Scan={question:string;offset:number;failed:number;eligible:number;best:any[];errors:{symbol:string;reason:string}[];total:number;complete:boolean;compare:boolean};
export function AskMizan({onAnalyze}:{onAnalyze:(c:Company)=>unknown}){
 const settings=useMizanSettings();
 const [description,setDescription]=useState(DEFAULT_SETTINGS.description),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[criteria,setCriteria]=useState(''),[understood,setUnderstood]=useState(''),[scan,setScan]=useState<Scan|null>(null);
 const controller=useRef<AbortController|null>(null),scanRef=useRef<Scan|null>(null);
 useEffect(()=>{let active=true;async function load(){try{const r=await fetch('/api/site-settings');if(r.ok){const d=await r.json();if(active)setDescription(d.description);}}catch{}}void load();window.addEventListener('mizan-settings-updated',load);return()=>{active=false;controller.current?.abort();controller.current=null;window.removeEventListener('mizan-settings-updated',load)}},[]);
 async function run(resume=false){
  if(asksAboutGold(question)){window.location.assign('/gold');return;}
  controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(true);setStatus('بدء البحث والتحقق من المصادر…');
  let s:Scan=resume&&scanRef.current?{...scanRef.current,best:[...scanRef.current.best],errors:[...scanRef.current.errors]}:{question,offset:0,failed:0,eligible:0,best:[],errors:[],total:0,complete:false,compare:false};
  if(!resume){setScan(null);scanRef.current=null;setCriteria('');setUnderstood('');}
  let consecutiveFailures=0;
  try{do{
   const timeout=setTimeout(()=>c.abort(),65000);
   let d:any;try{const res=await fetch('/api/ask-mizan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:s.question,offset:s.offset}),signal:c.signal});d=await res.json();if(!res.ok)throw Error(d.error);}finally{clearTimeout(timeout)}
   if(c.signal.aborted||controller.current!==c)return;
   setCriteria(d.criteria);setUnderstood(d.understood);s.total=d.total;s.compare=d.compare;
   for(const r of d.rows){if(r.score===null){s.failed++;s.errors.push({symbol:r.company.symbol,reason:r.error||r.exclusions.join(' ')||'بيانات غير كافية.'});}else s.eligible++;if(r.facts&&(d.compare||r.score!==null))s.best.push(r);}
   s.errors=s.errors.slice(-50);s.best.sort((a,b)=>(b.score??-1)-(a.score??-1)||a.company.symbol.localeCompare(b.company.symbol));s.best=s.best.slice(0,d.compare?8:d.limit);
   s.offset+=d.rows.length;s.complete=d.next===null;scanRef.current={...s};setScan({...s});
   setStatus(s.complete?'اكتمل المسح ضمن الدليل المتاح.':'نتائج جزئية؛ المسح مستمر حتى نهاية الدليل.');
   consecutiveFailures=d.rows.every((r:any)=>r.error)?consecutiveFailures+d.rows.length:0;
   if(consecutiveFailures>=6){setStatus('توقف المسح مؤقتًا بعد تعذر المصادر لست أوراق متتالية. النتائج جزئية؛ يمكنك الاستكمال.');break;}
   if(s.complete)break;s.offset=d.next;
  }while(!c.signal.aborted);
  }catch(e){if(controller.current===c)setStatus(c.signal.aborted?'توقف الطلب أو انتهت مهلة المصدر؛ تستطيع استكمال المسح من آخر دفعة ناجحة.':e instanceof Error?e.message:'تعذر المسح.');}
  finally{if(controller.current===c)setBusy(false);}
 }
 return <section className="panel ask-panel"><SectionHeading as="h2">اسأل ميزان</SectionHeading><QuietNote label="كيف يعمل اسأل ميزان؟"><p>{description}</p></QuietNote>{!settings.askEnabled&&<p className="warning-box">اسأل ميزان متوقف من الإدارة.</p>}{settings.questions.length>0&&<div className="ask-actions">{settings.questions.map(q=><button className="link-btn" key={q} onClick={()=>setQuestion(q)}>{q}</button>)}</div>}<form className="ask-form" onSubmit={e=>{e.preventDefault();void run()}}><label htmlFor="mizan-question">اكتب سؤالك أو طلب المقارنة</label><textarea id="mizan-question" className="ask-question" aria-label="سؤالك لميزان" dir="rtl" value={question} maxLength={500} required onChange={e=>setQuestion(e.target.value)}/><div className="ask-actions"><button className="secondary-btn" disabled={busy||!settings.askEnabled}>ابحث وحلّل</button>{busy?<button type="button" className="link-btn" onClick={()=>controller.current?.abort()}>إيقاف المسح</button>:scan&&!scan.complete&&scan.question===question&&<button className="secondary-btn" type="button" onClick={()=>void run(true)}>استكمال المسح</button>}</div></form>
 <p role="status" aria-live="polite">{status}</p><p>{understood}</p>{scan&&<><progress className="scan-progress" value={scan.offset} max={scan.total||1}/><p className="scan-meta">فُحصت {scan.offset} من {scan.total} ورقة · مؤهلة حسابيًا {scan.eligible} · مستبعدة أو ناقصة {scan.failed}.</p></>}
 <details><summary>معايير الترتيب وحدود التغطية</summary><p>{criteria}</p><p>تُرتب الأوراق التي تجتاز كفاية البيانات والمرشحات فقط. لا تكون «الأفضل في السوق» قبل اكتمال المسح، وتُظهر النتائج الجزئية نطاق الفحص. قد يتضمن الدليل أوراقًا قديمة، ولا يشمل OTC الأمريكي. الأخبار المعروضة ليست تقويمًا كاملًا؛ لا يصنف النظام التوافق الشرعي دون مصدر حديث.</p></details>
 {scan?.complete&&!scan.best.length&&<p className="warning-box">لم توجد نتائج تستوفي التحقق والمرشحات في هذا المسح. راجع أسباب الاستبعاد؛ لا يعني ذلك عدم وجود شركات في السوق.</p>}
 {scan?.best.map((r,i)=><details className="scan-row" key={r.company.symbol}><summary>{i+1}. {r.company.name} · <b dir="ltr">{r.company.symbol}</b> · درجة المقارنة {r.score===null?'محجوبة':r.score+'/100'}</summary>
 <p>{r.company.exchange} · {r.facts.sector||'القطاع غير متحقق'} · السعر {fmt(r.facts.price)} {r.facts.currency} · وقت السعر {r.facts.quoteTime||'غير متاح'} · جلب البيانات {r.facts.retrievedAt}.</p><p>الغرض: {r.horizon==='short'?'مضاربة قصيرة':r.horizon==='long'?'استثمار طويل':'استثمار متوسط'}. ترتيب {i+1} بين الأسهم المؤهلة التي اكتمل فحصها؛ الدرجة تجمع الأوزان والأدلة أدناه، وليست توصية تنفيذ.</p><p>المخاطر: {r.risk} · تغطية العوامل {r.coverage}%.</p>
 <div className="metric-grid">{[['P/E',r.facts.pe],['P/B',r.facts.pb],['EV/EBITDA',r.facts.evEbitda],['ROE %',r.facts.roe],['نمو الإيرادات %',r.facts.revenueGrowth],['نمو التدفق %',r.facts.cfoGrowth],['CFO / صافي الربح',r.facts.cashConversion],['صافي الدين/EBITDA',r.facts.netDebtEbitda],['تغطية التمويل',r.facts.interestCoverage],['RSI',r.facts.rsi],['المتوسط 200',r.facts.sma200],['الدعم',r.facts.support],['المقاومة',r.facts.resistance],['الحجم النسبي',r.facts.relativeVolume],['متوسط قيمة التداول',r.facts.turnover],['التذبذب السنوي %',r.facts.volatility]].filter(([name])=>!settings.hiddenMetrics.includes(String(name))).map(([name,value])=><div key={String(name)}><small><Explain term={String(name)}/></small><p>{fmt(value as number|null)}</p></div>)}</div>
 <p>الفترة المالية: {r.facts.annual||'غير متاحة'} · آخر ربع: {r.facts.quarter||'غير متاح'}. قيمة التداول تقريبية من الإغلاق × الحجم.</p>
 <h4>سبب الترتيب ونقاط القوة</h4><ul>{r.factors.filter((f:any)=>f.signal!==null).sort((a:any,b:any)=>b.weight-a.weight).slice(0,5).map((f:any)=><li key={f.key}>{f.name} ({f.weight}%): {f.detail}</li>)}{r.strengths.map((x:string)=><li key={x}>{x}</li>)}</ul>
 <h4>المخاطر ونواقص التحقق</h4><ul>{[...r.exclusions,...r.risks,...r.missing].map((x:string,i:number)=><li key={i}>{x}</li>)}</ul>
 <Forecasts data={r.forecast}/><h4>أحدث الأخبار والإفصاحات المتاحة</h4>{r.news.length?r.news.map((n:any)=><p key={n.url}><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> · {n.date}</p>):<p>لم يتوفر خبر موثوق من المصدر.</p>}
 <details><summary>المصادر وحالة التحقق</summary>{r.sources.map((x:any)=><p key={x.name}><a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> · {x.detail}</p>)}</details>
 <button className="secondary-btn" onClick={()=>void onAnalyze(r.company)}>فتح تحليل الشركة والشارت ميزان الخاص</button><QuietNote><p>قرار الشراء والبيع يبقى داخل ميزان الخاص بعد اختيار الشركة.</p></QuietNote></details>)}
 {!!scan?.errors.length&&<details><summary>أسباب الاستبعاد وتعذر البيانات — آخر {scan.errors.length} ورقة</summary><ul className="scan-failed">{scan.errors.map((x,i)=><li key={i}><b dir="ltr">{x.symbol}</b>: {x.reason}</li>)}</ul></details>}
 </section>;
}
