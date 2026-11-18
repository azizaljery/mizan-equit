'use client';
import {useState} from 'react';
import {analyze,buildRows,MACRO_FEATURES,UNIVERSE,SA_UNIVERSE,type Row,type MacroObs} from '@/lib/integration/backtest';

const th={padding:'8px',borderBottom:'1px solid currentColor',textAlign:'right' as const};
const td={padding:'8px',textAlign:'right' as const};
const f=(v:number,d=4)=>Number.isFinite(v)?v.toFixed(d):'—';
const pc=(v:number)=>(v*100).toFixed(1)+'%';

export function IntegrationPanel(){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[res,setRes]=useState<any>(null),[cover,setCover]=useState<any[]>([]);
 async function run(){
  setBusy(true);setRes(null);setMsg('جلب بيانات الاقتصاد الكلي...');
  try{
   const mr=await fetch('/api/integration/macro');const mj=await mr.json();if(!mr.ok)throw new Error(mj.error);
   const macro:Record<string,MacroObs[]>=mj.series;
   // use only series with enough history for the lookback; the rest are reported as excluded, never filled
   const cov=MACRO_FEATURES.map(s=>({...s,n:(macro[s.id]||[]).length,from:(macro[s.id]||[])[0]?.date||'—'}));setCover(cov);
   const specs=MACRO_FEATURES.filter(s=>(macro[s.id]||[]).length>=60);
   if(!specs.length)throw new Error('لا توجد سلاسل كلية بتاريخ كافٍ بعد.');
   const names=specs.map(s=>s.label),out:any={specs:names};
   for(const [mk,list] of [['us',UNIVERSE],['sa',SA_UNIVERSE]] as const){
    const rows:Row[]=[];let ok=0;
    for(const sym of list){
     setMsg(`${mk==='us'?'أمريكا':'السعودية'}: جلب الأسعار ${++ok}/${list.length}: ${sym}`);
     try{const r=await fetch('/api/integration/samples?symbol='+sym);const j=await r.json();if(r.ok)rows.push(...buildRows(sym,j.prices,macro,specs));}catch{}
    }
    out[mk]={symbols:new Set(rows.map(r=>r.s)).size,h5:analyze(rows,5,names),h21:analyze(rows,21,names)};
   }
   setRes(out);setMsg('');
  }catch(e){setMsg(e instanceof Error?e.message:'تعذر الاختبار.');}
  finally{setBusy(false);}
 }
 const block=(a:any,title:string)=>a.status!=='ok'?<p>{title}: {a.reason}</p>:<section style={{marginTop:24}}><h2>{title}</h2>
  <p>{a.rows} عينة، {a.dates} تاريخًا؛ الاختبار على {a.testRows} عينة من {a.testDates} تاريخًا لاحقًا للتدريب. نسبة الصعود في التدريب {pc(a.baseRate)}.</p>
  <table dir="rtl" style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['النموذج','دقة الاتجاه','Brier (الأقل أفضل)'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>
   <tr><td style={td}>نسبة الأساس فقط</td><td style={td}>{pc(a.accuracy.base)}</td><td style={td}>{f(a.brier.base)}</td></tr>
   <tr><td style={td}>أسعار فقط</td><td style={td}>{pc(a.accuracy.price)}</td><td style={td}>{f(a.brier.price)}</td></tr>
   <tr><td style={td}>أسعار + اقتصاد كلي</td><td style={td}>{pc(a.accuracy.full)}</td><td style={td}>{f(a.brier.full)}</td></tr></tbody></table>
  <table dir="rtl" style={{width:'100%',borderCollapse:'collapse',marginTop:12}}><thead><tr>{['المقارنة','فرق Brier','فاصل 95%','الحكم'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>
   {([['الكلي مقابل الأسعار فقط',a.macroVsPrice],['الكلي+أسعار مقابل الأساس',a.fullVsBase],['الأسعار مقابل الأساس',a.priceVsBase]] as const).map(([n,d]:any)=><tr key={n}><td style={td}>{n}</td><td style={td}>{f(d.mean,5)}</td><td style={td}>{f(d.lo,5)} إلى {f(d.hi,5)}</td><td style={td}>{!d.excludesZero?'لا فرق مؤكد':d.mean<0?'الأول أفضل':'الأول أسوأ'}</td></tr>)}</tbody></table>
  <p><strong>{a.addsInformation?'الاقتصاد الكلي أضاف معلومة في هذه العينة (يحتاج تأكيدًا على بيانات لاحقة قبل أي ربط).':'لا دليل على أن الاقتصاد الكلي يضيف معلومة؛ لا يُربط بالتوقع.'}</strong> فرق Brier السالب يعني أن الأول أفضل.</p></section>;
 return <div>
  <button className="btn" onClick={run} disabled={busy} style={{padding:'10px 18px'}}>{busy?'جارٍ الاختبار...':'شغّل الاختبار التاريخي'}</button>
  {msg&&<p>{msg}</p>}
  {cover.length>0&&<table dir="rtl" style={{width:'100%',borderCollapse:'collapse',marginTop:16}}><thead><tr>{['السلسلة الكلية','عدد الملاحظات','أول تاريخ','داخل الاختبار؟'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{cover.map(c=><tr key={c.id}><td style={td}>{c.label}</td><td style={td}>{c.n}</td><td style={td}>{c.from}</td><td style={td}>{c.n>=60?'نعم':'لا (بيانات غير كافية)'}</td></tr>)}</tbody></table>}
  {res&&(['us','sa'] as const).map(mk=><div key={mk}><h2 style={{marginTop:32}}>{mk==='us'?'السوق الأمريكي':'السوق السعودي'} ({res[mk].symbols} سهمًا وصلت بياناتها)</h2>{block(res[mk].h5,'أفق 5 جلسات')}{block(res[mk].h21,'أفق 21 جلسة')}</div>)}
 </div>;
}
