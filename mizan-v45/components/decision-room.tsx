'use client';
import {EVIDENCE_PROTOCOL} from '@/lib/forecast-evidence';
import {SectionHeading} from './managed-sections';
import {useMemo,useState} from 'react';
import type {MarketReport} from '@/lib/market-data';
import {decisionRoom} from '@/lib/decision-room';
import {fmt} from '@/lib/analysis';
import {Explain} from './explain';
import {ScoreDetails} from './score-details';
import {SourceLink} from './source-link';
import {useMizanSettings} from './settings-context';

export function DecisionRoom({report,analysis}:{report:MarketReport;analysis:ReturnType<typeof import('@/lib/automatic-analysis').automaticAnalysis>}){
 const d=useMemo(()=>decisionRoom(report),[report]),[open,setOpen]=useState(false),settings=useMizanSettings();
 const score=(n:number|null)=>n===null?'غير مكتملة':fmt(n,0)+'/100';
 const cards=[
  {name:'حالة السوق بالقواعد',value:!d.marketRegime.available?'غير متاحة':d.marketRegime.currentRegime==='VOLATILITY_SHOCK'?'صدمة تقلب محتملة':d.marketRegime.currentRegime==='BULL_TREND'?'اتجاه صاعد':'عرضي / غير صاعد',detail:d.marketRegime.reason},
  {name:'الاتجاه العام',value:d.trend,detail:'ترتيب السعر ومتوسطي 50 و200 جلسة. الاتجاه وحده لا يحدد جودة الشركة أو قرار الشراء.'},
  {name:'جودة الشركة',value:score(d.companyQuality),detail:d.factors.map(v=>`${v.name}: ${score(v.value)}؛ الوزن ${v.weight}%. ${v.reason}`).join('\n')+'\nلا درجة نهائية إلا باكتمال المحاور الثلاثة وعدم تعارض المصادر. هذه درجة وصفية مستقلة لا تُضاف مرة أخرى لدرجة ميزان.'},
  {name:'ملاءمة السعر الحالي',value:score(d.priceSuitability),detail:'تُقاس عند سعر التحليل، ولا تتحدث مع كل حركة سعر. الحساب: 50 + 100 × (التقييم الأساسي − السعر) ÷ التقييم الأساسي، محصور بين 0 و100. تحتاج طريقتي تقييم صالحتين على الأقل؛ لا تعني توصية شراء. '+(d.x.fair?`التقييم الأساسي المستخدم ${fmt(d.x.fair.base)}؛ سعر التحليل ${fmt(d.a.price)}.`:'لم تتوفر طرق تقييم متعددة كافية.')},
  {name:'القوة المالية',value:score(d.factors[0].value),detail:d.factors[0].reason},
  {name:'جودة الأرباح',value:d.x.earningsQuality,detail:d.x.components.map(v=>`${v.name}: ${v.value===null?'غير متاح':fmt(v.value)}؛ ${v.value===null?'لم يدخل التقييم':v.healthy?'مساند':'يحتاج انتباهًا'}`).join('\n')},
  {name:'التقييم',value:d.x.fair?`${fmt(d.x.fair.low)} – ${fmt(d.x.fair.high)} ${report.currency}`:'غير مكتمل',detail:'نطاق متعدد الطرق من عينة النظراء؛ ليس قيمة مضمونة. الطرق المستخدمة: '+(d.x.methods.map(v=>v.name).join('، ')||'لا توجد عينة كافية')},
  {name:'المخاطر',value:analysis.riskLabel,detail:[...analysis.blockers,...analysis.weaknesses].join('\n')},
  {name:'جودة البيانات',value:d.x.dataQuality,detail:`تغطية الفحوص ${fmt(d.x.coverage)}%. الحداثة وتعارض المصادر تؤثران في التصنيف. لا تعني التغطية أن كل معلومة مؤكدة.`}
 ];
 return <section className="panel decision-room" aria-label="غرفة القرار"><SectionHeading as="h3">غرفة القرار</SectionHeading><p className="reference">الدرجات محسوبة وقت التحليل: {new Date(report.retrievedAt).toLocaleString('ar-SA')} · سعر التحليل {fmt(d.a.price)} {report.currency}. السعر المتجدد ظاهر أعلى الصفحة.</p>
 <div className="metrics-row">{cards.filter(v=>!settings.hiddenMetrics.includes(v.name)).map(v=><article className="stat-card" key={v.name}><small className="stat-card-label">{v.name}</small><strong className="stat-card-value"><Explain term={v.name} value={v.value} detail={v.detail}/></strong></article>)}</div>
 <details className="quiet-note"><summary>ⓘ الثقة والمحفزات والمخاطر</summary><div className="decision-notes"><p><b>درجة الثقة:</b> غير معروضة؛ لا تقييم تنبؤي معتمد لأي مدة ({EVIDENCE_PROTOCOL}). أرقام المدد مراكز سيناريو لا توصيات.</p><p><b>أهم محفز:</b> لم يُتحقق من محفز جوهري محدد. راجع «نبض الشركة»؛ عنوان الخبر وحده لا يكفي.</p><p><b>أهم خطر:</b> {analysis.blockers[0]||analysis.weaknesses[0]||'اكتمال البيانات وتقويم الأحداث لم يُثبت.'}</p></div>
 </details><button className="secondary-btn" aria-expanded={open} aria-controls="decision-evidence" onClick={()=>setOpen(!open)}>لماذا أعطى ميزان هذه النتيجة؟</button>
 {open&&<div id="decision-evidence"><h4>الأدلة والأوزان</h4><p>نقاط القوة: {analysis.strengths.join(' ')||'لم تتوفر أدلة كافية.'}</p><p>نقاط الضعف: {analysis.weaknesses.join(' ')||'عدم ظهور ضعف لا يعني خلو السهم من المخاطر.'}</p><ScoreDetails analysis={analysis}/><h4>مصادر البيانات وحالتها</h4>{report.checks.map((c,i)=><p key={i}><SourceLink href={c.url} retrievedAt={report.retrievedAt}>{c.name}</SourceLink> — {c.state==='ok'?'مكتمل':c.state==='partial'?'جزئي':'غير متاح'}: {c.detail}</p>)}</div>}
 </section>;
}

export function AnalysisChanges({report}:{report:MarketReport}){const c=report.changes;return <section className="panel" aria-label="ماذا تغير منذ آخر تحليل؟"><h3>ماذا تغير منذ آخر تحليل؟</h3>{!c||c.state!=='available'?<p>{c?.reason||'لا توجد مقارنة محفوظة لهذا التحليل حتى الآن.'}</p>:<><p>التحليل السابق: {c.previousAt&&new Date(c.previousAt).toLocaleString('ar-SA')} · الحالي: {c.currentAt&&new Date(c.currentAt).toLocaleString('ar-SA')}</p><p>الخلاصة السابقة: {c.previousConclusion}. الخلاصة الحالية: {c.currentConclusion}.</p>{c.rows?.length?<div className="wide-table finance-table-wrapper"><table className="auto-table finance-table"><thead><tr><th>العامل</th><th>سابقًا</th><th>حاليًا</th><th>الفرق</th><th>السياق والمصادر</th></tr></thead><tbody>{c.rows.map(v=><tr key={v.key}><td><Explain term={v.name}/></td><td>{fmt(v.before)} {v.unit}<small>{v.beforePeriod}</small></td><td>{fmt(v.after)} {v.unit}<small>{v.afterPeriod}</small></td><td>{v.difference===null?'غير قابل للحساب':`${v.difference>0?'+':''}${fmt(v.difference)}`} {v.difference===null?'':v.unit==='%'?'نقطة مئوية':v.unit}</td><td>{v.note||'نفس فترة القياس؛ قد يكون الفرق تحديثًا أو إعادة عرض من المصدر.'}{v.beforeSource&&<p><SourceLink href={v.beforeSource}>المصدر السابق</SourceLink></p>}{v.afterSource&&<p><SourceLink href={v.afterSource}>المصدر الحالي</SourceLink></p>}</td></tr>)}</tbody></table></div>:<p>لم تتغير العوامل المقارنة في البيانات المتاحة.</p>}<p>الثقة السابقة: {c.confidenceBefore?.map(v=>`${v.period}: ${v.confidence}`).join(' · ')||'غير محفوظة'}</p><p>الثقة الحالية: {c.confidenceAfter?.map(v=>`${v.period}: ${v.confidence}`).join(' · ')||'غير متاحة'}</p><p className="reference">الفروق المرصودة لا تثبت علاقة سببية. راجع شرح الأوزان لمعرفة أثر العامل؛ لا نغيّر التحليل القديم بأثر رجعي.</p></>}</section>}

export function CompanyPulse({report}:{report:MarketReport}){
 const items=[...report.news,...(report.official?.events||[]),...(report.corporateActions||[]).map(v=>({title:(v.kind==='split'?'تجزئة أو تجميع الأسهم: ':'توزيع: ')+v.detail,date:v.date,url:report.priceSource,kind:'event' as const}))].filter(v=>Number.isFinite(Date.parse(v.date)));
 const unique=[...new Map(items.map(v=>[v.date+'|'+v.title,v])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,20);
 return <details className="auto-details"><summary>نبض الشركة — الأحداث المسجلة</summary><div className="detail-body">{unique.length?<ol className="company-pulse">{unique.map((v,i)=><li key={i}><time>{v.date}</time><h4>{v.title}</h4><SourceLink href={v.url} publishedAt={v.date} retrievedAt={report.retrievedAt}>المصدر الأصلي</SourceLink><p>الأثر المحتمل غير محسوم؛ يلزم محتوى الإفصاح وسياقه قبل تصنيفه إيجابيًا أو سلبيًا.</p></li>)}</ol>:<p>لم تصل أحداث مؤرخة قابلة للعرض؛ لا يعني ذلك عدم وجود أخبار.</p>}<p className="reference">يعرض حتى 20 حدثًا من البيانات المتاحة، وقد يشمل مواعيد مستقبلية معلنة. ليس تقويمًا مكتملًا لكل إفصاحات الشركة.</p></div></details>;
}
