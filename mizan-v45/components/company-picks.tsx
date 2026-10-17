'use client';
import {useEffect,useState} from 'react';
import {TrendingUp,Sparkles} from 'lucide-react';
import {ConfidenceBadge} from './confidence-badge';
import {Notice} from './site/notice';
import {EmptyState,ListSkeleton} from './site/empty-state';

type Pick={id:string;symbol:string;name:string;market:'sa'|'us';currency:string;price:number|null;predictedPrice:number|null;expectedChangePct:number|null;range:[number,number]|null;
 confidence:string;dataQuality:string;coverage:number;riskLevel:string;reasons:string[];risks:string[];issuedAt:string;priceTime:string};
type Data={picks:Pick[];considered:number;eligible:number;exclusions:Record<string,number>;horizonName:string;since:string;generatedAt:string;policy:string;
 trackRecord:{evaluated:number;directionCorrect:number;directionAccuracy:number|null;rangeCoverage:number|null}};
const HORIZONS=[[1,'يومي'],[5,'أسبوعي'],[21,'شهري']] as const;
const fmt=(v:number|null|undefined,d=2)=>typeof v!=='number'||!Number.isFinite(v)?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(v);
const when=(s:string)=>{const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'}):s||'غير متاح';};
const reasonNames:Record<string,string>={model_unavailable:'امتنع النموذج',not_rising:'ليس صاعدًا',low_or_unknown_confidence:'ثقة منخفضة',invalid_range:'نطاق غير صالح',invalid_positive_target:'هدف غير صالح',target_outside_range:'الهدف خارج النطاق',inconsistent_target:'هدف غير متسق',missing_price_provenance:'وقت السعر غير متحقق'};

/** «توصيات الشركات»: top rising forecasts already recorded by Mizan, filtered with the screener's own rules. */
export function CompanyPicks({compact=false}:{compact?:boolean}){
 const [market,setMarket]=useState<'sa'|'us'>('sa'),[horizon,setHorizon]=useState<number>(5),[count,setCount]=useState(compact?2:3);
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();setBusy(true);setError('');
  fetch(`/api/picks?market=${market}&horizon=${horizon}&count=${count}`,{signal:ctrl.signal}).then(async r=>{const d=await r.json().catch(()=>({error:'تعذر قراءة الاستجابة.'}));if(!r.ok)throw Error(d.error||'تعذر جلب الترشيحات.');setData(d);})
   .catch(e=>{if(!ctrl.signal.aborted){setData(null);setError(e instanceof Error?e.message:'تعذر جلب الترشيحات.');}}).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
  return()=>ctrl.abort();},[market,horizon,count]);
 const t=data?.trackRecord;
 return <section className="panel company-picks" dir="rtl" aria-labelledby="picks-title">
  <div className="panel-head"><h2 id="picks-title"><Sparkles size={20} aria-hidden="true"/> توصيات الشركات — الأرجح صعودًا حسب ميزان</h2></div>
  <p className="muted">أقوى التوقعات الصاعدة التي سجّلها ميزان مؤخرًا، بنفس شروط الفرز دون تخفيفها. ترتيب نموذج وليس توصية شراء ولا ضمانًا للصعود.</p>
  <div className="company-search picks-controls">
   <label className="market-select"><span>السوق</span><select aria-label="السوق" value={market} onChange={e=>setMarket(e.target.value as 'sa'|'us')}><option value="sa">السعودي</option><option value="us">الأمريكي</option></select></label>
   <label className="market-select"><span>المدة</span><select aria-label="المدة" value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{HORIZONS.map(([s,n])=><option key={s} value={s}>{n}</option>)}</select></label>
   <label className="market-select"><span>عدد الشركات</span><select aria-label="عدد الشركات" value={count} onChange={e=>setCount(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n===1?'شركة واحدة':n===2?'شركتان':n+' شركات'}</option>)}</select></label>
  </div>
  {error&&<Notice>{error}</Notice>}
  {busy&&!data&&<ListSkeleton rows={count}/>}
  {data&&!data.picks.length&&<EmptyState icon={<TrendingUp aria-hidden="true"/>} title={`لا توجد شركة مستوفية للشروط (${data.horizonName})`} action={<a className="secondary-btn" href="/screener">شغّل فرزًا جديدًا</a>}>
   راجع ميزان {data.considered} توقعًا حديثًا لهذا السوق والمدة، ولم يجتز أي منها شرط الصعود بثقة متوسطة أو مرتفعة. لا نخفض الشروط لإظهار أسماء.</EmptyState>}
  {data&&data.picks.length>0&&<ol className="picks-list">{data.picks.map((p,i)=><li key={p.id} className="pick-card">
   <div className="pick-rank" aria-label={`الترتيب ${i+1}`}>{i+1}</div>
   <div className="pick-body">
    <h3><a href={`/?symbol=${encodeURIComponent(p.symbol)}`}>{p.name}</a> <bdi dir="ltr" className="muted">{p.symbol.replace('.SR','')}</bdi></h3>
    <div className="pick-figures">
     <span>السعر المرجعي <b>{fmt(p.price)}</b> {p.currency}</span>
     <span>المركزي المتوقع <b>{fmt(p.predictedPrice)}</b></span>
     <span className="pick-change">+{fmt(p.expectedChangePct)}%</span>
     <span>النطاق {p.range?`${fmt(p.range[0])} – ${fmt(p.range[1])}`:'—'}</span>
    </div>
    <div className="pick-meta"><ConfidenceBadge value={p.confidence}/><small>المخاطر: {p.riskLevel}</small><small>تغطية العوامل {fmt(p.coverage,0)}%</small><small>صدر {when(p.issuedAt)} · سعر {p.priceTime||'—'}</small></div>
    {!compact&&p.reasons.length>0&&<details><summary>لماذا رُشّحت؟</summary><ul>{p.reasons.map(r=><li key={r}>{r}</li>)}</ul>{p.risks.length>0&&<><b>مخاطر:</b><ul>{p.risks.map(r=><li key={r}>{r}</li>)}</ul></>}</details>}
   </div></li>)}</ol>}
  {data&&<p className="muted picks-foot">
   سجل ميزان لهذه المدة في هذا السوق: {t&&t.evaluated?<>قيس {t.evaluated} توقعًا؛ صحة الاتجاه {fmt(t.directionAccuracy,1)}% وتغطية النطاق {fmt(t.rangeCoverage,1)}%.</>:'لم يكتمل قياس توقعات كافية بعد.'} العينة: {data.considered} توقعًا منذ {when(data.since)}، اجتاز منها {data.eligible}.
   {Object.keys(data.exclusions).length>0&&<> المستبعد: {Object.entries(data.exclusions).map(([k,n])=>`${reasonNames[k]||k} ${n}`).join('، ')}.</>}
  </p>}
  {compact&&<a className="source-link" href="/picks">كل الترشيحات وتفاصيلها</a>}
 </section>;
}
