'use client';
import {useState} from 'react';
import type {Company} from '@/lib/market-data';

type Result={engine:'aziz';operation:'readiness';company:{symbol:string;name:string};status:'not_ready';canForecast:false;recorded:false;reasons:{code:string;message:string}[]};
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
  if(r.company?.symbol!==selected.symbol||r.engine!=='aziz'||r.operation!=='readiness'||r.canForecast!==false||r.recorded!==false)throw Error('استجابة جاهزية غير متوقعة.');setResult(r);
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
   <h3>عزيز غير جاهز لإصدار توقع رقمي</h3>
   <ul>{result.reasons.map(r=><li key={r.code}>{r.message}</li>)}</ul>
   <p>لم يُنشأ توقع ولم يُحفظ سجل توقعات. هذا فحص جاهزية فقط، ولا يجدول تدريبًا أو إصدارًا مؤجلًا.</p>
  </div>}
 </section>;
}
