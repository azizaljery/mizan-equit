'use client';
import {useEffect,useState} from 'react';
const th={padding:'8px',borderBottom:'1px solid currentColor',textAlign:'right' as const};
const td={padding:'8px',textAlign:'right' as const};
const G:Record<string,string>={UP:'قرار صاعد',DOWN:'قرار هابط',ABSTAIN_ETC:'امتناع/تعارض/فيتو'};
const pc=(v:number|null)=>v===null?'—':(v*100).toFixed(1)+'%';
export function ShadowSummary(){
 const [d,setD]=useState<any>(null),[err,setErr]=useState(false);
 useEffect(()=>{fetch('/api/audit/shadow').then(r=>r.json()).then(j=>j.error?setErr(true):setD(j)).catch(()=>setErr(true));},[]);
 if(err)return <p dir="rtl">تعذر قراءة سجل الظل.</p>;
 if(!d)return null;
 return <section dir="rtl" style={{marginTop:32}}><h2>سجل الظل: هل صدقت قرارات التدقيق لاحقًا؟</h2>
  <p>تسجَّل حالة التدقيق يوميًا لـ12 سهمًا (6 أمريكية و6 سعودية) بسعر لحظتها، وتُحسم بعد 5 و21 جلسة من الإغلاقات الفعلية. المسجَّل حتى الآن: {d.logged}. لا حكم قبل {d.minResolvedPerGroup} نتيجة محسومة على الأقل لكل مجموعة، ولا يدخل أي توقع أو قرار.</p>
  <table dir="rtl" style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['الأفق','المجموعة','المحسوم','نسبة الصعود الفعلية','العينة كافية؟'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>
   {d.stats.map((s:any)=><tr key={s.horizon+s.group}><td style={td}>{s.horizon} جلسات</td><td style={td}>{G[s.group]}</td><td style={td}>{s.resolved}</td><td style={td}>{pc(s.upRate)}</td><td style={td}>{s.enough?'نعم':'لا'}</td></tr>)}
   {d.baseline.map((b:any)=><tr key={'b'+b.horizon}><td style={td}>{b.horizon} جلسات</td><td style={td}>كل المسجَّل (خط الأساس)</td><td style={td}>{b.resolved}</td><td style={td}>{pc(b.upRate)}</td><td style={td}>—</td></tr>)}</tbody></table></section>;
}
