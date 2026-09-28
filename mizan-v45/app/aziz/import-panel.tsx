'use client';
import {useState} from 'react';

type ImportResult={batch:number;results:{symbol:string;bars:number}[];errors:{symbol:string;error:string}[];events:string;sahmkConfigured:boolean;error?:string};

export default function ImportPanel(){
 const [busy,setBusy]=useState(0),[result,setResult]=useState<ImportResult|null>(null);
 async function run(batch:number){setBusy(batch);setResult(null);try{const r=await fetch('/api/admin/aziz/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batch})});const data=await r.json();setResult(data);if(!r.ok)throw Error(data.error||'تعذر الاستيراد.');}catch(error){setResult({batch,results:[],errors:[],events:'',sahmkConfigured:false,error:error instanceof Error?error.message:'تعذر الاستيراد.'});}finally{setBusy(0);}}
 return <section className="panel" aria-label="بيانات عزيز التاريخية">
  <h2>بيانات عزيز التاريخية</h2>
  <p>استيراد مستقل لخمس سنوات من OHLCV. لا ينشئ توقعًا ولا يغيّر سجل ميزان أو محفظته.</p>
  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{[1,2,3].map(batch=><button key={batch} disabled={!!busy} onClick={()=>void run(batch)}>{busy===batch?'جارٍ استيراد الدفعة…':'استيراد الدفعة '+batch}</button>)}</div>
  <p>1: أرامكو، الراجحي، Apple، Microsoft · 2: سابك، stc، NVIDIA، Exxon · 3: أكوا باور، الحبيب، JPMorgan، Johnson & Johnson.</p>
  {result&&<div role="status"><p>{result.error||('اكتملت الدفعة '+result.batch+': '+result.results.map(x=>x.symbol+' ('+x.bars+')').join('، '))}</p>{!!result.errors.length&&<ul>{result.errors.map(x=><li key={x.symbol}>{x.symbol}: {x.error}</li>)}</ul>}<p>{result.events}</p><p>مرجع SAHMK السعودي: {result.sahmkConfigured?'مهيأ.':'غير مهيأ.'}</p></div>}
 </section>;
}
