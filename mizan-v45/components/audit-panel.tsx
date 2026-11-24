'use client';
import {useEffect,useState} from 'react';
import {macroChange,type MacroObs} from '@/lib/integration/backtest';
import {CAUSAL_NODES,propagate} from '@/lib/transmission';

const STATE:Record<string,string>={UP:'صاعد (بحثي)',DOWN:'هابط (بحثي)',ABSTAIN:'امتناع عن الحكم',CONTRADICTION:'تعارض أدلة',VETO:'فيتو: لا حكم'};
const REASON:Record<string,string>={insufficient_evidence:'الأدلة أقل من الحد الأدنى (مجموع الأوزان أقل من 1)',edge_below_sensitivity:'الفارق بين الجانبين أصغر من 20% من مجموع الأدلة',both_sides_heavy:'ثقل كل جانب 0.8 فأكثر؛ تُعرض الفرضيتان',direction:'الجانب الأثقل يحدد الاتجاه',veto_active:'قاعدة فيتو مفعّلة'};
const POS:Record<string,string>={above:'فوق السحابة',below:'تحت السحابة',inside:'داخل السحابة'};
const th={padding:'8px',borderBottom:'1px solid currentColor',textAlign:'right' as const};
const td={padding:'8px',textAlign:'right' as const};
const f=(v:any,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—';
/** Declared thresholds for calling a macro move a shock (20 observations, known with a one-day lag). */
const SHOCKS=[{node:'fed_funds',series:'NYFED:EFFR',kind:'diff' as const,min:0.1,label:'الفائدة الفعلية الأمريكية',unit:'نقطة مئوية'},{node:'brent',series:'DCOILBRENTEU',kind:'pct' as const,min:0.05,label:'برنت',unit:'%'}];
const arrow=(s:number)=>s>0?'↑ يرتفع':s<0?'↓ ينخفض':'—';

export function AuditPanel(){
 const [symbol,setSymbol]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [data,setData]=useState<any>(null);
 const [obs,setObs]=useState<Record<string,MacroObs[]>|null>(null);
 useEffect(()=>{fetch('/api/integration/macro').then(r=>r.json()).then(j=>setObs(j.series||null)).catch(()=>setObs(null));},[]);
 const seen=SHOCKS.map(h=>{const v=obs?macroChange(obs[h.series]||[],new Date().toISOString().slice(0,10),h.kind):null;return {...h,v,hit:v!==null&&Math.abs(v)>=h.min};});
 const [shock,setShock]=useState('fed_funds');const [shockSign,setShockSign]=useState<1|-1>(1);
 async function run(e?:React.FormEvent){
  e?.preventDefault();const s=symbol.trim().toUpperCase();if(!s)return;
  setBusy(true);setError('');setData(null);
  try{const r=await fetch('/api/audit?symbol='+encodeURIComponent(s));const j=await r.json();if(!r.ok)throw new Error(j.error||'تعذر الفحص.');setData(j);}
  catch(err){setError(err instanceof Error?err.message:'تعذر الفحص.');}
  finally{setBusy(false);}
 }
 const d=data?.decision,wy=data?.structure?.wyckoff,imp=data?.structure?.elliottImpulse,re=data?.reaction,ind=data?.indicators;
 const nodes=Object.fromEntries(CAUSAL_NODES.map(n=>[n.id,n.label]));
 const reached=propagate(shock,shockSign);
 return <div dir="rtl" style={{display:'grid',gap:'20px'}}>
  <form onSubmit={run} style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
   <input value={symbol} onChange={e=>setSymbol(e.target.value)} placeholder="رمز السهم مثل 2222.SR أو AAPL" dir="ltr" style={{padding:'8px',minWidth:'240px'}} aria-label="رمز السهم"/>
   <button type="submit" disabled={busy||!symbol.trim()}>{busy?'جارٍ الفحص…':'افحص'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {data&&<>
   <section><h2>الحالة: {STATE[d.state]||d.state}</h2>
    <p>{REASON[d.reason]||d.reason}. آخر جلسة: <bdi dir="ltr">{data.asOf}</bdi> ({data.bars} جلسة). ثقل الصعود {f(d.support,1)} مقابل ثقل الهبوط {f(d.against,1)}{d.margin!==null&&d.margin!==undefined?`، الهامش ${f(100*d.margin,0)}%`:''}.</p>
    {d.vetoes?.length>0&&<ul>{data.vetoes.filter((v:any)=>v.active).map((v:any)=><li key={v.id}>{v.reason}</li>)}</ul>}
    {d.hypotheses&&<table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={th}>الفرضية</th><th style={th}>الثقل</th><th style={th}>الأدلة</th></tr></thead><tbody>
     <tr><td style={td}>صعود</td><td style={td}>{f(d.hypotheses.up.weight,1)}</td><td style={td}>{d.hypotheses.up.items.join('، ')}</td></tr>
     <tr><td style={td}>هبوط</td><td style={td}>{f(d.hypotheses.down.weight,1)}</td><td style={td}>{d.hypotheses.down.items.join('، ')}</td></tr></tbody></table>}
   </section>
   <section><h2>الأدلة وقواعدها</h2>
    {data.evidence.length?<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={th}>الدليل</th><th style={th}>الاتجاه</th><th style={th}>القيمة</th><th style={th}>القاعدة</th><th style={th}>الوزن</th></tr></thead><tbody>
     {data.evidence.map((e:any)=><tr key={e.id}><td style={td}>{e.label}</td><td style={td}>{e.direction>0?'+1 صعود':'−1 هبوط'}</td><td style={td}><bdi dir="ltr">{e.value}</bdi></td><td style={td}>{e.rule}</td><td style={td}>{e.weight}</td></tr>)}</tbody></table></div>:<p>لا توجد أدلة ذات اتجاه الآن.</p>}
   </section>
   <section><h2>المؤشرات</h2><ul>
    <li>Ichimoku: {ind.ichimoku.position?POS[ind.ichimoku.position]:'—'} (Tenkan {f(ind.ichimoku.tenkan)}، Kijun {f(ind.ichimoku.kijun)})</li>
    <li>Stochastic: K {f(ind.stochastic.slowK,1)}، D {f(ind.stochastic.slowD,1)}</li>
    <li>OBV: {typeof ind.obv==='number'?Math.round(ind.obv).toLocaleString('en-US'):'—'}</li>
    {ind.fibonacci&&<li>Fibonacci ({ind.fibonacci.direction==='up'?'موجة صاعدة':'موجة هابطة'}، من {f(ind.fibonacci.low)} إلى {f(ind.fibonacci.high)}): {ind.fibonacci.levels.map((l:any)=>`${Math.round(l.ratio*1000)/10}% = ${f(l.price)}`).join('، ')}. مستويات مرجعية فقط.</li>}
   </ul></section>
   <section><h2>رد فعل السعر</h2>{re?<p>آخر جلسة ({re.date}): العائد {f(re.returnPct)}% (z = {f(re.zScore)})، فجوة الافتتاح {f(re.gapPct)}%، الحجم {f(re.volumeRatio)}× المتوسط. النطاق المعتاد {f(re.band.lowPct)}% إلى {f(re.band.highPct)}%. التقييم: {re.abnormal?'رد فعل غير معتاد':'ضمن المعتاد'}.</p>:<p>لا تكفي البيانات.</p>}</section>
   <section><h2>فحوص البنية</h2>
    {wy?.status==='ok'?<><p>نطاق آخر 40 جلسة قبل الخمس الأخيرة: {f(wy.range.low)} إلى {f(wy.range.high)} (عرض {f(wy.range.widthPct,1)}%) — {wy.range.isRange?'يُعامل كنطاق':'أوسع من الحد فلا يُعامل كنطاق'}.</p>
     <p>أحداث: {wy.events.length?wy.events.map((e:any)=>`${e.name} ${e.date}`).join('، '):'لا شيء'}. الجهد مقابل النتيجة: {wy.effortResult?`مرصود (حجم ${f(wy.effortResult.evidence.volumeRatio)}× وحركة ${f(wy.effortResult.evidence.moveRatio)}×)`:'غير مرصود'}.</p></>:<p>بيانات غير كافية لفحص النطاق.</p>}
    {imp?<><p>آخر ست نقاط تأرجح ({imp.direction==='up'?'صاعدة':'هابطة'}) على قواعد إليوت: {imp.valid?'اجتازت القواعد الأربع (لا يثبت هذا العد)':'خالفت قاعدة'}.</p><ul>{imp.rules.map((r:any)=><li key={r.id}>{r.passed?'✓':'✗'} {r.rule} — {r.detail}</li>)}</ul></>:<p>لا توجد ست نقاط تأرجح مؤكدة.</p>}
   </section>
  </>}
  <section><h2>سلاسل الانتقال (فرضيات معلنة، غير مقاسة)</h2>
   <p>اختر صدمة لترى ما تتوقعه الخريطة في العوامل اللاحقة. «غامض» تعني أن مسارين يعطيان إشارتين متعاكستين فلا يُفرض اتجاه.</p>
   <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
    <div dir="rtl" style={{margin:'8px 0'}}><strong>أحدث حركة كلية مرصودة (فرضية للمراجعة، ليست توقعًا):</strong> {!obs?'غير متاحة الآن.':seen.map(h=><span key={h.node} style={{marginInlineEnd:16}}>{h.label}: {h.v===null?'بيانات غير كافية':(h.kind==='pct'?(h.v*100).toFixed(1)+'%':h.v.toFixed(2)+' '+h.unit)}{h.hit?<> <button type="button" onClick={()=>{setShock(h.node);setShockSign(h.v!>0?1:-1);}}>طبّق كصدمة</button></>:' (دون حد الصدمة)'}</span>)}</div>
    <select value={shock} onChange={e=>setShock(e.target.value)} aria-label="الصدمة">{CAUSAL_NODES.filter(n=>n.kind==='macro'||n.kind==='input').map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select>
    <select value={shockSign} onChange={e=>setShockSign(Number(e.target.value) as 1|-1)} aria-label="اتجاه الصدمة"><option value={1}>ترتفع</option><option value={-1}>تنخفض</option></select>
   </div>
   <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={th}>العامل</th><th style={th}>المتوقع</th><th style={th}>التأخر (يوم)</th></tr></thead><tbody>
    {reached.map(r=><tr key={r.node}><td style={td}>{nodes[r.node]||r.node}</td><td style={td}>{r.ambiguous?'غامض':arrow(r.sign)}</td><td style={td}>{r.lagMin} – {r.lagMax}</td></tr>)}</tbody></table>
  </section>
 </div>;
}
