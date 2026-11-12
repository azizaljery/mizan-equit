'use client';
import {useState} from 'react';
const STATUS:Record<string,string>={running:'يعمل',paused:'موقوف مؤقتًا',stopped:'متوقف نهائيًا'};
const MODE:Record<string,string>={dry_run:'تشغيل جاف',paper:'تجربة ورقية'};
const MARKET:Record<string,string>={sa:'السعودي (ريال)',us:'الأمريكي (دولار)'};
/** Paper-trading bot settings: create an experiment (frozen strategy version), start / pause / stop it. Paper money only; no broker link. */
export function BotAdmin(){
 const [list,setList]=useState<any[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [form,setForm]=useState({name:'',market:'us',mode:'dry_run',positionPct:'',maxPositionsPerHorizon:'',dailyLossHaltPct:'',start:true});
 async function call(init?:RequestInit){
  setBusy(true);setMessage('');
  try{const r=await fetch('/api/admin/bot',{...init,headers:{'Content-Type':'application/json'}}),d=await r.json();if(!r.ok)throw Error(d.error);return d;}
  catch(e){setMessage(e instanceof Error?e.message:'تعذر الاتصال.');return null;}finally{setBusy(false);}
 }
 const load=async()=>{const d=await call();if(d)setList(d.experiments);};
 const act=async(action:string,id:string)=>{if(action==='stop'&&!confirm('الإيقاف النهائي لا رجعة فيه. هل تريد المتابعة؟'))return;const d=await call({method:'POST',body:JSON.stringify({action,id})});if(d){setMessage('تم: '+STATUS[d.status]);await load();}};
 const create=async()=>{
  const body:any={action:'create',name:form.name,market:form.market,mode:form.mode,start:form.start};
  for(const k of ['positionPct','maxPositionsPerHorizon','dailyLossHaltPct'] as const)if(form[k]!=='')body[k]=Number(form[k]);
  const d=await call({method:'POST',body:JSON.stringify(body)});
  if(d){setMessage(`أُنشئت التجربة (${d.strategyVersion}) وحالتها: ${STATUS[d.status]}.`);setForm({...form,name:''});await load();}
 };
 return <details className="admin-section" onToggle={e=>{if((e.target as HTMLDetailsElement).open&&!list)void load();}}><summary>البوت الورقي — التجارب والإعدادات</summary>
  <p className="muted">أموال افتراضية فقط، بلا ربط بأي وسيط. لكل سوق تجربة مستقلة (رأس المال الافتراضي: 1,000,000 دولار، و3,750,000 ريال للسعودي). قواعد الاستراتيجية مجمّدة بنسخة؛ أي تعديل في الحجم أو حد المخاطرة ينشئ نسخة جديدة مؤرخة ولا يغيّر نسخة قائمة. التجربة المتوقفة لا تُستأنف.</p>
  <p role="status">{message}</p>
  {list&&(list.length?<table className="auto-table" dir="rtl"><thead><tr><th>التجربة</th><th>السوق</th><th>الوضع</th><th>الحالة</th><th>النسخة</th><th>بدأت</th><th>إجراء</th></tr></thead><tbody>{list.map(e=><tr key={e.id}><td>{e.name}</td><td>{MARKET[e.market]}</td><td>{MODE[e.mode]}</td><td>{STATUS[e.status]}</td><td dir="ltr">{e.strategyVersion}</td><td dir="ltr">{String(e.startedAt).slice(0,16).replace('T',' ')}</td><td className="nowrap">
   {e.status==='paused'&&<button className="link-btn" disabled={busy} onClick={()=>void act('start',e.id)}>تشغيل</button>}
   {e.status==='running'&&<button className="link-btn" disabled={busy} onClick={()=>void act('pause',e.id)}>إيقاف مؤقت</button>}
   {e.status!=='stopped'&&<> <button className="link-btn" disabled={busy} onClick={()=>void act('stop',e.id)}>إيقاف نهائي</button></>}
   {' '}<a className="link-btn" href={`/bot?experiment=${encodeURIComponent(e.id)}`}>اللوحة</a></td></tr>)}</tbody></table>:<p>لا توجد تجارب بعد.</p>)}
  <h4>تجربة جديدة</h4>
  <form onSubmit={e=>{e.preventDefault();void create();}}><div className="metric-grid">
   <label>الاسم<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required minLength={3} maxLength={60}/></label>
   <label>السوق<select value={form.market} onChange={e=>setForm({...form,market:e.target.value})}><option value="us">الأمريكي</option><option value="sa">السعودي</option></select></label>
   <label>الوضع<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="dry_run">تشغيل جاف (للتحقق من التتبع)</option><option value="paper">تجربة ورقية (للقياس)</option></select></label>
   <label>حجم الصفقة % من المحفظة<input type="number" step="0.1" min={0.1} max={10} value={form.positionPct} placeholder="2" onChange={e=>setForm({...form,positionPct:e.target.value})}/></label>
   <label>أقصى مراكز لكل أفق<input type="number" min={1} max={50} value={form.maxPositionsPerHorizon} placeholder="15" onChange={e=>setForm({...form,maxPositionsPerHorizon:e.target.value})}/></label>
   <label>إيقاف الشراء عند هبوط يومي %<input type="number" step="0.1" min={0.5} max={20} value={form.dailyLossHaltPct} placeholder="3" onChange={e=>setForm({...form,dailyLossHaltPct:e.target.value})}/></label>
  </div>
  <label><input type="checkbox" checked={form.start} onChange={e=>setForm({...form,start:e.target.checked})}/> ابدأ فورًا (لا يتعامل البوت إلا مع توقعات صدرت بعد لحظة البدء)</label>
  <div className="ask-actions"><button className="secondary-btn" disabled={busy||form.name.trim().length<3}>إنشاء التجربة</button><button type="button" className="link-btn" disabled={busy} onClick={()=>void load()}>تحديث القائمة</button><a className="link-btn" href="/bot">لوحة البوت</a></div></form>
 </details>;
}
