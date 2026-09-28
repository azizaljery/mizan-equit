'use client';
import {SectionHeading} from './managed-sections';
import {useMemo} from 'react';
import type {MarketReport} from '@/lib/market-data';
import type {LiveQuote} from '@/lib/live-quote';
import type {forecasts} from '@/lib/research-model';
import {HORIZONS} from '@/lib/forecast-horizons';
import {fmt} from '@/lib/analysis';
import {SourceLink} from './source-link';
import {Explain} from './explain';
export function completeForecastRows(result:any){return HORIZONS.map(h=>result?.rows?.find((r:any)=>r.sessions===h.sessions)||{period:h.name,sessions:h.sessions,available:false,direction:'غير متاح',price:result?.price??null,range:null,change:null,confidence:'منخفض',riskLevel:'غير متحقق',coverage:0,reasons:['لم تُحفظ هذه المدة في هذا التحليل؛ اطلب تحليلًا جديدًا.'],risks:[],basis:[],contributions:[]});}
const range=(values:any)=>Array.isArray(values)?values.map((v:number)=>fmt(v)).join(' – '):'غير متاح';
// عمداً بلا حساب هنا: forecasts() خادمية فقط (recordAnalysis في research-service.ts
// يضبط report.forecast قبل وصول أي تقرير للعميل). مكوّن العميل يعرض نتيجة
// جاهزة أو يمتنع صراحة — لا يُعيد حساب الأوزان بمدخلات محلية (Date.now() في
// المتصفح ليس مرجع الوقت الموثوق) ولا يستورد lib/research-model.ts وقت التشغيل،
// فلا تدخل معاملات الأوزان حزمة المتصفح إطلاقاً.
export function Forecasts({report,quote=null,data}:{report?:MarketReport|null;quote?:LiveQuote|null;data?:ReturnType<typeof forecasts>|null}){
 void quote; // يبقى في التوقيع لتوافق الاستدعاءات الحالية؛ غير مستخدم بعد إزالة الحساب المحلي.
 const result=useMemo(()=>data||report?.forecast||null,[report,data]);
 if(!result)return <UnavailableForecasts reason="التوقعات غير متاحة لعدم كفاية البيانات."/>;
 const rows=completeForecastRows(result),time=(result as any).createdAt||result.retrievedAt;
 return <section className="panel forecast-panel" aria-label="التوقعات المستقبلية"><SectionHeading as="h3">التوقعات المستقبلية</SectionHeading>
 <p className="reference">السعر المرجعي {fmt(result.price)} {result.currency} · وقت السعر {result.priceTime||'غير متاح'} · جودة البيانات {result.dataQuality||'غير متحققة'}</p>
 <p className="reference">اليومي للجلسة التالية · قد يتأخر السعر حتى 15 دقيقة</p>
 {(result.dataWarnings||[]).filter((s:string)=>/متعارض|قديم جدًا|غير صالحة/.test(s)).map((s:string)=><p role="alert" className="notice error" key={s}>{s}</p>)}
 <div className="forecast-grid">{rows.map((row:any)=><article className="forecast-card" key={row.sessions}>
 <h4>{row.period}</h4>{row.id&&(result as any).recorded&&<a href={'/tests?forecast='+encodeURIComponent(row.id)}>اختبر هذا التوقع</a>}
 <dl>
 <div><dt>الاتجاه المتوقع</dt><dd className={row.direction==='صاعد'?'positive':row.direction==='هابط'?'negative':''}>{row.available?row.direction:'غير مقدّر'}</dd></div>
 <div><dt>نطاق سعر نهاية المدة</dt><dd dir="ltr">{row.available&&row.range?range(row.range)+' '+result.currency:'غير متاح'}</dd></div>
 <div><dt>السعر المركزي المتوقع</dt><dd>{row.available&&Number.isFinite(row.predictedPrice)?fmt(row.predictedPrice)+' '+result.currency:'غير متاح'}</dd></div>
 <div><dt>الحركة المتوقعة</dt><dd>{row.available&&Number.isFinite(row.expectedChangePct)?fmt(row.expectedChangePct)+'%':'غير متاحة'}</dd></div>
 <div><dt>درجة الثقة</dt><dd><Explain term="درجة الثقة" value={row.confidence}/></dd></div>
 <div><dt>المخاطر</dt><dd>{row.riskLevel||'غير متحقق'}</dd></div>
 </dl>
 {row.modelCondition?.abstainReason&&<p role="status" className="notice error">{row.modelCondition.abstainReason}</p>}
 <details><summary>أدلة النموذج وشروط الإبطال — {row.period}</summary><div className="forecast-detail">
 <p>الأساسي: {row.scenarios?range(row.scenarios.base):'غير متاح'} · الإيجابي: {row.scenarios?range(row.scenarios.positive):'غير متاح'} · السلبي: {row.scenarios?range(row.scenarios.negative):'غير متاح'}</p>
 {!row.available&&<p>سبب عدم إصدار نطاق: {(row.reasons||[]).join(' ')} السيناريوهات الوصفية شروط متابعة، وليست نطاقات سعرية محسوبة.</p>}
 <p>النطاق تقديري لسعر نهاية المدة، وليس ضمانًا لمسار السعر داخلها. السعر المركزي ناتج النموذج عند الإصدار، ولا يُستنتج من وسط نطاق قديم.</p><p>السعر وقت التوقع {fmt(row.price)} {result.currency} · التغير المحتمل {range(row.change)}%</p><p>وقت الإصدار {time} · جودة البيانات {row.dataQuality||result.dataQuality}</p>
 {row.window&&<><p>بداية التوقع: {row.window.startAt||row.window.anchorDate} · {row.window.definition}</p><p>نهاية تقديرية: {row.window.estimatedEndAt||'لم يُربط تقويم السوق'} · {row.window.timezone}</p><p>{row.window.deadlineNote}</p><p>{row.window.successRule}</p></>}<h4>أسباب التوقع</h4><ul>{(row.basis||[]).map((s:string,i:number)=><li key={i}>{s}</li>)}</ul>{row.available&&<p>{(row.reasons||[]).join(' ')}</p>}
 <h4>ما الذي يبطل التوقع؟</h4><ul>{(row.invalidation||row.risks||[]).slice(0,3).map((s:string,i:number)=><li key={i}>{s}</li>)}</ul>
 {row.modelCondition&&<><h4>حالة السوق والتدفق الحر والسيولة</h4>
 <p>التدفق الحر {fmt(row.modelCondition.cashFlow.freeCashFlow)} {result.currency} · السنة {row.modelCondition.cashFlow.periodEnd||'غير متحققة'} · عائده {row.modelCondition.cashFlow.yieldPercent===null?'غير مقدّر':fmt(row.modelCondition.cashFlow.yieldPercent)+'%'}</p>
 <ul>{row.modelCondition.notes.map((n:string,i:number)=><li key={i}>{n}</li>)}</ul>
 {row.modelCondition.positiveTiltMultiplier<1&&<p>يُخفّض الميل الصاعد إلى 60% من قيمته عند ضعف الحجم النسبي؛ هذه قاعدة تحفّظ وليست دقة مقاسة.</p>}
 <ul>{row.modelCondition.cashFlow.sources.map((s:any,i:number)=><li key={i}><SourceLink href={s.source} period={s.date}>{s.key} · نشر {s.publishedAt}</SourceLink></li>)}</ul></>}
 <h4>المخاطر والنواقص</h4>{!row.risks?.length&&<p>لم تُحفظ تفاصيل المخاطر في هذا السجل؛ أعد التحليل لقراءة جديدة.</p>}<ul>{(row.risks||[]).map((s:string,i:number)=><li key={i}>{s}</li>)}</ul><h4>المحفزات</h4><ul>{(row.catalysts||[]).map((s:string,i:number)=><li key={i}>{s}</li>)}</ul>
 <p>احتمال السيناريو: {row.probability?Object.entries(row.probability).map(([k,v])=>k+' '+fmt(v as number)+'%').join(' · '):'غير معاير؛ لا نسبة افتراضية'}</p>
 <p>الدقة التاريخية: {row.calibration?.sample>=30&&row.historicalAccuracy!=null?fmt(row.historicalAccuracy)+'% · عينة '+row.calibration.sample:'لم تتكون عينة كافية بعد'}</p>
 <h4>الأوزان الفعلية</h4><ul>{(row.contributions||[]).map((c:any)=><li key={c.name}>{c.name}: وزن {fmt(c.weight,1)}% · أثر {c.impact===null?'غير متحقق':fmt(c.impact)}</li>)}</ul><p>تغطية الأدلة {fmt(row.coverage,0)}% · {row.sessions} جلسات · {row.sample??0} عوائد تاريخية · {row.independent??0} فترات غير متداخلة</p>
 {row.rangeCheck&&<p>تذبذب المدة {fmt(row.rangeCheck.horizonVolatility)}% · فحص الشذوذ {row.rangeCheck.maxSigma} · مرجع السوق {row.rangeCheck.market||'غير متاح'} · القطاع {row.rangeCheck.sector||'غير متاح'}</p>}
 </div></details></article>)}</div>
 <details><summary>ⓘ منهج التوقع والمصادر وحدود الاستخدام</summary><p>النطاق تقدير وليس توصية مباشرة أو ضمانًا للسعر. الثقة الحالية واحتمال السيناريو والدقة التاريخية مقاييس منفصلة.</p><p>{result.method}</p><p>وقت الإصدار {time} · نسخة {result.version} · {(result as any).recorded?'حُفظ في السجل':'لم يُؤكد حفظه في السجل'}</p><p>{(result.dataWarnings||[]).join(' ')}</p><ul>{(result.factors||[]).map(f=><li key={f.key}>{f.name}: {f.detail} · {f.date} · <SourceLink href={f.source} period={f.date} retrievedAt={result.retrievedAt}>المصدر</SourceLink></li>)}</ul></details>
 </section>;
}
export function UnavailableForecasts({reason}:{reason:string}){return <Forecasts data={{price:null,currency:'',priceTime:'',retrievedAt:'',version:'',rows:HORIZONS.map(h=>({period:h.name,sessions:h.sessions,available:false,direction:'غير متاح',confidence:'غير محددة',riskLevel:'غير متحقق',reasons:[reason]})),dataQuality:'غير صالحة',dataWarnings:[reason],factors:[],method:'لم يصدر توقع لأن بيانات التحليل لم تصل.'} as any}/>}
