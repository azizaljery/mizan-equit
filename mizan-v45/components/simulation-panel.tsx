'use client';
import {useEffect,useState} from 'react';
import {UNIVERSE,SA_UNIVERSE} from '@/lib/integration/backtest';
import {runSimulation,decisionDatesOf,type Series,type SimResult,type ResultRow} from '@/lib/simulation/run';
import {replayEngine} from '@/lib/simulation/engine-replay';

const th={padding:'8px',borderBottom:'1px solid currentColor',textAlign:'right' as const};
const td={padding:'8px',textAlign:'right' as const};
const pc=(v:number|null)=>v===null||!Number.isFinite(v)?'—':(v*100).toFixed(1)+'%';
const pp=(v:number|null)=>v===null||!Number.isFinite(v)?'—':(v>0?'+':'')+(v*100).toFixed(1);
const ci=(c:{lo:number|null;hi:number|null}|null)=>c&&c.lo!==null&&c.hi!==null?`[${pp(c.lo)} ; ${pp(c.hi)}]`:'—';
const ARM:Record<string,string>={baseline:'خط الأساس (كل الأسهم)',engine_current:'المحرك الحالي (≥ 0.15%)',mom126_5:'زخم 6 أشهر',audit_up:'حالة «صعود» من التدقيق',composite:'مركّب (زخم + تذبذب + MA200)'};

const DB='mizan-simulation',ST='data';
const idb=()=>new Promise<IDBDatabase>((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(ST);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
async function idbGet(k:string):Promise<any>{try{const d=await idb();return await new Promise(ok=>{const q=d.transaction(ST).objectStore(ST).get(k);q.onsuccess=()=>ok(q.result);q.onerror=()=>ok(undefined);});}catch{return undefined;}}
async function idbSet(k:string,v:any){try{const d=await idb();await new Promise<void>(ok=>{const t=d.transaction(ST,'readwrite');t.objectStore(ST).put(v,k);t.oncomplete=()=>ok();t.onerror=()=>ok();});}catch{}}
const ls={get:(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{}},del:(k:string)=>{try{localStorage.removeItem(k);}catch{}}};
const tick=()=>new Promise<void>(r=>setTimeout(r,0));

export function SimulationPanel(){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[res,setRes]=useState<SimResult|null>(null),[saved,setSaved]=useState('');
 useEffect(()=>{const s=ls.get('mizan-sim-result');if(s){try{setRes(JSON.parse(s));}catch{}}if(ls.get('mizan-sim-running')==='1')run();},[]);
 async function run(){
  setBusy(true);setRes(null);setSaved('');ls.set('mizan-sim-running','1');
  try{
   const today=new Date().toISOString().slice(0,10),series:Series[]=[],cur:Record<string,string>={};
   const all=[...UNIVERSE.map(s=>['us',s] as const),...SA_UNIVERSE.map(s=>['sa',s] as const)];
   let i=0;
   for(const [mk,sym] of all){
    setMsg(`جلب الأسعار ${++i}/${all.length}: ${sym}`);
    try{
     let c=await idbGet('p:'+sym);
     if(!c||c.day!==today){const r=await fetch('/api/simulation/prices?symbol='+sym);const j=await r.json();c=r.ok?{day:today,prices:j.prices,currency:j.currency}:null;if(c)await idbSet('p:'+sym,c);}
     if(c&&c.prices?.length>=300){series.push({symbol:sym,market:mk,prices:c.prices});cur[sym]=c.currency;}
    }catch{}
   }
   // the engine is replayed on each symbol's own price history up to every decision date of its market
   const decisions={us:decisionDatesOf(series.filter(s=>s.market==='us')),sa:decisionDatesOf(series.filter(s=>s.market==='sa'))};
   let k=0;
   for(const s of series){
    setMsg(`إعادة تشغيل المحرك ${++k}/${series.length}: ${s.symbol}`);await tick();
    let e=await idbGet('e:'+s.symbol);
    if(!e||e.day!==today){e={day:today,engine:replayEngine(s.symbol,s.market,s.prices,cur[s.symbol],decisions[s.market])};await idbSet('e:'+s.symbol,e);}
    s.engine=e.engine;
   }
   setMsg('تشغيل المحاكاة...');await tick();
   const out=runSimulation(series);setRes(out);ls.set('mizan-sim-result',JSON.stringify(out));ls.del('mizan-sim-running');setMsg('');
  }catch(e){ls.del('mizan-sim-running');setMsg(e instanceof Error?e.message:'تعذرت المحاكاة.');}
  finally{setBusy(false);}
 }
 async function save(){
  if(!res)return;setSaved('جارٍ الحفظ...');
  try{const r=await fetch('/api/simulation/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({result:res})});const j=await r.json();setSaved(r.ok?'حُفظت كمحاكاة تاريخية منفصلة عن التوقعات الصادرة.':(j.error||'تعذر الحفظ.'));}catch{setSaved('تعذر الحفظ.');}
 }
 const mk=(m:string)=>m==='us'?'أمريكا':'السعودية';
 const holdout=(res?.rows||[]).filter(r=>r.period==='holdout');
 const groups=[...new Set(holdout.map(r=>r.market+'|'+r.horizon))];
 return <div>
  <button className="btn" onClick={run} disabled={busy} style={{padding:'10px 18px'}}>{busy?'جارٍ التشغيل...':'شغّل المحاكاة التاريخية'}</button>
  {msg&&<p>{msg}</p>}
  {res&&!busy&&<>
   <p><strong>{res.label}</strong> — مواصفة {res.specVersion} — {res.generatedAt.slice(0,16).replace('T',' ')} UTC. الأسعار المجلوبة تُحفظ في المتصفح، وإن غادرت الصفحة يستأنف التشغيل عند العودة.</p>
   <table dir="rtl" style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['السوق','عدد الأسهم','تواريخ القرار','تطوير / تحقق / حجز (أفق 5)','تطوير / تحقق / حجز (أفق 21)'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>
    {Object.entries(res.markets).map(([m,v])=><tr key={m}><td style={td}>{mk(m)}</td><td style={td}>{v.stocks}</td><td style={td}>{v.decisionDates}</td><td style={td}>{v.periods[5]?.development} / {v.periods[5]?.validation} / {v.periods[5]?.holdout}</td><td style={td}>{v.periods[21]?.development} / {v.periods[21]?.validation} / {v.periods[21]?.holdout}</td></tr>)}
   </tbody></table>
   {groups.map(g=>{const [m,h]=g.split('|'),rows=holdout.filter(r=>r.market===m&&String(r.horizon)===h) as ResultRow[];
    return <section key={g} style={{marginTop:24}}><h2>{mk(m)} — أفق {h} جلسات (فترة الحجز فقط)</h2>
     <table dir="rtl" style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['الذراع','المنتقى / الإصابات','نسبة الإصابة','معدل الأساس المطابق','الفرق عن الأساس (نقطة) وفاصل 95%','الفرق عن المحرك الحالي (نقطة) وفاصل 95%','تواريخ قرار / مستقلة','الحكم'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
      {rows.map(r=><tr key={r.arm}><td style={td}>{ARM[r.arm]}{r.topFraction?` (أعلى ${Math.round(r.topFraction*100)}%)`:''}</td><td style={td}>{r.picks} / {r.hits}</td><td style={td}>{pc(r.hitRate)}</td><td style={td}>{pc(r.baseRate)}</td><td style={td}>{pp(r.lift.est)} {ci(r.lift)}</td><td style={td}>{r.vsEngine?`${pp(r.vsEngine.est)} ${ci(r.vsEngine)}`:'—'}</td><td style={td}>{r.dates} / {r.independentDates}</td><td style={td}><strong>{r.verdict}</strong></td></tr>)}
     </tbody></table></section>;})}
   <p>«تفوّق» تعني: الحد الأدنى لفاصل الفرق عن الأساس موجب، والحد الأدنى للفرق عن المحرك الحالي موجب. «غير كافٍ» تعني أن التواريخ المستقلة أقل من {20} أو المنتقى أقل من {100}؛ لا يُحكم. لا تكاليف ولا توزيعات؛ النجاح = إغلاق بعد الأفق أعلى من إغلاق يوم القرار.</p>
   <details style={{marginTop:12}}><summary>العتبات المختارة (من فترة التحقق فقط)</summary>
    <table dir="rtl" style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['السوق','الأفق','الذراع','أعلى نسبة','الأساس'].map(x=><th key={x} style={th}>{x}</th>)}</tr></thead><tbody>
     {res.choices.map((c,i)=><tr key={i}><td style={td}>{mk(c.market)}</td><td style={td}>{c.horizon}</td><td style={td}>{ARM[c.arm]}</td><td style={td}>{Math.round(c.topFraction*100)}%</td><td style={td}>{c.basis}</td></tr>)}
    </tbody></table></details>
   <ul>{res.notes.map(n=><li key={n}>{n}</li>)}</ul>
   <button className="btn" onClick={save} style={{padding:'8px 16px'}}>احفظ النتيجة (إدارة)</button> {saved&&<span>{saved}</span>}
  </>}
 </div>;
}
