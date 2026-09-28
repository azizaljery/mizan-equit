import {technical,finite,fmt} from './analysis';
import {automaticAnalysis} from './automatic-analysis';
import {resolveFinancialSources} from './source-resolution';
import type {MarketReport} from './market-data';
import type {LiveQuote} from './live-quote';
import type {tradeScenario} from './trade-scenario';
export function finalDecision(report:MarketReport,scenario:ReturnType<typeof tradeScenario>,quote:LiveQuote|null,now=Date.now()){
 const t=technical(report.prices),prior=technical(report.prices.slice(0,-1)),a=automaticAnalysis(report),p=scenario.levels;
 const average50=t.sma50.at(-1),average200=t.sma200.at(-1),rsi=t.rsi.at(-1);
 const fresh=!!quote&&quote.symbol===report.company.symbol&&quote.currency===report.currency&&finite(quote.price)&&quote.price>0&&now-Date.parse(quote.quoteTime)>=0&&now-Date.parse(quote.quoteTime)<=15*60000;
 const price=fresh?quote!.price:t.last?.close??null;
 const confirmed=!!p&&!!t.last&&finite(prior.resistance)&&t.last.close>prior.resistance&&finite(t.relativeVolume)&&t.relativeVolume>=1.5&&finite(average50)&&finite(average200)&&average50>average200&&finite(rsi)&&rsi>=50&&rsi<=70;
 const rangePct=t.last&&t.last.low>0?(t.last.high/t.last.low-1)*100:null;
 const risky=!!(finite(t.atrPct)&&t.atrPct>12||finite(rangePct)&&rangePct>25||finite(a.annual.equity)&&a.annual.equity<=0);
 const financialWeak=finite(a.annual.netIncome)&&a.annual.netIncome<0&&finite(a.annual.operatingCashFlow)&&a.annual.operatingCashFlow<0;
 const riskLevel=risky?'مرتفع جدًا':financialWeak?'مرتفع':a.risk===null?'غير محسوم':a.riskLabel;
 const buy=!!p&&!scenario.reasons.length&&fresh&&quote!.isOpen&&confirmed&&!risky&&quote!.price>=p.low&&quote!.price<=p.high;
 const evidence=[...(t.last?[`السعر المرجعي ${fmt(price)} ${report.currency}؛ نطاق آخر جلسة ${fmt(t.last.low)}–${fmt(t.last.high)}.`]:[]),...(finite(rsi)?[`RSI = ${fmt(rsi)}؛ ${rsi>70?'زخم مرتفع مع خطر تراجع بعد الاندفاع':rsi<40?'زخم ضعيف':'الزخم يحتاج تأكيد الاتجاه والحجم'}.`]:[]),...(finite(t.relativeVolume)?[`حجم نسبي ${fmt(t.relativeVolume)}× من متوسطه؛ لا يدل وحده على جودة الشركة.`]:[]),...(finite(a.annual.netIncome)?[`صافي الربح السنوي ${fmt(a.annual.netIncome)} ${a.currency} للفترة ${a.annualDate}.`]:[]),...(finite(a.annual.operatingCashFlow)?[`التدفق التشغيلي ${fmt(a.annual.operatingCashFlow)} ${a.currency} للفترة ${a.annualDate}.`]:[])];
 const explanation=buy?'توافقت منطقة الدخول والاتجاه والزخم والحجم. التوصية للمضاربة وبثقة محدودة وفق البيانات المتاحة، وليست اعتمادًا لجودة الاستثمار طويل الأجل.':risky?'التذبذب أو اتساع الجلسة أو ضعف حقوق الملكية يجعل مطاردة السعر غير مناسبة؛ نفضل الانتظار لاستقرار الحركة.':scenario.reasons.length?scenario.reasons.join(' '):!fresh?'نفضل الانتظار لتحديث السعر؛ تستمر القراءة بالمعلومات المتاحة.':!confirmed?'لم تجتمع إشارات الاتجاه والاختراق والحجم والزخم؛ نفضل الانتظار.':!quote?.isOpen?'نعيد تقييم التنفيذ أثناء الجلسة.':'السعر خارج منطقة الدخول المحسوبة؛ نفضل الانتظار بدل مطاردته.';
 const checks=[
  {name:'صلاحية مستويات التنفيذ',ok:!!p&&!scenario.reasons.length,detail:scenario.reasons.join(' ')||'الدعم والمقاومة والتذبذب قابلة للحساب من السلسلة المقبولة.'},
  {name:'سعر مطابق وحديث',ok:fresh,detail:fresh?'الرمز والعملة مطابقان، ووقت السعر لا يتجاوز 15 دقيقة.':'يلزم سعر مطابق لا يتجاوز 15 دقيقة؛ السعر اليومي المرجعي ليس سعر تنفيذ حيًا.'},
  {name:'الجلسة مفتوحة',ok:fresh&&quote!.isOpen,detail:'الشراء الحالي يشترط فتح الجلسة وحداثة السعر معًا.'},
  {name:'الاتجاه والاختراق والزخم والحجم',ok:confirmed,detail:'اختراق المقاومة السابقة وحجم نسبي ≥1.5 ومتوسط 50 أعلى من 200 وRSI بين 50 و70.'},
  {name:'السعر داخل منطقة الدخول',ok:!!p&&fresh&&quote!.price>=p.low&&quote!.price<=p.high,detail:'لا تتحول الأهداف الحسابية إلى دعوة لمطاردة السعر خارج منطقة الدخول.'},
  {name:'عدم تحقق إشارة الخطر الشديد',ok:!risky,detail:'هذا الفحص محدود بالتذبذب واتساع الجلسة وحقوق الملكية المتاحة، وليس إثباتًا لانخفاض جميع المخاطر.'},
 ];
 return {version:'private-decision-evidence-v2',evaluatedAt:new Date(now).toISOString(),checks,quoteUsable:fresh,priceSource:fresh?quote!.source:report.priceSource,buy,buyPrice:buy?quote!.price:null,sellPrice:fresh&&p?p.stop:null,explanation,evidence,riskLevel,provisional:true,confidence:'منخفضة',price,priceTime:fresh?quote!.quoteTime:t.last?.date||null,financialView:financialWeak?'الربح والتدفق التشغيلي سلبيان؛ لا نفضل الاحتفاظ الاستثماري بناء على هذه الماليات وحدها.':'الحكم الاستثماري يعتمد على اكتمال الماليات والتقييم والنمو.',disclaimer:'توصية تحليلية أولية غير مضمونة، مبنية على المصادر المتاحة وقت القراءة؛ قد تتغير مع السعر أو المعلومات الجديدة.'};
}

/** Presentation of existing analysis only: no alternative scoring or source selection. */
export function privateDecisionEvidence(report:MarketReport){
 const a=automaticAnalysis(report),resolved=resolveFinancialSources(report);
 const labels:Record<string,string>={revenue:'الإيرادات',netIncome:'صافي الربح',operatingCashFlow:'التدفق التشغيلي',equity:'حقوق الملكية',debt:'الدين',cash:'النقد',ebitda:'EBITDA',operatingIncome:'الربح التشغيلي'};
 const facts=resolved.facts.filter(f=>f.period==='annual'&&f.date===a.annualDate&&f.currency===a.currency&&labels[f.key]).slice(0,8).map(f=>({name:labels[f.key],value:f.value,currency:f.currency,date:f.date,publishedAt:f.publishedAt||null,source:f.source}));
 return {dataQuality:report.forecast?.dataQuality||'غير متحققة',coverage:a.coverage,financialPeriod:a.annualDate||null,axes:a.axes.map(x=>({name:x.name,value:x.value,weight:x.weight,note:x.note})),
  strengths:a.strengths.slice(0,6),weaknesses:a.weaknesses.slice(0,6),missing:a.missing.slice(0,12),facts,
  comparisons:resolved.comparisons.filter(c=>c.disagreed).slice(0,12).map(c=>({name:labels[c.key]||c.key,date:c.date,currency:c.currency,value:c.value,alternativeValue:c.providerValue,source:c.source,alternativeSource:c.alternativeSource,excluded:c.excluded,reason:c.selectionReason})),
  sources:report.checks.slice(0,20).map(c=>({...c})),
  observations:(report.sourceLayer?.observations||[]).slice(0,20).map(o=>({type:o.dataType,state:o.state,source:o.provenance?.source||null,url:o.provenance?.url||null,retrievedAt:o.provenance?.retrievedAt||null,sourceTime:o.provenance?.sourceTime||null,official:o.provenance?.official??null,fallbackUsed:o.fallbackUsed,quality:o.quality.grade})),
  warnings:report.warnings.slice(0,12),historicalNote:'القياس في التوقعات أدناه يخص اتجاه التوقع لنفس السوق والمدة ونسخة النموذج؛ ليس سجل ربحية لقرار الشراء أو ضمانًا له. لا نغيّر أوزان القرار تلقائيًا من نتائج الاختبار.',
  shariaNote:'التوافق الشرعي مستقل عن جودة الاستثمار؛ لا نعدّه متحققًا دون مصدر مؤرخ أو احتساب موثق.'};
}
