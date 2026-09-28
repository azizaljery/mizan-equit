import {automaticAnalysis} from './automatic-analysis';
import {ageDays,finite,technical} from './analysis';
import type {MarketReport} from './market-data';
import {RegimeEngine} from './regime-engine';
import {extendedAnalysis} from './extended-analysis';
import type {CashFlowQualityAssessment} from './decision-room';
export type {MarketRegimeType} from './regime-engine';
function buildScenario(report:MarketReport){
 const a=automaticAnalysis(report),bar=report.prices.at(-1),prior=technical(report.prices.slice(0,-1));
 const atr=a.tech.atr.at(-1),support=prior.support,resistance=prior.resistance;
 const reasons:string[]=[];
 const marketRegime=RegimeEngine.detect(report.prices.map(p=>p.close));
 if(!marketRegime.available)reasons.push(marketRegime.reason);
 else if(marketRegime.currentRegime==='VOLATILITY_SHOCK'||marketRegime.structuralBreakDetected)reasons.push('الانتظار: رصدت القواعد صدمة تقلب محتملة؛ ليست احتمالًا مُعايرًا لانكسار هيكلي.');
 else if(marketRegime.currentRegime!=='BULL_TREND')reasons.push('حالة السوق وصفية عرضية أو غير صاعدة؛ ننتظر توافق الاتجاه.');
 if(!bar||ageDays(report.asOf,bar.date)>3)reasons.push('قرار الانتظار مبني على أن مرجع السعر الحالي يحتاج تحديثًا.');
 if(!report.checks.some(x=>x.name==='الأسعار اليومية'&&x.state==='ok'))reasons.push('نعتمد المعلومات المتاحة؛ لم تصل سلسلة أسعار موثقة لبناء مستويات تنفيذ.');
 if(!finite(atr)||atr<=0||!finite(support)||!finite(resistance)||support<=0||resistance<=support)reasons.push('نحتاج تذبذبًا ودعمًا ومقاومة قابلة للحساب لتحديد أسعار الدخول والخروج.');
 const incomplete=[...a.missing,...a.blockers.filter(x=>!/سعر|جلسة/.test(x)),...(a.sourceComparisons.some(x=>x.disagreed)?['اعتمدنا المصدر الأعلى أولوية عند اختلاف الأرقام؛ تبقى القيم الأخرى في تفاصيل المصادر.']:[]),...(!report.forecast?.rows.some((r:any)=>r.calibration?.advantage)?['الدقة التاريخية لهذا السيناريو لم تثبت بعينة كافية؛ هذا لا يمنع التقييم الأولي.']:[])];
 if(reasons.length)return {status:'تقييم أولي — الانتظار',reasons,incomplete,levels:null,confidence:'منخفضة'};
 // Breakout reference uses completed bars before the latest session.
 const low=resistance!+.1*atr!,high=resistance!+.35*atr!,stop=resistance!-.8*atr!;
 if(stop<=0||stop>=low)return {status:'تقييم أولي — الانتظار',reasons:['المخاطرة المحسوبة لا تعطي خطة دخول مناسبة الآن.'],incomplete,levels:null,confidence:'منخفضة'};
 const risk=high-stop;
 return {status:'خطة مضاربة أولية مشروطة',reasons:[],incomplete,marketRegime,confidence:'منخفضة — تحليل أولي، وليست نسبة نجاح',levels:{low,high,stop,target1:high+1.8*risk,target2:high+3*risk,support:support!,resistance:resistance!,asOf:bar!.date},conditions:['تصنيف الاتجاه الصاعد وصفي ولا يثبت انخفاض المخاطر.','اختراق المقاومة مع حجم نسبي 1.5 أو أكثر وتوافق الاتجاه والزخم.','السعر داخل منطقة الدخول؛ لا نطارد القفزة بعد تجاوزها.','التقييم مبني على المتاح؛ الماليات والشرعية والأحداث الناقصة ليست حقائق إيجابية.'],invalidation:'إغلاق دون المقاومة يضعف الاختراق؛ وقف الخطر أسفل المقاومة بمقدار 0.8 ATR. الفجوات قد تتجاوز الوقف.'};
}

export interface TradePlan {
 status:'active'|'standby'|'abstain';
 action:'شراء مشروط'|'انتظار وتحفظ'|'امتناع إحصائي';
 currency:string;
 entryZone:{min:number;max:number;optimal:number}|null;
 stopLoss:{price:number|null;percentage:number|null;reason:string};
 targets:{primary:TradeTarget;secondary:TradeTarget}|null;
 positionSizing:{recommendedFraction:number|null;portfolioAllocationText:string;riskCapitalPerTradePercent:number|null};
 liquidityConfirmation:{rvol:number|null;isConfirmed:boolean;note:string};
 executionNotes:string[];
}
interface TradeTarget {price:number;gainPercentage:number;rrRatio:number;actionText:string}

/** Presentation of the existing anchored plan; it never authorizes a live buy. */
export function tradeScenario(report:MarketReport){
 const result=buildScenario(report),p=result.levels;
 const volumes=report.prices.slice(-21).map(v=>v.volume);
 const usable=volumes.length===21&&volumes.every(v=>finite(v)&&v>=0);
 const average=usable?volumes.slice(0,-1).reduce((s,v)=>s+v,0)/20:0;
 const rvol=usable&&average>0?volumes[20]/average:null;
 const confirmed=rvol!==null&&rvol>=1.5;
 const reference=p?.high;
 const risk=p&&reference?reference-p.stop:null;
 const target=(price:number,actionText:string):TradeTarget=>({price,gainPercentage:(price/reference!-1)*100,rrRatio:(price-reference!)/risk!,actionText});
 const executionPlan:TradePlan={
  status:'standby',action:'انتظار وتحفظ',currency:report.currency,
  entryZone:p?{min:p.low,max:p.high,optimal:p.high}:null,
  stopLoss:{price:p?.stop??null,percentage:p&&risk?risk/p.high*100:null,reason:result.invalidation||result.reasons.join(' ')},
  targets:p?{primary:target(p.target1,'جني جزء من الكمية وفق خطة التنفيذ'),secondary:target(p.target2,'إعادة تقييم المتبقي أو وقف متحرك')}:null,
  positionSizing:{recommendedFraction:null,portfolioAllocationText:'غير متاح — يلزم سجل صفقات خارج العينة لحساب كيلي',riskCapitalPerTradePercent:null},
  liquidityConfirmation:{rvol,isConfirmed:confirmed,note:rvol===null?'يلزم حجم الجلسة و20 جلسة سابقة صالحة.':confirmed?'الحجم النسبي بلغ عتبة 1.5؛ بقية شروط القرار مستقلة.':'الحجم النسبي دون عتبة التأكيد 1.5.'},
  executionNotes:[...result.reasons,'العائد والمخاطرة محسوبان من أعلى منطقة الدخول قبل التكاليف.','المستويات مشروطة؛ الفجوات والانزلاق قد يتجاوزان الوقف، ولا توجد صفقة خالية من المخاطر.'],
 };
 const x=extendedAnalysis(report),fcf=x.components.find(c=>c.name==='التدفق الحر')?.value;
 const cashFlowQuality:CashFlowQualityAssessment={fcfYieldPercent:finite(fcf)&&finite(x.a.cap)&&x.a.cap>0&&x.a.currency===report.currency?fcf/x.a.cap*100:null,earningsQualityScore:x.earningsQuality};
 return {...result,executionPlan,cashFlowQuality};
}
