'use client';
import {useState} from 'react';
import type {Company} from '@/lib/market-data';

type Row={id?:string;sessions:number;period:string;available:boolean;predictedPrice?:number;range?:number[]|null;direction:string;reasons:string[]};
type Result={company:Company;currency:string;forecast?:{recorded?:boolean;createdAt:string;price:number|null;priceTime:string;rows:Row[]};warnings:string[]};
async function read(url:string,options?:RequestInit){const r=await fetch(url,options);const b=await r.json();if(!r.ok)throw Error(b.error||'تعذر الطلب.');return b;}
const number=(n:number|undefined|null)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ar-SA',{maximumFractionDigits:2}):'غير متاح';

export default function RequestPanel(){
 const [market,setMarket]=useState('sa'),[query,setQuery]=useState(''),[companies,setCompanies]=useState<Company[]>([]),[selected,setSelected]=useState<Company|null>(null),[selection,setSelection]=useState<any>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 function clear(){setCompanies([]);setSelected(null);setSelection(null);setResult(null);setError('');}
 async function choose(random=false){setBusy(random?'اختيار شركة من الدليل…':'البحث عن الشركة…');clear();try{
  if(random){const r=await read('/api/aziz/company?market='+market);setSelected(r.company);setSelection(r.selection);}
  else{const r=await read('/api/company/search?market='+market+'&q='+encodeURIComponent(query));if(r.suggestedMarket)throw Error('الشركة تتبع سوقًا آخر؛ غيّر السوق ثم ابحث.');setCompanies(r.companies);if(!r.companies.length)setError('لا توجد شركة مطابقة في الدليل.');}
 }catch(e){setError(e instanceof Error?e.message:'تعذر الاختيار.');}finally{setBusy('');}}
 async function requestForecast(){if(!selected)return;setBusy('جلب بيانات الشركة وحفظ التوقع المرجعي وفحص جاهزية عزيز…');setResult(null);setError('');try{
  // Reuse the authoritative analysis, source validation and journal endpoint.
  const r=await read('/api/company/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:selected.symbol})});
  if(r.company?.symbol!==selected.symbol)throw Error('هوية البيانات لا تطابق الشركة المختارة.');setResult(r);
 }catch(e){setError(e instanceof Error?e.message:'تعذر طلب التوقع.');}finally{setBusy('');}}
 return <section className="panel" aria-label="طلب توقع للشركة">
  <h2>اختر شركة وابدأ التجربة</h2>
  <p>اختر بنفسك أو اسحب شركة عشوائية، ثم اطلب التوقع. الاختيار العشوائي من الدليل المتاح، ولا يدل على تفضيل استثماري.</p>
  <form onSubmit={e=>{e.preventDefault();void choose();}} style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
   <label>السوق<select value={market} disabled={!!busy} onChange={e=>{setMarket(e.target.value);clear();}}><option value="sa">السعودي</option><option value="us">الأمريكي</option></select></label>
   <label>اسم الشركة أو رمزها<input value={query} maxLength={80} disabled={!!busy} onChange={e=>setQuery(e.target.value)}/></label>
   <button type="submit" disabled={!!busy||!query.trim()}>بحث</button>
   <button type="button" disabled={!!busy} onClick={()=>void choose(true)}>اختيار عشوائي</button>
  </form>
  {!!companies.length&&<ul className="bullet-list">{companies.map(c=><li key={c.symbol}><button disabled={!!busy||c.analysisAvailable===false} onClick={()=>{setSelected(c);setSelection({method:'manual'});setResult(null);setError('');}}>{c.name} — {c.symbol}</button></li>)}</ul>}
  {selected&&<div style={{marginTop:20}}><h3>{selected.name} <span dir="ltr">{selected.symbol}</span></h3>
   {selection?.method==='random-directory'&&<p>اختيرت من {selection.poolCount} شركة في الدليل. تبقى الشركة المختارة كما هي إذا تعذر جلب بياناتها.</p>}
   <button disabled={!!busy} onClick={()=>void requestForecast()}>طلب توقع وفحص جاهزية عزيز</button>
  </div>}
  {busy&&<p role="status">{busy}</p>}{error&&<p role="alert">{error}</p>}
  {result&&<div aria-live="polite" style={{marginTop:24}}>
   <h3>نتيجة طلب عزيز: بانتظار نموذج التصحيح</h3>
   <p>لم يصدر توقع رقمي من عزيز لهذا الطلب. جسر عزيز يصحح توقع ٢١ جلسة بعد رصد أول ٥ جلسات فعلية، ويحتاج نموذجًا مدرّبًا ومؤرخًا. هذه المتطلبات لم تُستكمل في التشغيل الحالي.</p>
   <p>لا توجد معالجة آلية مؤجلة لهذا الطلب حتى الآن؛ الضغط على الزر لا يثبت تشغيل عزيز أو دقته.</p>
   <details open><summary>توقع ميزان المرجعي للشركة — منفصل عن عزيز</summary>
    <p>السعر المرجعي: {number(result.forecast?.price)} {result.currency} · وقت السعر: {result.forecast?.priceTime||'غير متاح'}</p>
    <p>{result.forecast?.recorded?'حُفظ توقع ميزان في سجله الدائم.':'لم يتأكد حفظ توقع ميزان؛ لا يُعد سجلًا قابلًا لتتبع الأداء.'}</p>
    <div style={{overflowX:'auto'}}><table><thead><tr><th>المدة</th><th>الاتجاه</th><th>السعر المتوقع</th><th>النطاق</th></tr></thead><tbody>{result.forecast?.rows.filter(r=>r.sessions===5||r.sessions===21).map(r=><tr key={r.sessions}><td>{r.period}</td><td>{r.direction}</td><td>{r.available?number(r.predictedPrice):'غير متاح'}</td><td>{r.available&&r.range?r.range.map(number).join(' – '):r.reasons.join('، ')}</td></tr>)}</tbody></table></div>
   </details>
   {!!result.warnings?.length&&<details><summary>تنبيهات البيانات والحفظ</summary><ul>{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
  </div>}
 </section>;
}
