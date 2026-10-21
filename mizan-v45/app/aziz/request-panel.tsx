'use client';
import {useState} from 'react';
import type {Company} from '@/lib/market-data';

import type {ReadinessResponse as Result} from '@/lib/aziz/readiness';
const STATUS:Record<string,string>={ready:'جاهز للإصدار البحثي',partial:'جاهز جزئيًا',collecting:'يجمع البيانات',insufficient_data:'بيانات غير كافية',model_missing:'لا يوجد نموذج مدرّب',model_rejected:'النموذج المسجل مرفوض',suspended:'معلّق',error:'خطأ في قراءة الأرشيف'};
const DATA:Record<string,string>={eligible:'مؤهلة زمنيًا',exploratory_only:'استكشافية فقط (وقت الإتاحة غير موثق)',insufficient:'غير كافية',not_imported:'غير مؤرشفة',unavailable:'تعذر الفحص'};
const SLOT:Record<string,string>={model_rejected:'مرفوض',model_missing:'غير موجود',suspended:'معلّق',not_approved:'غير معتمد',usable_research:'صالح بحثيًا'};
const yes=(b:boolean)=>b?'نعم':'لا';
async function read(url:string,options?:RequestInit){const r=await fetch(url,options);const b=await r.json();if(!r.ok)throw Error(b.error||'تعذر الطلب.');return b;}

export default function RequestPanel(){
 const [market,setMarket]=useState('sa'),[query,setQuery]=useState(''),[companies,setCompanies]=useState<Company[]>([]),[selected,setSelected]=useState<Company|null>(null),[selection,setSelection]=useState<any>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 function clear(){setCompanies([]);setSelected(null);setSelection(null);setResult(null);setError('');}
 async function choose(random=false){setBusy(random?'اختيار شركة من الدليل…':'البحث عن الشركة…');clear();try{
  if(random){const r=await read('/api/aziz/company?market='+market);setSelected(r.company);setSelection(r.selection);}
  else{const r=await read('/api/company/search?market='+market+'&q='+encodeURIComponent(query));if(r.suggestedMarket)throw Error('الشركة تتبع سوقًا آخر؛ غيّر السوق ثم ابحث.');setCompanies(r.companies);if(!r.companies.length)setError('لا توجد شركة مطابقة في الدليل.');}
 }catch(e){setError(e instanceof Error?e.message:'تعذر الاختيار.');}finally{setBusy('');}}
 async function checkReadiness(){if(!selected)return;setBusy('فحص جاهزية عزيز…');setResult(null);setError('');try{
  const r=await read('/api/aziz/readiness?market='+market+'&symbol='+encodeURIComponent(selected.symbol));
  if(r.company?.symbol!==selected.symbol||r.engine!=='aziz'||r.operation!=='readiness'||r.schemaVersion!==2||typeof r.status!=='string'||!Array.isArray(r.abstentionReasons))throw Error('استجابة جاهزية غير متوقعة.');
  // A research forecast is never shown from a readiness check, and production use is shown only when explicitly approved.
  if(r.recorded!==false||r.forecast!==null)throw Error('استجابة جاهزية غير متوقعة: فحص الجاهزية لا ينشئ توقعًا.');setResult(r);
 }catch(e){setError(e instanceof Error?e.message:'تعذر فحص الجاهزية.');}finally{setBusy('');}}
 return <section className="panel" aria-label="طلب توقع للشركة">
  <h2>اختر شركة وافحص جاهزية عزيز</h2>
  <p>اختر بنفسك أو اسحب شركة عشوائية، ثم افحص الجاهزية. هذا الفحص لا ينشئ توقعًا ولا يحفظ سجل توقعات. الاختيار العشوائي من الدليل المتاح، ولا يدل على تفضيل استثماري.</p>
  <form onSubmit={e=>{e.preventDefault();void choose();}} style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
   <label>السوق<select value={market} disabled={!!busy} onChange={e=>{setMarket(e.target.value);clear();}}><option value="sa">السعودي</option><option value="us">الأمريكي</option></select></label>
   <label>اسم الشركة أو رمزها<input value={query} maxLength={80} disabled={!!busy} onChange={e=>setQuery(e.target.value)}/></label>
   <button type="submit" disabled={!!busy||!query.trim()}>بحث</button>
   <button type="button" disabled={!!busy} onClick={()=>void choose(true)}>اختيار عشوائي</button>
  </form>
  {!!companies.length&&<ul className="bullet-list">{companies.map(c=><li key={c.symbol}><button disabled={!!busy||c.analysisAvailable===false} onClick={()=>{setSelected(c);setSelection({method:'manual'});setResult(null);setError('');}}>{c.name} — {c.symbol}</button></li>)}</ul>}
  {selected&&<div style={{marginTop:20}}><h3>{selected.name} <span dir="ltr">{selected.symbol}</span></h3>
   {selection?.method==='random-directory'&&<p>اختيرت من {selection.poolCount} شركة في الدليل. تبقى الشركة المختارة كما هي إذا تعذر جلب بياناتها.</p>}
   <button disabled={!!busy} onClick={()=>void checkReadiness()}>فحص جاهزية عزيز</button>
  </div>}
  {busy&&<p role="status">{busy}</p>}{error&&<p role="alert">{error}</p>}
  {result&&<div aria-live="polite" style={{marginTop:24}}>
   <h3>الحالة: {STATUS[result.status]??result.status} <small>(الوضع {result.mode})</small></h3>
   <p>{result.productionUseApproved?'معتمد للاستخدام الفعلي.':'غير معتمد للاستخدام الفعلي، ولا يؤثر على توصيات ميزان.'} {result.researchForecastAvailable?'يمكن إصدار توقع بحثي بطلب منفصل.':'لا يمكن إصدار توقع بحثي حاليًا.'}</p>
   <div style={{overflowX:'auto'}}><table dir="rtl"><thead><tr><th>المكوّن</th><th>جاهز</th></tr></thead><tbody>
    <tr><td>البيانات — {DATA[result.dataEligibility]??result.dataEligibility}</td><td>{yes(result.readiness.dataReady)}</td></tr>
    <tr><td>النموذج</td><td>{yes(result.readiness.modelReady)}</td></tr>
    <tr><td>معايرة الاحتمال والنطاق</td><td>{yes(result.readiness.calibrationReady)}</td></tr>
    <tr><td>المراقب</td><td>{yes(result.readiness.monitorReady)}</td></tr>
   </tbody></table></div>
   <div style={{overflowX:'auto',marginTop:12}}><table dir="rtl"><thead><tr><th>الأفق</th><th>نوع الإصدار</th><th>حالة النموذج</th><th>المرجع</th></tr></thead><tbody>
    {result.horizons.map(h=><tr key={h.horizonSessions+h.issueType}><td>{h.horizonSessions} جلسة</td><td>{h.issueType==='direct'?'مباشر':'تحديث 5→21'}</td><td>{SLOT[h.status]??h.status}</td><td dir="ltr">{h.evaluationReportId??'—'}</td></tr>)}
   </tbody></table></div>
   {result.data&&<p>الأرشيف: {result.data.bars} جلسة من <span dir="ltr">{result.data.firstSession}</span> إلى <span dir="ltr">{result.data.lastSession}</span>{result.sourceAsOf&&<> — آخر جلب <span dir="ltr">{result.sourceAsOf.slice(0,16).replace('T',' ')} UTC</span></>}.</p>}
   <h4>أسباب الامتناع</h4>
   <ul>{result.abstentionReasons.map(r=><li key={r.code}>{r.message}</li>)}</ul>
   <p>احتمال الصعود والنطاق غير متاحين لعدم وجود معايرة صالحة — لا يُعرض 0% ولا 50% بديلًا. لم يُنشأ توقع ولم يُحفظ أي سجل؛ هذا فحص قراءة فقط.</p>
  </div>}
 </section>;
}
