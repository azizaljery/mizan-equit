'use client';
import {useEffect,useRef,useState} from 'react';
import {Scale,Globe2} from 'lucide-react';
import {HORIZONS} from '@/lib/forecast-horizons';
import {mergeScreenerResults,type ScreenerResult,type ScreenerMarket} from '@/lib/screener-policy';
import type {ScreenerPlan} from '@/lib/screener';
import {fetchWithRetry,type FetchRetryOptions} from '@/lib/fetch-retry';
const fmt=(v:number|null|undefined,d=2)=>typeof v!=='number'||!Number.isFinite(v)?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(v);
const stamp=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s+' (إغلاق يومي)':s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString('ar-SA'):'غير متاح';
const reasons:Record<string,string>={model_unavailable:'المحرك امتنع عن إصدار التوقع',not_rising:'الاتجاه ليس صاعدًا',low_or_unknown_confidence:'الثقة منخفضة أو غير متحققة',invalid_range:'النطاق غير صالح',invalid_positive_target:'السعر المركزي أو التغير غير صالح',target_outside_range:'السعر المركزي خارج النطاق',inconsistent_target:'التغير لا يطابق السعر المركزي',missing_price_provenance:'وقت السعر أو عملته غير متحقق'};
type Handle={runId:string;runToken:string};
type ArchiveView={runId:string;status:string;createdAt:string;nominatedAt:string|null;fingerprint:string|null;integrity:boolean|null;frozen:{result:ScreenerResult}|null;
 byMarket:{market:string;selected:number;complete:number;pending:number;excluded:number;performance:{independent:number;directionAccuracy:number|null;meanPriceError:number|null;rangeCoverage:number|null}}[];
 picks:{id:string;symbol:string;market:string;rank:number;issuedAt:string;priceTime:string;referencePrice:number;predictedPrice:number;estimatedEndAt:string|null;evaluationState:string;actualChangePct:number|null;outcome:{actualDate?:string;actualPrice?:number;directionCorrect?:boolean;rangeHit?:boolean;reason?:string}|null}[];pendingNote:string};
async function loadJSON(url:string,init?:RequestInit,retry?:FetchRetryOptions){let res:Response;try{res=retry?await fetchWithRetry(url,init,retry):await fetch(url,init);}catch(e){if(retry&&!retry.signal?.aborted)throw Error('تعذر الاتصال بالخادم بعد إعادة المحاولة.');throw e;}const data=await res.json().catch(()=>({error:'تعذر قراءة استجابة الخادم.'}));if(!res.ok)throw Error(data.error||'تعذر الاتصال.');return data;}
export default function ScreenerPage(){
 const [market,setMarket]=useState<ScreenerMarket>('sa'),[horizon,setHorizon]=useState(5),[resultCount,setResultCount]=useState(5),[scanLimit,setScanLimit]=useState(200);
 const [loading,setLoading]=useState(false),[phase,setPhase]=useState(''),[plan,setPlan]=useState<ScreenerPlan|null>(null),[result,setResult]=useState<ScreenerResult|null>(null),[error,setError]=useState<string|null>(null);
 const [archive,setArchive]=useState<ArchiveView|null>(null),[archiveError,setArchiveError]=useState(''),[history,setHistory]=useState<any[]>([]);
 const controller=useRef<AbortController|null>(null),activeArchive=useRef<Handle|null>(null);
 useEffect(()=>{try{const raw=sessionStorage.getItem('mizan-screener-archive');if(raw)activeArchive.current=JSON.parse(raw);}catch{}return()=>controller.current?.abort();},[]);
 async function archivePost(action:string,extra:Record<string,unknown>={}){return loadJSON('/api/screener',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...activeArchive.current,...extra})});}
 async function refreshArchive(){setArchiveError('');try{if(!activeArchive.current)throw Error('ابدأ مسحًا محفوظًا أو افتح سجل المالك.');setArchive(await archivePost('archive-status'));}catch(e){setArchiveError(e instanceof Error?e.message:'تعذرت القراءة.');}}
 async function ownerHistory(id?:string){setArchiveError('');try{const data=await loadJSON('/api/admin/screener-history'+(id?'?id='+encodeURIComponent(id):''));if(id)setArchive(data);else setHistory(data.runs);}catch(e){setArchiveError(e instanceof Error?e.message:'يتطلب سجل المالك جلسة الإدارة الحالية.');}}
 async function run(){
  const control=new AbortController();controller.current=control;
  setLoading(true);setError(null);setResult(null);setPlan(null);setArchive(null);setArchiveError('');setPhase('جارٍ إنشاء خطة مسح وأرشيف دائم');
  const input={market,horizonSessions:horizon,resultCount,scanLimit};
  // archive-batch/complete are replay-safe (batches are stored server-side), so transient 502/503/504 and network errors are retried.
  // `plan` creates a new archive row on every call (not idempotent), so it is never retried automatically.
  const post=(body:{action?:string}&Record<string,unknown>)=>loadJSON('/api/screener',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:control.signal},body.action==='plan'?undefined:{signal:control.signal,onRetry:e=>setPhase(`تعذّر الاتصال مؤقتًا، تُعاد المحاولة (${e.attempt}/${e.maxRetries})…`)});
  let combined:ScreenerResult|null=null,total=0;
  try{
   const p:ScreenerPlan&Handle=await post({...input,action:'plan',archive:true});setPlan(p);total=p.symbols.length;
   activeArchive.current={runId:p.runId,runToken:p.runToken};
   try{sessionStorage.setItem('mizan-screener-archive',JSON.stringify(activeArchive.current));}catch{}
   for(let offset=0;offset<p.symbols.length;offset+=p.batchSize){
    if(control.signal.aborted)break;
    setPhase(`جارٍ الفحص والحفظ: ${offset} من ${p.symbols.length}`);
    // Symbols, model version, ranking and snapshots are authoritative on the server.
    const batch:ScreenerResult=await post({action:'archive-batch',runId:p.runId,runToken:p.runToken,batchIndex:offset/p.batchSize});
    combined=mergeScreenerResults(combined,batch);setResult(combined);
   }
   if(control.signal.aborted){setPhase('أُوقف المسح؛ حُفظ ما نُفذ، لكنه ليس قائمة ترشيح نهائية.');return;}
   const saved:ArchiveView=await post({action:'complete',runId:p.runId,runToken:p.runToken});setArchive(saved);
   if(saved.frozen)setResult(saved.frozen.result);
   setPhase('اكتمل المسح وحُفظ الترشيح الأصلي للمقارنة المستقبلية');
  }catch(e){if(control.signal.aborted)setPhase('أُوقف المسح؛ النتائج جزئية وليست قائمة نهائية.');else{setError(e instanceof Error?e.message:'فشل الفرز أو الحفظ.');const done=combined?.scanned??0;setPhase(done>0&&done>=total?'اكتمل فحص جميع الأسهم لكن تعذر اعتماد الأرشيف؛ النتائج المعروضة غير نهائية.':done>0?`توقف المسح بعد فحص ${done} من ${total} سهمًا؛ بقي ${Math.max(0,total-done)} دون فحص. النتائج المعروضة جزئية وليست قائمة ترشيح نهائية، ولم يُعتمد الأرشيف.`:'لم يكتمل المسح أو الأرشيف؛ لا يُعرض كاختبار مكتمل.');}}
  finally{setLoading(false);controller.current=null;}
 }
 return <>
  <header className="topbar"><a className="brand" href="/" aria-label="ميزان الرئيسية"><span className="brand-icon"><Scale size={28}/></span><span><span className="brand-name">ميزان</span><span className="brand-caption">وضوح يسبق القرار</span></span></a><a className="source-link" href="/">تحليل شركة</a><a className="source-link" href="/accuracy">دقة ميزان</a><span className="top-meta"><Globe2 size={16}/> السعودية · أمريكا</span></header>
  <main className="auto-workspace" dir="rtl">
   <section className="search-hero"><h1>فرز توقعات الأسهم</h1><p>اختر المدة وعدد الشركات المطلوب من 5 إلى 10 لكل سوق. يفحص ميزان عينة حتى 200 سهم، ويثبت الترشيحات المقبولة للمقارنة بعد اكتمال المدة. ليست توصية شراء أو ضمانًا للصعود.</p>
    <div className="company-search">
     <label className="market-select"><span>السوق</span><select aria-label="السوق" disabled={loading} value={market} onChange={e=>setMarket(e.target.value as ScreenerMarket)}><option value="sa">السعودية</option><option value="us">أمريكا</option><option value="both">السعودية وأمريكا معًا</option></select></label>
     <label className="market-select"><span>المدة</span><select aria-label="المدة" disabled={loading} value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{HORIZONS.map(h=><option key={h.sessions} value={h.sessions}>{h.name}</option>)}</select></label>
     <label className="market-select"><span>عدد النتائج المطلوبة لكل سوق</span><select aria-label="عدد النتائج المطلوبة" disabled={loading} value={resultCount} onChange={e=>setResultCount(Number(e.target.value))}>{[5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} شركات لكل سوق</option>)}</select></label>
     <label className="market-select"><span>عدد الأسهم المفحوصة</span><select aria-label="عدد الأسهم المفحوصة" disabled={loading} value={scanLimit} onChange={e=>setScanLimit(Number(e.target.value))}>{[20,40,100,200].map(n=><option key={n} value={n}>{n} سهمًا إجمالًا</option>)}</select></label>
     <button className="search-button" type="button" onClick={()=>void run()} disabled={loading}>{loading?'جارٍ الفرز…':'ابحث عن الشركات المتوقع صعودها'}</button>
     {loading&&<button className="secondary-btn" type="button" onClick={()=>controller.current?.abort()}>إيقاف المسح</button>}
    </div><p className="muted">اختيار السوقين و10 نتائج يعني حتى 10 سعودية و10 أمريكية، لا نكمل نقص أحد السوقين بأسماء من الآخر. اليومي للجلسة التالية؛ لا يُخفض شرط الثقة لإكمال العدد.</p>
   </section>
   {error&&<p role="alert" className="notice error">{error}</p>}
   {phase&&<section className="panel"><p role="status" aria-live="polite">{phase}</p>{plan&&<><progress aria-label="تقدم المسح" max={Math.max(1,plan.symbols.length)} value={result?.scanned||0}/><p>فُحص {result?.scanned||0} من {plan.symbols.length} — النطاق: {plan.selectedCount.sa} سعودي و{plan.selectedCount.us} أمريكي.</p><p className="muted">عينة محددة بترتيب الدليل وليست جميع السوق. إغلاق الصفحة يوقف الدفعات الجديدة، لكنه لا يحذف ما حُفظ في قاعدة البيانات.</p></>}</section>}
   {result&&<>
    <section className="panel"><h2>نتيجة المسح — {result.horizonName}{loading?' (مؤقتة)':''}</h2><div className="metric-grid">{[['فُحص',result.scanned],['حُلّل',result.analyzed],['اجتاز الترشيح',result.eligible],['معروض',result.returned],['مستبعد بالشروط',result.excluded],['تعذر',result.failed]].map(([name,n])=><div className="metric" key={name}><div className="title">{name}</div><div className="value">{n}</div></div>)}</div><p>المطلوب {result.requestedResultCount} لكل سوق؛ المعروض {result.returned} إجمالًا. {result.missingCount>0?'لم تتأهل شركات كافية؛ لا تُستكمل القائمة بتوقعات أضعف.':''}</p><p className="muted">النموذج: {result.modelVersion} · التحديث: {stamp(result.generatedAt)}. النتائج مؤقتة حتى اكتمال المسح.</p></section>
    <section className="panel"><h2>الشركات المتوقع صعودها</h2>{!result.candidates.length?<p>لم يظهر مرشح مستوفٍ للشروط. تُحفظ نتيجة المسح الفارغة أيضًا ولا تعني خلو السوق من فرص.</p>:<div className="wide-table"><table className="auto-table"><thead><tr>{['الترتيب في السوق','الشركة','السعر المرجعي ووقته','المركزي المتوقع','التغير المتوقع','النطاق','الثقة والجودة','الأسباب والمخاطر','التحليل'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{result.candidates.map((c,i)=><tr key={c.symbol}><td>{c.market==='sa'?'سعودي':'أمريكي'} — {result.candidates.slice(0,i+1).filter(v=>v.market===c.market).length}</td><td><b dir="ltr">{c.symbol}</b><small>{c.name}</small><small>{c.exchange}</small></td><td>{fmt(c.price)} {c.currency}<small>{stamp(c.priceTime)}</small></td><td>{fmt(c.predictedPrice)} {c.currency}</td><td>+{fmt(c.expectedChangePct)}%</td><td>{c.range?`${fmt(c.range[0])} – ${fmt(c.range[1])}`:'—'}</td><td>{c.confidence}<small>{c.dataQuality}</small><small>تغطية العوامل: {fmt(c.coverage,0)}%</small></td><td><details><summary>سبب الترشيح وحدوده</summary>{c.basis.map((s,j)=><p key={'b'+j}>{s}</p>)}{c.reasons.map((s,j)=><p key={'r'+j}>{s}</p>)}<p>المخاطر: {c.riskLevel}</p>{c.risks.slice(0,3).map((s,j)=><p key={'k'+j}>{s}</p>)}<p>إبطال الفرضية:</p>{c.invalidation.map((s,j)=><p key={'i'+j}>{s}</p>)}<p>الجلب: {stamp(c.retrievedAt)}</p>{c.forecastIssuedAt&&<p>إصدار التوقع المحفوظ: {stamp(c.forecastIssuedAt)}</p>}{/^https:\/\//.test(c.source)&&<a href={c.source} target="_blank" rel="noopener noreferrer">مصدر السعر</a>}<p>النوافذ التاريخية {c.independent} ليست دقة توقعات مستقبلية مسجلة.</p></details></td><td><a className="source-link" href={`/?symbol=${encodeURIComponent(c.symbol)}`}>حلّل</a></td></tr>)}</tbody></table></div>}<p className="muted">الأولوية للجودة ثم الثقة والتغطية والعينة ثم التغير المتوقع. النطاق ليس احتمالًا معايرًا.</p></section>
    {(result.excluded>0||result.failed>0)&&<details className="auto-details"><summary>أسباب الاستبعاد وتعذر البيانات</summary><div className="detail-body">{Object.entries(result.exclusionCounts).map(([k,n])=><p key={k}>{reasons[k]||k}: {n}</p>)}{result.failures.map(f=><p key={f.symbol}><b dir="ltr">{f.symbol}</b>: {f.reason}</p>)}</div></details>}
   </>}
   <section className="panel"><h2>سجل الترشيحات والاختبار المستقبلي</h2><p>يحفظ Data Center التوقع الأصلي ونسخة النموذج. تقارن مهمة Quant المجدولة النتيجة بعد اكتمال جلسات السوق الفعلية، دون إعادة إنشاء التوقع القديم.</p><button type="button" className="secondary-btn" disabled={loading} onClick={()=>void refreshArchive()}>تحديث نتيجة المسح المحفوظ</button> <button type="button" className="secondary-btn" disabled={loading} onClick={()=>void ownerHistory()}>سجل المالك — يتطلب دخول الإدارة</button>
    {archiveError&&<p role="alert">{archiveError}</p>}
    {history.length>0&&<details open><summary>آخر 30 مسحًا محفوظًا</summary>{history.map(r=><p key={r.runId}><button className="link-btn" onClick={()=>void ownerHistory(r.runId)}>{stamp(r.createdAt)} · {r.market} · {r.horizon} جلسة · {r.status==='complete'?'ترشيح نهائي':'مسح غير مكتمل'}</button></p>)}</details>}
    {archive&&<><p>معرّف السجل: <b dir="ltr">{archive.runId}</b></p><p>الحالة: {archive.status==='complete'?'ترشيح نهائي ثابت':'مسح غير مكتمل؛ لا يدخل كقائمة نهائية'} · سلامة البصمة: {archive.integrity===true?'مطابقة':archive.integrity===false?'غير مطابقة':'لم يُقفل السجل'}</p><p>{archive.pendingNote}</p>
     <div className="wide-table"><table className="auto-table"><thead><tr>{['السوق','مرشح','اكتمل قياسه','بانتظار','مستبعد بسبب البيانات','عينة غير متداخلة','صحة الاتجاه','تغطية النطاق'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{archive.byMarket.map(m=><tr key={m.market}><td>{m.market==='sa'?'السعودي':'الأمريكي'}</td><td>{m.selected}</td><td>{m.complete}</td><td>{m.pending}</td><td>{m.excluded}</td><td>{m.performance.independent}</td><td>{fmt(m.performance.directionAccuracy)}{m.performance.directionAccuracy!==null?'%':''}</td><td>{fmt(m.performance.rangeCoverage)}{m.performance.rangeCoverage!==null?'%':''}</td></tr>)}</tbody></table></div>
     {archive.picks.length>0&&<div className="wide-table"><table className="auto-table"><thead><tr>{['السهم','السعر عند الإصدار','المتوقع','الفعلي عند نهاية المدة','التغير الفعلي','حالة القياس'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{archive.picks.map(p=><tr key={p.id}><td dir="ltr">{p.symbol}</td><td>{fmt(p.referencePrice)}<small>{stamp(p.priceTime)}</small></td><td>{fmt(p.predictedPrice)}</td><td>{fmt(p.outcome?.actualPrice)}<small>{p.outcome?.actualDate||''}</small></td><td>{fmt(p.actualChangePct)}{p.actualChangePct!==null?'%':''}</td><td>{p.evaluationState==='complete'?'مكتمل':p.evaluationState==='excluded'?'مستبعد من النسبة مع إبقاء السجل':'بانتظار المدة أو البيانات'}{p.outcome?.reason&&<small>{p.outcome.reason}</small>}</td></tr>)}</tbody></table></div>}
    </>}
   </section>
  </main>
 </>;
}
