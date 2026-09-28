'use client';
import type {privateDecisionEvidence} from '@/lib/final-decision';
import {fmt} from '@/lib/analysis';
import {SourceLink} from './source-link';
export function PrivateEvidence({evidence:e}:{evidence:ReturnType<typeof privateDecisionEvidence>}){
 return <section aria-label="أدلة ميزان الخاص" className="section-gap">
  <h3>الأدلة التي يستند إليها القرار</h3><p>جودة البيانات: {e.dataQuality} · تغطية محاور التحليل {fmt(e.coverage,0)}% — ليست نسبة نجاح.</p>
  <div className="metric-grid"><div><h4>ما يدعم القراءة</h4>{e.strengths.length?<ul>{e.strengths.map(s=><li key={s}>{s}</li>)}</ul>:<p>لم تتوفر نقاط قوة متحققة في التحليل الحالي.</p>}</div><div><h4>ما يضعفها</h4>{e.weaknesses.length?<ul>{e.weaknesses.map(s=><li key={s}>{s}</li>)}</ul>:<p>عدم رصد نقطة ضعف لا يعني غياب المخاطر؛ راجع النواقص.</p>}</div></div>
  <details><summary>محاور التحليل وأوزانها الفعلية</summary><p>هذه محاور جودة التحليل، وليست احتمال ربح أو درجات جديدة للتوصية.</p><div className="wide-table"><table className="auto-table"><thead><tr><th>المحور</th><th>القراءة /100</th><th>الوزن</th><th>الأساس والحدود</th></tr></thead><tbody>{e.axes.map(a=><tr key={a.name}><th>{a.name}</th><td>{a.value===null?'غير متحقق':fmt(a.value)}</td><td>{fmt(a.weight)}%</td><td>{a.note}</td></tr>)}</tbody></table></div></details>
  <details><summary>الأرقام المالية ومصادرها</summary>{!e.facts.length?<p>لم تصل أرقام سنوية متجانسة للفترة والعملة المعتمدتين.</p>:<div className="wide-table"><table className="auto-table"><thead><tr><th>البند</th><th>القيمة</th><th>الفترة</th><th>النشر</th><th>المصدر</th></tr></thead><tbody>{e.facts.map(f=><tr key={f.name}><th>{f.name}</th><td>{fmt(f.value)} {f.currency}</td><td>{f.date}</td><td>{f.publishedAt||'غير متحقق؛ لا يصلح وحده لاختبار تاريخي'}</td><td><SourceLink href={f.source}>المصدر المختار</SourceLink></td></tr>)}</tbody></table></div>}{e.comparisons.map((c,i)=><p key={i}>{c.name} · {c.date}: {c.excluded?'استُبعد العامل من التحليل':'اختير '+fmt(c.value)+' '+c.currency}؛ البديل {fmt(c.alternativeValue)}. {c.reason} <SourceLink href={c.source}>الأول</SourceLink> · <SourceLink href={c.alternativeSource}>البديل</SourceLink></p>)}</details>
  <details><summary>حالة المصادر والنواقص</summary>{e.sources.map((s,i)=><p key={i}>{s.name} · {s.state} · {s.detail} <SourceLink href={s.url}>المصدر</SourceLink></p>)}{e.observations.map((s,i)=><p key={i}>{s.source||'مصدر غير متاح'} · {s.type} · {s.state} · {s.fallbackUsed?'استُخدم مصدر احتياطي':'قراءة المصدر'} · جُلب {s.retrievedAt||'غير متحقق'} · وقت المصدر {s.sourceTime||'غير متحقق'}</p>)}<ul>{[...e.missing,...e.warnings].map((s,i)=><li key={i}>{s}</li>)}</ul><p>{e.shariaNote}</p></details>
  <p>{e.historicalNote}</p>
 </section>;
}
