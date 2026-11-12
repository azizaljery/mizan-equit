'use client';
import {useEffect,useState} from 'react';
const STATUS:Record<string,string>={running:'يعمل',paused:'موقوف مؤقتًا',stopped:'متوقف نهائيًا'};
const ORDER:Record<string,string>={pending:'معلق',filled:'منفذ',cancelled:'ملغى',expired:'منتهٍ'};
const ACTION:Record<string,string>={buy:'شراء',sell:'بيع',hold:'إبقاء',abstain:'امتناع',suspend:'تعليق'};
const HORIZON:Record<number,string>={1:'يومي',5:'أسبوعي',21:'شهري'};
const n=(v:unknown,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?n(v)+'%':'—';
/** All times are shown in Makkah/Riyadh time (UTC+3); stored values stay UTC. */
const RIYADH=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const t=(v:unknown)=>{if(!v)return '—';const d=new Date(String(v));return Number.isNaN(d.getTime())?String(v).slice(0,16).replace('T',' '):RIYADH.format(d);};
const Empty=()=><p className="muted">لا بيانات بعد.</p>;
const Metric=({title,value,hint}:{title:string;value:string;hint?:string})=><div className="metric"><div className="title">{title}</div><div className="value">{value}</div>{hint&&<div className="hint">{hint}</div>}</div>;
const exportHref=(table:string,exp?:string)=>`/api/admin/bot/export?table=${table}${exp?`&experiment=${encodeURIComponent(exp)}`:''}`;

/** Private dashboard (owner + admin session). Paper money only. Performance and forecast accuracy are shown separately. */
export function BotDashboard(){
 const [experiments,setExperiments]=useState<any[]|null>(null),[id,setId]=useState(''),[data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{(async()=>{try{const r=await fetch('/api/admin/bot'),d=await r.json();if(!r.ok)throw Error(d.error);setExperiments(d.experiments);const want=new URLSearchParams(location.search).get('experiment');setId(want&&d.experiments.some((e:any)=>e.id===want)?want:d.experiments[0]?.id||'');}catch(e){setError(e instanceof Error?e.message:'تعذر الاتصال.');}})();},[]);
 useEffect(()=>{if(!id)return;setLoading(true);(async()=>{try{const r=await fetch('/api/admin/bot?experiment='+encodeURIComponent(id)),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setError('');}catch(e){setError(e instanceof Error?e.message:'تعذر الاتصال.');}finally{setLoading(false);}})();},[id]);
 const [runMsg,setRunMsg]=useState(''),[running,setRunning]=useState(false);
 const runNow=async()=>{setRunning(true);setRunMsg('جارٍ تنفيذ خطوة الآن… قد تستغرق حتى دقيقتين.');
  try{const r=await fetch('/api/admin/bot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run-now',id})}),x=await r.json();if(!r.ok)throw Error(x.error);
   const s=x.step?.experiments?.[0];setRunMsg(x.status==='locked'?'خطوة أخرى قيد التشغيل الآن؛ أعد المحاولة بعد دقائق.':`اكتملت الخطوة ${t(x.finishedAt)}: قرارات ${s?.decisions??0}، أوامر جديدة ${s?.orders??0}، تنفيذات ${s?.fills??0}، معلقة ${s?.stillPending??0}`+(x.errors?.length?` — أخطاء: ${x.errors.join('؛ ')}`:''));
   const q=await fetch('/api/admin/bot?experiment='+encodeURIComponent(id)),dd=await q.json();if(q.ok)setData(dd);}
  catch(err){setRunMsg(err instanceof Error?err.message:'تعذر الاتصال.');}finally{setRunning(false);}};
 if(error&&!experiments)return <section className="panel"><p role="alert">{error}</p><p className="muted">اللوحة خاصة بالمالك: سجّل الدخول من <a href="/#mizan-admin">إدارة ميزان</a> ثم عد إلى هذه الصفحة.</p></section>;
 if(!experiments)return <section className="panel"><p>جارٍ التحميل…</p></section>;
 if(!experiments.length)return <section className="panel"><h2>لا توجد تجارب</h2><p className="muted">أنشئ تجربة من <a href="/#mizan-admin">إدارة ميزان</a> ← قسم «البوت الورقي» ← إنشاء ثم ابدأ.</p></section>;
 const d=data?.dashboard,e=d?.experiment,p=d?.performance,cur=e?.currency||'';
 return <>
  <section className="panel"><div className="panel-head"><h2>التجربة</h2><select value={id} onChange={x=>setId(x.target.value)} aria-label="اختيار التجربة">{experiments.map(x=><option key={x.id} value={x.id}>{x.name} — {x.market==='sa'?'السعودي':'الأمريكي'} — {STATUS[x.status]}</option>)}</select></div>
   {e&&<p className="muted">{e.mode==='dry_run'?'تشغيل جاف':'تجربة ورقية'} · النسخة <span dir="ltr">{e.strategyVersion}</span> · بدأت {t(e.startedAt)}{e.stoppedAt?` · توقفت ${t(e.stoppedAt)}`:''} · أموال افتراضية فقط، بلا ربط بوسيط.</p>}
   {e?.status==='running'&&<p><button type="button" className="secondary-btn" disabled={running} onClick={()=>void runNow()}>نفّذ الآن</button> <span className="muted">خطوة فورية بالقواعد نفسها: لا شراء والسوق مغلق، ولا تجاوز للسيولة والمخاطرة. كرّر الضغط إن بقيت أوامر معلقة.</span></p>}
   {runMsg&&<p role="status">{runMsg}</p>}
   {e&&/^bot-strategy-1/.test(String(e.strategyVersion))&&<p className="warning-box">هذه التجربة على الإصدار 1: حد عمر السعر 900 ثانية، وأسعار تداول تصل متأخرة نحو 15 دقيقة، فستُرفض أوامرها السعودية بسبب «السعر قديم». أوقفها وأنشئ تجربة جديدة (تُبنى على الإصدار 2) من <a href="/#mizan-admin">إدارة ميزان</a>.</p>}
   {error&&<p role="alert">{error}</p>}{loading&&<p className="muted">تحديث…</p>}
  </section>
  {d&&<>
  {d.ledgerError&&<p className="warning-box">تعذر إعادة بناء الدفتر من التنفيذات ({d.ledgerError}). راجع سجل التنفيذات.</p>}
  <div className="metric-grid">
   <Metric title="قيمة المحفظة" value={n(d.equity)+' '+cur} hint={d.lastSnapshot?'لقطة '+d.lastSnapshot.date:'من آخر أسعار التنفيذ (لا لقطة يومية بعد)'}/>
   <Metric title="النقد" value={n(d.cash)+' '+cur}/>
   <Metric title="قيمة المراكز" value={n(d.positionsValue)+' '+cur}/>
   <Metric title="رأس المال الابتدائي" value={n(e.initialCash,0)+' '+cur}/>
   <Metric title="ربح محقق" value={n(d.realized)+' '+cur}/>
   <Metric title="ربح غير محقق" value={n(d.unrealized)+' '+cur} hint="مقابل آخر سعر تنفيذ"/>
   <Metric title="إجمالي التكاليف" value={n(d.totalCosts)+' '+cur} hint="عمولة + فارق + انزلاق"/>
   <Metric title="العائد بعد التكاليف" value={pct(p?.returnAfterCostsPct)}/>
  </div>
  <section className="panel"><h2>الأداء</h2>
   <div className="metric-grid">
    <Metric title="نسبة الصفقات الرابحة" value={pct(p?.winRatePct)} hint={`${p?.closedTrades??0} صفقة مغلقة`}/>
    <Metric title="أقصى تراجع" value={pct(p?.maxDrawdownPct)}/>
    <Metric title={'المؤشر المرجعي'+(d.lastSnapshot?.benchmarkName?' ('+d.lastSnapshot.benchmarkName+')':'')} value={pct(p?.benchmarkReturnPct)} hint={p?.benchmarkReturnPct==null?'يحتاج لقطتين يوميتين على الأقل':undefined}/>
    <Metric title="الأوامر" value={Object.entries(d.orderCounts).map(([k,v])=>`${ORDER[k]||k} ${v}`).join(' · ')||'—'}/>
   </div>
   {d.snapshots.length?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>التاريخ</th><th>النقد</th><th>المراكز</th><th>القيمة</th><th>المرجع</th></tr></thead><tbody>{d.snapshots.slice(-30).reverse().map((s:any)=><tr key={s.date}><td dir="ltr">{s.date}</td><td>{n(s.cash)}</td><td>{n(s.positionsValue)}</td><td>{n(s.equity)}</td><td>{n(s.benchmark)}</td></tr>)}</tbody></table></div>:<Empty/>}
   <p><a className="link-btn" href={exportHref('snapshots',id)}>تصدير اللقطات CSV</a></p>
  </section>
  <section className="panel"><h2>المراكز المفتوحة</h2>
   {d.positions.length?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>السهم</th><th>الأفق</th><th>الكمية</th><th>متوسط التكلفة</th><th>فُتح</th><th>التوقع</th></tr></thead><tbody>{d.positions.map((x:any)=><tr key={x.symbol+x.horizon}><td dir="ltr">{x.symbol}</td><td>{HORIZON[x.horizon]}</td><td>{x.quantity}</td><td>{n(x.avgCost)}</td><td dir="ltr">{t(x.openedAt)}</td><td dir="ltr">{x.forecastId||'—'}</td></tr>)}</tbody></table></div>:<Empty/>}</section>
  <section className="panel"><h2>الأوامر</h2>
   {data.orders.length?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>الوقت</th><th>السهم</th><th>الأفق</th><th>الاتجاه</th><th>الكمية</th><th>الحالة</th><th>السبب</th><th>المحاولات</th></tr></thead><tbody>{data.orders.map((o:any)=><tr key={o.id}><td dir="ltr">{t(o.createdAt)}</td><td dir="ltr">{o.symbol}</td><td>{HORIZON[o.horizon]}</td><td>{o.side==='buy'?'شراء':'بيع'}</td><td>{o.quantity}</td><td>{ORDER[o.status]||o.status}</td><td>{o.statusReason||'—'}</td><td>{o.attempts}</td></tr>)}</tbody></table></div>:<Empty/>}
   <p><a className="link-btn" href={exportHref('orders',id)}>تصدير الأوامر CSV</a></p></section>
  <section className="panel"><h2>التنفيذات (السعر والتكاليف والتأخير)</h2>
   {data.fills.length?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>الوقت</th><th>السهم</th><th>الأفق</th><th>الاتجاه</th><th>الكمية</th><th>سعر العرض</th><th>سعر التنفيذ</th><th>عمولة</th><th>فارق</th><th>انزلاق</th><th>عمر السعر (ث)</th><th>المصدر</th></tr></thead><tbody>{data.fills.map((f:any)=><tr key={f.id}><td dir="ltr">{t(f.createdAt)}</td><td dir="ltr">{f.symbol}</td><td>{HORIZON[f.horizon]}</td><td>{f.side==='buy'?'شراء':'بيع'}</td><td>{f.quantity}</td><td>{n(f.quotePrice)}</td><td>{n(f.fillPrice)}</td><td>{n(f.commission)}</td><td>{n(f.spreadCost)}</td><td>{n(f.slippageCost)}</td><td>{n(f.quoteAgeSeconds,0)}</td><td dir="ltr">{f.priceSource}</td></tr>)}</tbody></table></div>:<Empty/>}
   <p><a className="link-btn" href={exportHref('fills',id)}>تصدير التنفيذات CSV</a></p></section>
  <section className="panel"><h2>القرارات وأسباب الامتناع</h2>
   <p className="muted">{Object.entries(d.decisionCounts).map(([k,v])=>`${ACTION[k]||k} ${v}`).join(' · ')||'لا قرارات بعد.'}</p>
   {d.abstainReasons.length>0&&<table className="auto-table" dir="rtl"><thead><tr><th>سبب الامتناع/الإبقاء</th><th>العدد</th></tr></thead><tbody>{d.abstainReasons.map((r:any)=><tr key={r.reason}><td>{r.reason}</td><td>{r.n}</td></tr>)}</tbody></table>}
   {data.decisions.length?<div className="wide-table section-gap"><table className="auto-table" dir="rtl"><thead><tr><th>الوقت</th><th>السهم</th><th>الأفق</th><th>القرار</th><th>السبب</th><th>التوقع المستخدم</th><th>نسخة النموذج</th><th>نسخة الاستراتيجية</th></tr></thead><tbody>{data.decisions.map((x:any)=><tr key={x.id}><td dir="ltr">{t(x.createdAt)}</td><td dir="ltr">{x.symbol}</td><td>{HORIZON[x.horizon]}</td><td>{ACTION[x.action]||x.action}</td><td>{x.reason}</td><td dir="ltr">{x.forecastId?`${x.forecastId} (${t(x.forecastCreatedAt)})`:'—'}</td><td dir="ltr">{x.modelVersion||'—'}</td><td dir="ltr">{x.strategyVersion}</td></tr>)}</tbody></table></div>:<Empty/>}
   <p><a className="link-btn" href={exportHref('decisions',id)}>تصدير القرارات CSV</a></p></section>
  </>}
  <section className="panel"><h2>دقة التوقع لكل مصدر ومحرك</h2>
   <p className="muted">مقياس مستقل عن أرباح البوت: هل ارتفع السعر ضمن الأفق بعد نداء «صاعد»؟ يُقارَن بنسبة صعود الأسهم نفسها في السوق والأفق نفسيهما. لا دمج للمصادر في رقم واحد.</p>
   {data?.scorecard?.length?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>المصدر</th><th>النسخة</th><th>السوق</th><th>الأفق</th><th>إشارات</th><th>نداءات صاعدة</th><th>ناضجة</th><th>تحقق الصعود</th><th>خط الأساس</th><th>الفرق</th></tr></thead><tbody>{data.scorecard.map((s:any)=><tr key={[s.source,s.sourceVersion,s.market,s.horizon].join('|')}><td dir="ltr">{s.source}</td><td dir="ltr">{s.sourceVersion}</td><td>{s.market==='sa'?'السعودي':'الأمريكي'}</td><td>{HORIZON[s.horizon]}</td><td>{s.signals}</td><td>{s.upCalls}</td><td>{s.resolved}</td><td>{pct(s.hitRatePct)}</td><td>{pct(s.baselineUpPct)}</td><td>{pct(s.edgePct)}</td></tr>)}</tbody></table></div>:<Empty/>}
   <h3>بوابات النقض VOSA (وضع الظل)</h3>
   <p className="muted">تُقيَّم بجانب قرار البوت ولا تغيّره. «أشد» = كان البوت سيشتري وبوابة تنقض؛ «أخف» = البوت امتنع وكل البوابات مرّت. لا حكم على الجدوى قبل قياس النتائج بعد التكاليف.</p>
   {data?.vosa?.total?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>البند</th><th>العدد</th></tr></thead><tbody>
    <tr><td>مرشحات قُيِّمت</td><td>{data.vosa.total}</td></tr>
    {Object.entries(data.vosa.byStatus||{}).map(([k,v])=><tr key={'s'+k}><td>حكم VOSA: {k==='PASS'?'نجاة':k==='KILL'?'نقض':'تعليق'}</td><td>{String(v)}</td></tr>)}
    {Object.entries(data.vosa.byRelation||{}).map(([k,v])=><tr key={'r'+k}><td>مقارنة بالبوت: {k==='same'?'متطابق':k==='vosa_stricter'?'VOSA أشد':'VOSA أخف'}</td><td>{String(v)}</td></tr>)}
    {Object.entries(data.vosa.byGate||{}).map(([k,v])=><tr key={'g'+k}><td dir="ltr">{k}</td><td>{String(v)}</td></tr>)}
   </tbody></table></div>:<p className="muted">لا تقييمات VOSA بعد؛ تظهر بعد أول خطوة تصل لسعر مرشح.</p>}
   <h4>قيمة الصمت (فحص أولي)</h4>
   <p className="muted">من نتائج الإشارات المحسومة فقط: تغيّر السعر الخام عبر الأفق، بلا تكاليف، ولا يُعد ادعاء أداء. تُعتمد الأرقام بعد {data?.silence?.minGroup??30} نتيجة محسومة على الأقل في كل مجموعة، ثم اختبار خارج العينة بعد التكاليف.</p>
   {data?.silence?.groups?.length?<div className="wide-table"><table className="auto-table" dir="rtl"><thead><tr><th>المجموعة</th><th>محسوم</th><th>نسبة الصعود %</th><th>متوسط التغيّر %</th><th>العينة</th></tr></thead><tbody>
    {data.silence.groups.map((x:any)=><tr key={x.group}><td>{x.group==='bought_and_passed'?'اشتراه البوت ومرّ من البوابات':x.group==='bought_but_vetoed'?'اشتراه البوت ونقضته بوابة':'امتنع البوت ومرّ من البوابات'}</td><td>{x.resolved}</td><td>{x.upRatePct??'—'}</td><td>{x.meanReturnPct??'—'}</td><td>{x.enough?'كافية':'غير كافية'}</td></tr>)}
   </tbody></table></div>:<p className="muted">لا نتائج محسومة بعد لمرشحات قيّمتها البوابات.</p>}
   <p><a className="link-btn" href={exportHref('vosa',id)}>تصدير تدقيق VOSA CSV</a></p>
   <p><a className="link-btn" href={exportHref('scorecard')}>تصدير دقة المصادر CSV</a> · <a className="link-btn" href={exportHref('signals')}>تصدير الإشارات CSV</a> · <a className="link-btn" href={exportHref('experiments')}>تصدير التجارب CSV</a></p></section>
 </>;
}
