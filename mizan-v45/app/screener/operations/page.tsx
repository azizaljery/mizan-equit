'use client';
import {useEffect,useState} from 'react';
import {HORIZONS} from '@/lib/forecast-horizons';
import {FOLLOWUP_DEFAULT} from '@/lib/screener-operations-core';
import {toast} from 'sonner';
import {Notice} from '@/components/site/notice';
import {SignInPrompt} from '@/components/site/sign-in-prompt';
import {EmptyState,ListSkeleton} from '@/components/site/empty-state';
import {StatusBadge} from '@/components/site/status-badge';
import {Accordion,AccordionContent,AccordionItem,AccordionTrigger} from '@/components/ui/accordion';
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(v):'—';
export default function ScreenerOperationsPage(){
 const [data,setData]=useState<any>(null),[config,setConfig]=useState<any>({...FOLLOWUP_DEFAULT}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[signin,setSignin]=useState(false);
 /** Cloudflare Access answers an unauthenticated /api/admin request with a cross-origin redirect; with redirect:'manual' that arrives as an opaque redirect instead of a 'Failed to fetch' TypeError. */
 const needsSignIn=(r:Response)=>r.type==='opaqueredirect'||r.status===401||r.status===403;
 const networkMessage=(e:unknown,fallback:string)=>e instanceof TypeError?'تعذر الوصول إلى الخادم. تحقق من الاتصال ثم اضغط «تحديث القراءة».':e instanceof Error?e.message:fallback;
 async function load(){setBusy(true);setError('');try{const r=await fetch('/api/admin/screener-operations',{credentials:'include',cache:'no-store',redirect:'manual'});if(needsSignIn(r)){setSignin(true);setData(null);return;}const d=await r.json().catch(()=>({error:'تحتاج جلسة إدارة المالك لقراءة السجل.'}));if(!r.ok)throw Error(d.error||'تحتاج جلسة إدارة المالك لقراءة السجل.');setSignin(false);setData(d);setConfig(d.settings.config);}catch(e){setError(networkMessage(e,'تعذرت القراءة.'));}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 async function save(){setBusy(true);setError('');try{const r=await fetch('/api/admin/screener-operations',{method:'POST',credentials:'include',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});if(needsSignIn(r)){setSignin(true);throw Error('انتهت جلسة الإدارة؛ سجّل الدخول ثم احفظ مجددًا.');}const d=await r.json().catch(()=>({error:'تعذر الحفظ.'}));if(!r.ok)throw Error(d.error||'تعذر الحفظ.');await load();toast.success('حُفظت إعدادات المتابعة');}catch(e){setError(networkMessage(e,'تعذر الحفظ.'));toast.error('لم تُحفظ الإعدادات',{description:networkMessage(e,'تعذر الحفظ.')});}finally{setBusy(false);}}
 return <main className="auto-workspace" dir="rtl"><header className="panel"><h1>المتابعة وأداء الترشيحات</h1><a className="source-link" href="/screener">العودة إلى فرز الأسهم</a><p>القوائم الأصلية محفوظة في أرشيف ميزان. هذه اللوحة لا تعيد حساب الماضي ولا تصدر أوامر تداول.</p><button className="secondary-btn" disabled={busy} onClick={()=>void load()}>تحديث القراءة</button></header>
  {signin&&<SignInPrompt returnTo="/screener/operations" title="لوحة المتابعة خاصة بجلسة إدارة المالك">سجّل الدخول بحساب مالك ميزان لقراءة سجل المتابعة وأداء الترشيحات.</SignInPrompt>}
  {error&&<Notice>{error}</Notice>}
  {busy&&!data&&!error&&!signin&&<section className="panel"><p role="status">جارٍ قراءة سجل المتابعة…</p><ListSkeleton rows={5}/></section>}
  {data&&<><section className="panel"><h2>متابعة الفرز على الخادم</h2><p>عدد الأسهم أدناه لكل سوق: السعودي والأمريكي. يعمل الجدول عند نبضة Cron الموجودة كل 6 ساعات، بلا زيادة لاستدعاءات المجلس.</p>
   <label>تفعيل المتابعة <input type="checkbox" checked={config.enabled} disabled={busy} onChange={e=>setConfig({...config,enabled:e.target.checked})}/></label>
   <label>تكرار المسح <select value={config.intervalHours} onChange={e=>setConfig({...config,intervalHours:Number(e.target.value)})}><option value={6}>كل 6 ساعات</option><option value={24}>يومي</option><option value={168}>أسبوعي</option></select></label>
   <label>مدة التوقع <select value={config.horizonSessions} onChange={e=>setConfig({...config,horizonSessions:Number(e.target.value)})}>{HORIZONS.map(h=><option key={h.sessions} value={h.sessions}>{h.name}</option>)}</select></label>
   <label>الأسهم المفحوصة لكل سوق <select value={config.scanPerMarket} onChange={e=>setConfig({...config,scanPerMarket:Number(e.target.value)})}>{[20,40,100,200].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
   <label>النتائج لكل سوق <select value={config.resultCount} onChange={e=>setConfig({...config,resultCount:Number(e.target.value)})}>{[5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
   <button className="search-button" disabled={busy} onClick={()=>void save()}>حفظ المتابعة</button><p className="muted">التفعيل يحتاج تجربة ناجحة كاملة بنفس المدة والعدد. التعطيل يمنع الدورات الجديدة ولا يمحو الأرشيف. توقف الدورة عند بلوغ حدود الوقت يبقى معلنًا كمسح غير مكتمل.</p>
   <p>آخر دورة: {data.lastFollowup?.summary?.status??'لم تُسجّل دورة'}</p>{data.lastFollowup&&<p>{data.lastFollowup.updatedAt}</p>}</section>
   <section className="panel"><h2>أداء الترشيحات المثبتة</h2><p>{data.note}</p><p>توقعات فريدة: {number(data.performance.uniqueForecasts)} · عضويات مكررة مستبعدة من القياس: {number(data.performance.duplicateMemberships)} · صفوف غير صالحة: {number(data.performance.invalidRows)}</p>
    {data.sampleCapReached&&<Notice tone="info">القراءة محدودة بآخر 10000 عضوية؛ ليست تقريرًا شاملًا لكل التاريخ.</Notice>}
    {!data.performance.cells.length?<EmptyState title="لا توجد ترشيحات نهائية قابلة للقياس في القراءة الحالية."/>:<div className="wide-table"><table className="auto-table"><thead><tr>{['السوق','الجلسات / النموذج','المختار','مكتمل','معلق','مستبعد / تالف','مقام الاتجاه','دقة الاتجاه','إصابة النطاق','خطأ السعر النسبي'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{data.performance.cells.map((c:any)=><tr key={[c.market,c.horizon,c.model,c.evaluationPolicy].join('|')}><td>{c.market==='sa'?'السعودي':'الأمريكي'}</td><td>{c.horizon}<small>{c.model}</small><small>{c.evaluationPolicy}</small></td><td>{c.selected}</td><td>{c.complete}</td><td>{c.pending}</td><td>{c.excluded} / {c.invalidOutcomes}</td><td>{number(c.metrics.directionCount)}</td><td>{number(c.metrics.directionAccuracyPct)}{c.metrics.directionAccuracyPct!==null?'%':''}</td><td>{number(c.metrics.rangeCoveragePct)}{c.metrics.rangeCoveragePct!==null?'%':''}</td><td>{number(c.metrics.meanRelativePriceErrorPct)}{c.metrics.meanRelativePriceErrorPct!==null?'%':''}</td></tr>)}</tbody></table></div>}
    <p className="muted">{data.benchmark.note}</p><p className="muted">{data.modelComparison.note}</p></section>
   <section className="panel"><h2>تكليفات الوكلاء</h2><p>{data.workPacket.instructions}</p><Accordion type="multiple" dir="rtl" className="site-accordion">{data.workPacket.tasks.map((t:any)=><AccordionItem key={t.id} value={String(t.id)}><AccordionTrigger className="text-start">{t.id} — {t.title} — {t.owner}</AccordionTrigger><AccordionContent><p>{t.acceptance}</p><p>الحالة: <StatusBadge tone="pending">تكليف</StatusBadge>؛ لا يُعد مغلقًا إلا بدليل تنفيذ واختبار.</p></AccordionContent></AccordionItem>)}</Accordion></section>
   <section className="panel"><h2>أحدث القوائم المحفوظة</h2>{data.recent.map((r:any)=><p key={r.id}><b>{r.market} / {r.horizon} جلسة</b> — <StatusBadge state={r.status}>{r.status}</StatusBadge> — المخطط {r.planned} — المرشح {number(r.selected)} — {r.createdAt}<small dir="ltr">{r.id}</small></p>)}</section></>}
 </main>;
}
