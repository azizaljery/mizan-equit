'use client';
import {useEffect,useState} from 'react';
import {History} from 'lucide-react';
import {Notice} from './site/notice';
import {StatusBadge} from './site/status-badge';
import {EmptyState,ListSkeleton} from './site/empty-state';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from './ui/table';

type Row={id:string;pick_date:string;market:'sa'|'us';horizon:number;symbol:string;name:string;rank:number;universe_size:number;percentile:number;mom126_5:number;
 ref_price:number;ref_price_date:string;currency:string;mizan_predicted_price:number|null;target_date:string|null;actual_price:number|null;actual_change_pct:number|null;
 went_up:number|null;outcome_state:'pending'|'complete'|'unavailable'};
type Rates={dates:number;hitTop:number|null;hitTop3:number|null;baseRate:number|null;lift:number|null;rows:{all:number;top:number;top3:number}};
type Stats={horizon:number;startDate:string|null;counts:{rows:number;pending:number;complete:number;unavailable:number};all:Rates;excludingUnavailable:Rates;
 nonOverlap:Rates&{n:number;rho:number;nEff:number};ownerTarget:number;formalTestEligible:boolean;formalTestMinNEff:number;note:string};
type Data={market:'sa'|'us';horizon:number;modelVersion:string;protocolCommit:string;latestByMarket:Record<'sa'|'us',{date:string|null;picks:Row[]}>;history:Row[];stats:Stats;
 lastRun:{pick_date:string;status:string;universe_ok:number;universe_failed:number}|null};

const MARKET_NAMES={sa:'السعودي',us:'الأمريكي'} as const;
const HORIZONS=[[5,'5 جلسات (أسبوع)'],[21,'21 جلسة (شهر)']] as const;
const fmt=(v:number|null|undefined,d=2)=>typeof v!=='number'||!Number.isFinite(v)?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:d,minimumFractionDigits:Math.min(d,2)}).format(v);
const pct=(v:number|null|undefined,d=1)=>typeof v!=='number'||!Number.isFinite(v)?'—':`${fmt(v*100,d)}%`;
const signed=(v:number|null|undefined,d=2)=>typeof v!=='number'||!Number.isFinite(v)?'—':`${v>0?'+':''}${fmt(v,d)}%`;
const sym=(s:string)=>s.replace('.SR','');
function Outcome({r}:{r:Row}){
 if(r.outcome_state==='complete')return r.went_up===1?<StatusBadge tone="ok">صعد</StatusBadge>:<StatusBadge tone="failed">لم يصعد</StatusBadge>;
 if(r.outcome_state==='unavailable')return <StatusBadge tone="excluded">لم يصعد (السعر غير متاح)</StatusBadge>;
 return <StatusBadge tone="pending">بانتظار</StatusBadge>;
}
function Bar({label,value,target}:{label:string;value:number|null;target:number}){
 const w=value===null?0:Math.max(0,Math.min(1,value))*100;
 return <div className="ledger-bar"><div className="ledger-bar-label"><span>{label}</span><b>{pct(value)}</b></div>
  <div className="ledger-bar-track" role="img" aria-label={`${label}: ${pct(value)}؛ الهدف المرجعي ${pct(target,0)}`}>
   <div className="ledger-bar-fill" style={{width:`${w}%`}}/><div className="ledger-bar-target" style={{insetInlineStart:`${target*100}%`}} title={`الهدف ${pct(target,0)}`}/>
  </div></div>;
}

/** «سجل الترشيحات اليومية (اختبار أمامي)» — PROTOCOL-DIR-0002. Read-only view of /api/picks/ledger. */
export function PicksLedger(){
 const [market,setMarket]=useState<'sa'|'us'>('sa'),[horizon,setHorizon]=useState<number>(5);
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();setBusy(true);setError('');
  fetch(`/api/picks/ledger?market=${market}&horizon=${horizon}&limit=30`,{signal:ctrl.signal}).then(async r=>{const d=await r.json().catch(()=>({error:'تعذر قراءة الاستجابة.'}));if(!r.ok)throw Error(d.error||'تعذر جلب السجل.');setData(d);})
   .catch(e=>{if(!ctrl.signal.aborted){setData(null);setError(e instanceof Error?e.message:'تعذر جلب السجل.');}}).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
  return()=>ctrl.abort();},[market,horizon]);
 const s=data?.stats,no=s?.nonOverlap;
 const start=s?.startDate||'—';
 return <section className="panel company-picks picks-ledger" dir="rtl" aria-labelledby="ledger-title">
  <div className="panel-head"><h2 id="ledger-title"><History size={20} aria-hidden="true"/> سجل الترشيحات اليومية (اختبار أمامي)</h2></div>
  <Notice tone="info" title="نموذج تجريبي — اختبار أمامي مسجّل مسبقاً">
   اختبار أمامي بدأ {start}؛ لا يُعلن أي حكم قبل 60 ملاحظة مستقلة (~60 أسبوعاً). ترتيب نموذج تجريبي وليس توصية شراء.
  </Notice>
  <p className="muted">كل يوم تداول تُرتَّب أسهم الكون الثابت (40 لكل سوق) حسب زخم 126 جلسة قبل آخر 5 جلسات (<bdi dir="ltr">mom126_5</bdi>)، وتُعرض أعلى 3 من أعلى 20%. يُحفظ السعر عند الترشيح ولا يُعدَّل، ثم تُسجَّل النتيجة بعد انقضاء المدة.</p>
  <div className="company-search picks-controls">
   <label className="market-select"><span>السوق</span><select aria-label="سوق السجل" value={market} onChange={e=>setMarket(e.target.value as 'sa'|'us')}><option value="sa">السعودي</option><option value="us">الأمريكي</option></select></label>
   <label className="market-select"><span>المدة</span><select aria-label="مدة السجل" value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{HORIZONS.map(([h,n])=><option key={h} value={h}>{n}</option>)}</select></label>
  </div>
  {error&&<Notice>{error}</Notice>}
  {busy&&!data&&<><p className="muted" role="status">جارٍ تحميل السجل…</p><ListSkeleton rows={4}/></>}
  {data&&<>
   <h3 className="ledger-subtitle">ترشيحات آخر جلسة</h3>
   <div className="ledger-latest">{(['sa','us'] as const).map(m=>{const l=data.latestByMarket[m];return <div key={m} className="ledger-latest-market">
    <h4>السوق {MARKET_NAMES[m]} {l?.date&&<small className="muted">— جلسة {l.date}</small>}</h4>
    {!l?.picks.length?<p className="muted">لم تُسجَّل ترشيحات بعد لهذا السوق والمدة.</p>:
    <ol className="picks-list">{l.picks.map(p=><li key={p.id} className="pick-card">
     <div className="pick-rank" aria-label={`الترتيب ${p.rank}`}>{p.rank}</div>
     <div className="pick-body">
      <h3><a href={`/?symbol=${encodeURIComponent(p.symbol)}`}>{p.name}</a> <bdi dir="ltr" className="muted">{sym(p.symbol)}</bdi></h3>
      <div className="pick-figures">
       <span>السعر عند الترشيح <b>{fmt(p.ref_price)}</b> {p.currency}</span>
       <span>السعر المتوقع (ميزان) <b>{p.mizan_predicted_price===null?'غير متاح':fmt(p.mizan_predicted_price)}</b></span>
       <span>زخم <bdi dir="ltr">mom126_5</bdi> <b>{signed(p.mom126_5*100,1)}</b></span>
       <span>المئين <b>{fmt(p.percentile,0)}</b> من {p.universe_size} سهماً</span>
      </div>
     </div></li>)}</ol>}
   </div>;})}</div>

   <h3 className="ledger-subtitle">نتائج السجل — السوق {MARKET_NAMES[data.market]}، {data.horizon} جلسة</h3>
   {s&&<div className="ledger-stats">
    <div className="ledger-bars">
     <Bar label="نسبة الصعود الصحيح للترشيحات (أعلى 20%)" value={s.all.hitTop} target={s.ownerTarget}/>
     <Bar label="نسبة صعود أعلى 3 المعروضة" value={s.all.hitTop3} target={s.ownerTarget}/>
     <Bar label="نسبة صعود الكون (نفس التواريخ)" value={s.all.baseRate} target={s.ownerTarget}/>
     <p className="muted ledger-target-note">الخط العمودي = هدف المالك 80% (مرجع طموح، وليس معيار النجاح الإحصائي).</p>
    </div>
    <dl className="ledger-figures">
     <div><dt>الفرق (lift)</dt><dd>{s.all.lift===null?'—':`${s.all.lift>0?'+':''}${fmt(s.all.lift*100,1)} نقطة`}</dd></div>
     <div><dt>تواريخ مكتملة</dt><dd>{s.all.dates}</dd></div>
     <div><dt>تواريخ غير متداخلة n</dt><dd>{no?.n??0}</dd></div>
     <div><dt>العينة الفعالة n_eff</dt><dd>{fmt(no?.nEff,1)} <small className="muted">من {s.formalTestMinNEff}</small></dd></div>
     <div><dt>الفرق على غير المتداخلة</dt><dd>{no?.lift===null||no?.lift===undefined?'—':`${no.lift>0?'+':''}${fmt(no.lift*100,1)} نقطة`}</dd></div>
     <div><dt>حساسية (باستبعاد غير المتاح)</dt><dd>{s.excludingUnavailable.lift===null?'—':`${s.excludingUnavailable.lift>0?'+':''}${fmt(s.excludingUnavailable.lift*100,1)} نقطة`}</dd></div>
     <div><dt>الصفوف</dt><dd>{s.counts.complete} مكتمل · {s.counts.unavailable} غير متاح · {s.counts.pending} بانتظار</dd></div>
    </dl>
    <p className="muted">{s.note}</p>
   </div>}

   <h3 className="ledger-subtitle">السجل (أعلى 3 لكل تاريخ)</h3>
   {!data.history.length?<EmptyState icon={<History aria-hidden="true"/>} title="لا يوجد سجل بعد">يبدأ التسجيل تلقائياً بعد إغلاق السوقين (21:30 بتوقيت UTC) في أول جلسة جديدة.</EmptyState>:
   <div className="finance-table-wrapper ledger-table" tabIndex={0} role="region" aria-label="جدول سجل الترشيحات">
    <Table>
     <TableHeader><TableRow>
      {['التاريخ','السهم','السعر عند الترشيح','السعر المتوقع (ميزان)','تاريخ نهاية المدة','السعر الفعلي','التغير','النتيجة'].map(h=><TableHead key={h} className="text-start">{h}</TableHead>)}
     </TableRow></TableHeader>
     <TableBody>{data.history.map(r=><TableRow key={r.id}>
      <TableCell><bdi dir="ltr">{r.pick_date}</bdi></TableCell>
      <TableCell><span className="ledger-rank">{r.rank}</span> {r.name} <bdi dir="ltr" className="muted">{sym(r.symbol)}</bdi></TableCell>
      <TableCell>{fmt(r.ref_price)} <small className="muted">{r.currency}</small></TableCell>
      <TableCell>{r.mizan_predicted_price===null?<span className="muted">غير متاح</span>:fmt(r.mizan_predicted_price)}</TableCell>
      <TableCell>{r.target_date?<bdi dir="ltr">{r.target_date}</bdi>:<span className="muted">بعد {r.horizon} جلسة</span>}</TableCell>
      <TableCell>{fmt(r.actual_price)}</TableCell>
      <TableCell><bdi dir="ltr" className={r.actual_change_pct===null?'':r.actual_change_pct>0?'ledger-up':'ledger-down'}>{signed(r.actual_change_pct)}</bdi></TableCell>
      <TableCell><Outcome r={r}/></TableCell>
     </TableRow>)}</TableBody>
    </Table>
   </div>}
   <p className="muted picks-foot">الإصدار <bdi dir="ltr">{data.modelVersion}</bdi> · البروتوكول <bdi dir="ltr">PROTOCOL-DIR-0002 @ {data.protocolCommit.slice(0,8)}</bdi>
    {data.lastRun&&<> · آخر تسجيل لهذا السوق: جلسة {data.lastRun.pick_date} ({data.lastRun.status==='gap'?'فجوة: تعذر جلب عدد كافٍ من الأسهم':`رُتّب ${data.lastRun.universe_ok} سهماً`})</>}.
    السهم الذي يتوقف أو يُشطب يبقى في السجل ويُحسب «لم يصعد».</p>
  </>}
 </section>;
}
