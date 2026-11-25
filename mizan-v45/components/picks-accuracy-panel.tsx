'use client';
import {useEffect,useState} from 'react';
const th={padding:'8px',borderBottom:'1px solid currentColor',textAlign:'right' as const,verticalAlign:'bottom' as const};
const td={padding:'8px',textAlign:'right' as const,verticalAlign:'top' as const};
const pc=(v:number|null)=>v===null?'—':(v*100).toFixed(1)+'%';
const pp=(v:number|null)=>v===null?'—':(v>0?'+':'')+(v*100).toFixed(1)+' نقطة';
const MK:Record<string,string>={sa:'السعودي',us:'الأمريكي'};
const ENG:Record<string,string>={'daily-picks-momentum':'ترشيحات الزخم اليومية','mizan-direction-v1':'اتجاه ميزان v1',screener:'الفرز','mizan-scenarios-7-a3434e85':'سيناريوهات ميزان 7','mizan-scenarios-7-shock-warning-1-a3434e85':'سيناريوهات 7 (تحذير صدمة 1)','mizan-scenarios-7-shock-warning-2-a3434e85':'سيناريوهات 7 (تحذير صدمة 2)','mizan-scenarios-7-diagnostics-1-a3434e85':'سيناريوهات 7 (تشخيص)'};
export function PicksAccuracyPanel(){
 const [d,setD]=useState<any>(null),[err,setErr]=useState(false);
 useEffect(()=>{fetch('/api/picks-accuracy').then(r=>r.json()).then(j=>j.error?setErr(true):setD(j)).catch(()=>setErr(true));},[]);
 if(err)return <p>تعذر حساب لوحة الدقة.</p>;
 if(!d)return <p>جارٍ الحساب...</p>;
 const rows=d.rows.filter((r:any)=>r.records>0);
 return <div dir="rtl">
  <div style={{overflowX:'auto'}}><table dir="rtl" style={{width:'100%',borderCollapse:'collapse',minWidth:980}}><thead><tr>
   {['المحرك','السوق','الأفق','ترشيحات الصعود التي ارتفعت (إصابات / محسوم)','معدل الصعود الأساسي المطابق','الفرق عن الأساس','تواريخ مستقلة','نسبة الحالات ذات الإشارة','لم يكتمل أفقها','إشارات الهبوط التي هبطت','ملاحظة'].map(h=><th key={h} style={th}>{h}</th>)}
  </tr></thead><tbody>
   {rows.map((r:any)=><tr key={r.engine+r.market+r.horizon}>
    <td style={td}>{ENG[r.engine]||r.engine}</td><td style={td}>{MK[r.market]}</td><td style={td}>{r.horizon===1?'جلسة':r.horizon+' جلسة'}</td>
    <td style={td}>{r.upResolved?`${r.upHits} / ${r.upResolved} (${pc(r.upHitRate)})`:'لا يوجد محسوم'}</td>
    <td style={td}>{pc(r.baseRate)}{r.baseCovered&&r.baseCovered<r.upResolved?` (على ${r.baseCovered} من ${r.upResolved})`:''}</td>
    <td style={td}>{pp(r.lift)}</td><td style={td}>{r.dates}</td>
    <td style={td}>{r.signalShare===null?'—':`${pc(r.signalShare)} (${r.withSignal} من ${r.resolved})`}</td>
    <td style={td}>{r.pending} من {r.records}</td>
    <td style={td}>{r.downResolved?`${r.downHits} / ${r.downResolved} (${pc(r.downHitRate)})`:'—'}</td>
    <td style={td}>{r.note}</td></tr>)}
  </tbody></table></div>
  <p>المقارنة بمعدل صعود <strong>كل</strong> الأسهم المتاحة للترشيح في السوق نفسه والتواريخ نفسها والأفق نفسه: لمحركات الترشيح من الكون اليومي المخزَّن، ولمحرك التوقع من كل توقعاته المحسومة في التاريخ نفسه. الفرق الموجب لا يعني مهارة قبل أن تكبر العينة وتتعدد التواريخ.</p>
  <p>في محرك التوقع تُعرض «لا إشارة» حين تقل الحركة المتوقعة عن {d.noSignalPct}% (حدّ تجريبي للعرض فقط؛ التوقعات والأرقام المخزَّنة كما صدرت دون تعديل). نسبة الإشارة محسوبة من الحالات المحسومة.</p>
 </div>;
}
