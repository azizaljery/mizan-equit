'use client';
import {useEffect,useState} from 'react';

type ImportResult={batch:number;results:{symbol:string;bars:number}[];errors:{symbol:string;error:string}[];events:string;sahmkConfigured:boolean;error?:string};
type ArchiveStatus={
 scope:'aziz_archive';
 symbols:{id:string;market:'sa'|'us';symbol:string;name:string;bars:number;first_session:string|null;last_session:string|null;last_retrieved_at:string|null;datasets:number;events:number}[];
 totalBars:number;withBars:number;expectedSymbols:number;
 historicalCompleteness:'not_verified';
 latestRun:{status:string;started_at:string;requested_batch:number}|null;
};

export default function ImportPanel(){
 const [busy,setBusy]=useState(0),[result,setResult]=useState<ImportResult|null>(null);
 const [archive,setArchive]=useState<ArchiveStatus|null>(null),[archiveError,setArchiveError]=useState('');
 async function loadArchive(){
  try{
   const response=await fetch('/api/admin/aziz/status',{cache:'no-store'});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'تعذرت قراءة الأرشيف.');
   setArchive(data);setArchiveError('');
  }catch(error){setArchive(null);setArchiveError(error instanceof Error?error.message:'تعذرت قراءة الأرشيف.');}
 }
 useEffect(()=>{void loadArchive();},[]);
 async function run(batch:number){
  setBusy(batch);setResult(null);
  try{
   const r=await fetch('/api/admin/aziz/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batch})});
   const data=await r.json();setResult(data);
   if(!r.ok)throw Error(data.error||'تعذر الاستيراد.');
  }catch(error){setResult({batch,results:[],errors:[],events:'',sahmkConfigured:false,error:error instanceof Error?error.message:'تعذر الاستيراد.'});}
  finally{await loadArchive();setBusy(0);}
 }
 return <section className="panel" aria-label="بيانات عزيز التاريخية">
  <h2>بيانات عزيز التاريخية</h2>
  <p>استيراد مستقل لخمس سنوات من OHLCV. لا ينشئ توقعًا ولا يغيّر سجل ميزان أو محفظته.</p>
  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{[1,2,3].map(batch=><button key={batch} disabled={!!busy} onClick={()=>void run(batch)}>{busy===batch?'جارٍ استيراد الدفعة…':'استيراد الدفعة '+batch}</button>)}</div>
  <p>1: أرامكو، الراجحي، Apple، Microsoft · 2: سابك، stc، NVIDIA، Exxon · 3: أكوا باور، الحبيب، JPMorgan، Johnson & Johnson.</p>
  {result&&<div role="status"><p>{result.error||('اكتملت الدفعة '+result.batch+': '+result.results.map(x=>x.symbol+' ('+x.bars+')').join('، '))}</p>{!!result.errors.length&&<ul>{result.errors.map(x=><li key={x.symbol}>{x.symbol}: {x.error}</li>)}</ul>}<p>{result.events}</p><p>مرجع SAHMK السعودي: {result.sahmkConfigured?'مهيأ.':'غير مهيأ.'}</p></div>}
  <h3>السجلات المحفوظة في D1</h3>
  <button disabled={!!busy} onClick={()=>void loadArchive()}>تحديث حالة الأرشيف</button>
  {archiveError&&<p role="status">{archiveError}</p>}
  {archive&&<div role="status">
   <p>أسهم لها بيانات: {archive.withBars} من {archive.expectedSymbols} · إجمالي سجلات OHLCV: {archive.totalBars}.</p>
   <p>اكتمال خمس سنوات وصلاحية البيانات الزمنية: لم يُتحقق منهما بعد.</p>
   {archive.latestRun&&<p>آخر دفعة {archive.latestRun.requested_batch}: {archive.latestRun.status} — بدأت {archive.latestRun.started_at}.</p>}
   <div style={{overflowX:'auto'}}><table><thead><tr><th>السوق</th><th>السهم</th><th>الجلسات</th><th>أول جلسة</th><th>آخر جلسة</th><th>مرات الجلب</th><th>الأحداث</th></tr></thead>
    <tbody>{archive.symbols.map(row=><tr key={row.id}><td>{row.market==='sa'?'السعودي':'الأمريكي'}</td><td>{row.name} ({row.symbol})</td><td>{row.bars}</td><td>{row.first_session||'—'}</td><td>{row.last_session||'—'}</td><td>{row.datasets}</td><td>{row.events}</td></tr>)}</tbody>
   </table></div>
  </div>}
 </section>;
}
