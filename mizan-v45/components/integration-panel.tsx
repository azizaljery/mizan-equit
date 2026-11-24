'use client';
import {useEffect,useState} from 'react';
import {analyze,buildRows,minObs,MACRO_FEATURES,UNIVERSE,SA_UNIVERSE,type Row,type MacroObs} from '@/lib/integration/backtest';

const th={padding:'8px',borderBottom:'1px solid currentColor',textAlign:'right' as const};
const td={padding:'8px',textAlign:'right' as const};
const f=(v:number,d=4)=>Number.isFinite(v)?v.toFixed(d):'—';
const pc=(v:number)=>(v*100).toFixed(1)+'%';

// Progress survives leaving the page: fetched prices are kept in IndexedDB (per symbol, per day), the last result in localStorage,
// and an unfinished run restarts by itself when the page is opened again, skipping what is already saved.
const DB='mizan-integration',ST='prices';
const idb=()=>new Promise<IDBDatabase>((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(ST);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
async function idbGet(k:string):Promise<any>{try{const d=await idb();return await new Promise(ok=>{const q=d.transaction(ST).objectStore(ST).get(k);q.onsuccess=()=>ok(q.result);q.onerror=()=>ok(undefined);});}catch{return undefined;}}
async function idbSet(k:string,v:any){try{const d=await idb();await new Promise<void>(ok=>{const t=d.transaction(ST,'readwrite');t.objectStore(ST).put(v,k);t.oncomplete=()=>ok();t.onerror=()=>ok();});}catch{}}
const ls={get:(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{}},del:(k:string)=>{try{localStorage.removeItem(k);}catch{}}};

export function IntegrationPanel(){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[res,setRes]=useState<any>(null),[cover,setCover]=useState<any[]>([]);
 useEffect(()=>{const saved=ls.get('mizan-int-result');if(saved){try{setRes(JSON.parse(saved));}catch{}}if(ls.get('mizan-int-running')==='1')run();},[]);
 async function run(){
  setBusy(true);setRes(null);ls.set('mizan-int-running','1');setMsg('جلب بيانات الاقتصاد الكلي...');
  try{
   const mr=await fetch('/api/integration/macro');const mj=await mr.json();if(!mr.ok)throw new Error(mj.error);
   const macro:Record<string,MacroObs[]>=mj.series;
   // use only series with enough history for the lookback; the rest are reported as excluded, never filled
   const cov=MACRO_FEATURES.map(s=>({...s,n:(macro[s.id]||[]).length,from:(macro[s.id]||[])[0]?.date||'—'}));setCover(cov);
   const specs=MACRO_FEATURES.filter(s=>(macro[s.id]||[]).length>=minObs(s));
   if(!specs.length)throw new Error('لا توجد سلاسل كلية بتاريخ كافٍ بعد.');
   const names=specs.map(s=>s.label),out:any={specs:names};
   for(const [mk,list] of [['us',UNIVERSE],['sa',SA_UNIVERSE]] as const){
    const rows:Row[]=[];let ok=0;
    for(const sym of list){
     setMsg(`${mk==='us'?'أمريكا':'السعودية'}: جلب الأسعار ${++ok}/${list.length}: ${sym}`);
     try{
      const today=new Date().toISOString().slice(0,10);let c=await idbGet('p:'+sym);
      if(!c||c.day!==today){const r=await fetch('/api/integration/samples?symbol='+sym);const j=await r.json();c=r.ok?{day:today,prices:j.prices}:null;if(c)await idbSet('p:'+sym,c);}
      if(c)rows.push(...buildRows(sym,c.prices,macro,specs));
     }catch{}
    }
    out[mk]={symbols:new Set(rows.map(r=>r.s)).size,h5:analyze(rows,5,names),h21:analyze(rows,21,names)};
   }
   out.at=new Date().toISOString();setRes(out);ls.set('mizan-int-result',JSON.stringify(out));ls.del('mizan-int-running');setMsg('');
  }catch(e){ls.del('mizan-int-running');setMsg(e instanceof Error?e.message:'تعذر الاختبار.');}
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
  {res?.at&&!busy&&<p>آخر نتيجة محفوظة في هذا المتصفح: {res.at.slice(0,16).replace('T',' ')} UTC. الأسعار المجلوبة تُحفظ، فإن غادرت الصفحة أثناء التشغيل يكمل تلقائيًا من حيث توقف عند عودتك.</p>}
  {cover.length>0&&<table dir="rtl" style={{width:'100%',borderCollapse:'collapse',marginTop:16}}><thead><tr>{['السلسلة الكلية','عدد الملاحظات','أول تاريخ','داخل الاختبار؟'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{cover.map(c=><tr key={c.id}><td style={td}>{c.label}</td><td style={td}>{c.n}</td><td style={td}>{c.from}</td><td style={td}>{c.n>=minObs(c)?'نعم':'لا (بيانات غير كافية)'}</td></tr>)}</tbody></table>}
  {res&&(['us','sa'] as const).map(mk=><div key={mk}><h2 style={{marginTop:32}}>{mk==='us'?'السوق الأمريكي':'السوق السعودي'} ({res[mk].symbols} سهمًا وصلت بياناتها)</h2>{block(res[mk].h5,'أفق 5 جلسات')}{block(res[mk].h21,'أفق 21 جلسة')}</div>)}
 </div>;
}
