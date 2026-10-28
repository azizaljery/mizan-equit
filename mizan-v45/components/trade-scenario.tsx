'use client';
import type {tradeScenario} from '@/lib/trade-scenario';
import {fmt} from '@/lib/analysis';
import {SourceLink} from './source-link';
import {TradeScenarioPanel} from './trade-scenario-panel';
export function TradeScenario({result,currency,priceSource,quote,decision}:{decision?:ReturnType<typeof import('@/lib/final-decision').finalDecision>;quote?:import('@/lib/live-quote').LiveQuote|null;result:ReturnType<typeof tradeScenario>;currency:string;priceSource:string}){
 const p=result.levels;
 const plan=result.executionPlan?{...result.executionPlan,status:decision?.buy?'active' as const:'standby' as const,action:decision?.buy?'شراء مشروط' as const:'انتظار وتحفظ' as const}:null;
 return <section className="scenario-box"><header className="scenario-header"><h3 className="scenario-title">التوصية الحالية — تقييم أولي</h3></header><p><strong>{decision?.buy?`نوصي بالشراء للمضاربة عند ${fmt(decision.buyPrice)} ${currency} وفق الشروط الموضحة.`:'لا نوصي بالشراء حاليًا؛ نفضل الانتظار.'}</strong></p><p>{decision?.explanation||result.reasons.join(' ')}</p>
 <p>الثقة: {decision?.confidence||result.confidence} · المخاطر: {decision?.riskLevel||'غير محسومة'}</p>
 <p className="reference">أساس هذه التوصية: قواعد فنية ثابتة (اختراق المقاومة، الحجم النسبي، المتوسطات، RSI) مستقلة عن محرك توقع الأفق وعن «مركز السيناريو». الثقة «منخفضة» ثابتة لأنه تحليل أولي، وليست نسبة نجاح ولم تُقيَّم تنبؤيًا. حدودها: لا اختبار خارج العينة لهذه القواعد ضمن #15.</p>
 {decision?.price!=null&&<p>السعر المرجعي: <b>{fmt(decision.price)} {currency}</b> · وقت السعر: {decision.priceTime} · <SourceLink href={decision.priceSource||priceSource}>المصدر</SourceLink></p>}
 {decision?.checks&&<details><summary>شروط القرار — ما تحقق وما يحتاج انتظارًا</summary><p>وقت التقييم: {decision.evaluatedAt}. هذه شروط الخطة الحالية وليست احتمالات نجاح.</p><ul>{decision.checks.map(c=><li key={c.name}>{c.ok?'متحقق':'غير متحقق'} — {c.name}: {c.detail}</li>)}</ul></details>}
 <p>{decision?.disclaimer||'توصية تحليلية أولية غير مضمونة، وقد تتغير مع البيانات الجديدة.'}</p>
 {plan&&<TradeScenarioPanel plan={plan} quality={result.cashFlowQuality}/>}
 {!plan&&p&&<div className="scenario-levels-grid">{[['الدخول',`${fmt(p.low)} – ${fmt(p.high)}`],['وقف الخطر',fmt(p.stop)],['الهدف الأول',fmt(p.target1)],['الهدف الثاني',fmt(p.target2)]].map(([label,value])=><div className="level-item" key={label}>{label}: {value} {currency}</div>)}</div>}
 <details><summary>ⓘ لماذا هذه التوصية؟</summary><ul>{decision?.evidence?.map((x,i)=><li key={i}>{x}</li>)}</ul><p>{decision?.financialView}</p><p>{result.invalidation}</p>{p&&<><p>المرجع: اختراق المقاومة {fmt(p.resistance)}؛ البيانات اليومية حتى {p.asOf}. الهدفان يساويان 1.8 و3 أضعاف الخطر الحسابي وليسا توقعًا مضمونًا. الوقف 0.8 ATR تحت المقاومة؛ الفجوات والانزلاق قد يزيدان الخسارة.</p><ul>{result.conditions?.map(x=><li key={x}>{x}</li>)}</ul></>}</details>
 <details><summary>ⓘ حدود المصادر والبيانات المستخدمة</summary><ul>{result.incomplete.map((x,i)=><li key={i}>{x}</li>)}</ul><p>نقص عامل يخفض الثقة، ولا يحوله إلى إشارة إيجابية. التصنيف الشرعي مستقل وغير متحقق ما لم يظهر مصدر مؤرخ له.</p></details>
 <div className="warning-box"><h3>خلاصة ميزان الخاص</h3><p><strong>{decision?.buy?`شراء مضاربي مشروط عند ${fmt(decision.buyPrice)} ${currency}.`:'الانتظار الآن؛ لا نوصي بمطاردة السعر.'}</strong></p>{p&&decision?.sellPrice?<p>إذا كنت تملك السهم: مستوى الخروج أو إعادة التقييم للخطة هو {fmt(decision.sellPrice)} {currency}، وجني الربح المشروط عند {fmt(p.target1)} ثم {fmt(p.target2)}. هذه مستويات الخطة وليست أوامر بيع فورية أو ضمانًا للتنفيذ.</p>:<p>إذا كنت تملك السهم: راجع حجم التعرض وخطة الخروج؛ سنربط سعر الخروج بمرجع سعري موثق عند توفره.</p>}<p>القرار مؤرخ بوقت فتحه؛ أعد فتح «ميزان الخاص» لتقييم السعر الجديد.</p></div></section>;
}
