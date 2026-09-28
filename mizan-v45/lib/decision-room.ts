import {resolveFinancialSources} from './source-resolution';
import {automaticAnalysis} from './automatic-analysis';
import {extendedAnalysis} from './extended-analysis';
import {ageDays} from './analysis';
import type {MarketReport} from './market-data';
import {RegimeEngine} from './regime-engine';
export type DecisionRoomOutput=ReturnType<typeof decisionRoom>;
export interface CashFlowQualityAssessment {
 fcfYieldPercent:number|null;
 earningsQualityScore:string;
}

export const DECISION_VERSION='decision-evidence-1';
const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v:number)=>Math.max(0,Math.min(100,v));
export function decisionRoom(report:MarketReport){
 const a=automaticAnalysis(report),x=extendedAnalysis(report);
 const financial=a.axes.find(v=>v.name==='القوة المالية')?.value??null;
 const known=x.components.filter(v=>valid(v.value));
 const earnings=known.length>=4?known.filter(v=>v.healthy).length/known.length*100:null;
 const factors=[
  {name:'القوة المالية',value:financial,weight:40,reason:'المحور المالي الموجود: 100 ناقص متوسط مخاطر عوامله. لا نطبّق النموذج العام على البنوك والصناديق.'},
  {name:'جودة الأرباح',value:earnings,weight:35,reason:`نسبة الفحوص السليمة من ${known.length} فحوص متاحة؛ يلزم 4 من 6 على الأقل. ليست احتمال نجاح الاستثمار.`},
  {name:'نمو الإيرادات',value:valid(a.cagrRevenue)?clamp(50+3*a.cagrRevenue):null,weight:25,reason:'50 + ثلاثة أمثال نسبة النمو السنوي المركب، محصورة بين 0 و100. قاعدة وصفية معلنة وليست نموذج عائد مُعاير.'}
 ];
 const companyQuality=factors.every(v=>valid(v.value))&&!a.specialized&&!!a.annualDate&&ageDays(report.asOf,a.annualDate)<=550&&!a.sourceComparisons.some(v=>v.conflict)?Math.round(factors.reduce((s,v)=>s+v.value!*v.weight/100,0)):null;
 // A price score needs the existing multi-method valuation, not one multiple alone.
 const priceSuitability=x.fair&&valid(a.price)&&a.price>0?Math.round(clamp(50+100*(x.fair.base-a.price)/x.fair.base)):null;
 const s50=a.tech.sma50.at(-1),s200=a.tech.sma200.at(-1);
 const trend=valid(a.price)&&valid(s50)&&valid(s200)?a.price>s50&&s50>s200?'صاعد':a.price<s50&&s50<s200?'هابط':'مختلط / محايد':'غير مكتمل';
 const marketRegime=RegimeEngine.detect(report.prices.map(p=>p.close));
 return {a,x,factors,companyQuality,priceSuitability,trend,marketRegime,version:DECISION_VERSION};
}

type Metric={key:string;name:string;value:number|null;unit:string;period:string;source:string};
export type DecisionBaseline={version:string;symbol:string;currency:string;createdAt:string;quoteTime:string|null;priceDate:string;model:string;metrics:Metric[];conclusion:string;confidence:{period:string;confidence:string}[]};
export type DecisionChanges={state:'first'|'available'|'unavailable'|'private'|'incomparable';reason?:string;previousAt?:string;currentAt?:string;previousConclusion?:string;currentConclusion?:string;confidenceBefore?:DecisionBaseline['confidence'];confidenceAfter?:DecisionBaseline['confidence'];rows?:{key:string;name:string;before:number|null;after:number|null;difference:number|null;unit:string;beforePeriod:string;afterPeriod:string;beforeSource:string;afterSource:string;note?:string}[]};
export function publicBaselineEligible(report:MarketReport){return report.mode==='current'&&!report.checks.some(v=>v.name.startsWith('ملف المستخدم'))&&!report.facts.some(v=>!/^https?:\/\//.test(v.source));}
export function decisionBaseline(report:MarketReport,createdAt:string):DecisionBaseline{
 const {a,x,companyQuality,priceSuitability}=decisionRoom(report);
 const selectedFacts=resolveFinancialSources(report).facts;
 const source=(key:string)=>selectedFacts.find(v=>v.key===key&&v.date===a.annualDate&&v.period==='annual')?.source||'';
 const metric=(key:string,name:string,value:number|null|undefined,unit:string,period:string,src:string):Metric=>({key,name,value:valid(value)?value:null,unit,period,source:src});
 return {version:DECISION_VERSION,symbol:report.company.symbol,currency:report.currency,createdAt,quoteTime:report.quoteTime,priceDate:report.prices.at(-1)?.date||'',model:report.forecast?.version||'',conclusion:a.opinion,confidence:(report.forecast?.rows||[]).map(v=>({period:v.period,confidence:v.confidence})),metrics:[
  metric('price','سعر التحليل',a.price,report.currency,report.quoteTime||report.asOf,report.priceSource),
  metric('quality','جودة الشركة',companyQuality,'/100',a.annualDate,''),
  metric('suitability','ملاءمة السعر',priceSuitability,'/100',report.asOf,''),
  metric('revenueGrowth','نمو الإيرادات المركب',a.cagrRevenue,'%',a.annualDate,source('revenue')),
  metric('operatingMargin','الهامش التشغيلي',a.operatingMargin,'%',a.annualDate,source('operatingIncome')),
  metric('cashConversion','التدفق التشغيلي / الربح',a.cashConversion,'×',a.annualDate,source('operatingCashFlow')),
  metric('debt','صافي الدين / EBITDA',a.netDebtEbitda,'×',a.annualDate,source('debt')),
  metric('pe','مكرر الربحية',a.pe,'×',a.ttmDate,report.priceSource),
  metric('volume','الحجم النسبي',a.tech.relativeVolume,'×',report.asOf,report.priceSource),
  metric('support','الدعم',a.tech.support,report.currency,report.asOf,report.priceSource),
  metric('dataCoverage','تغطية فحوص البيانات',x.coverage,'%',report.asOf,'')
 ]};
}
export function compareDecisionBaselines(before:DecisionBaseline,after:DecisionBaseline,actions:NonNullable<MarketReport['corporateActions']>=[]):DecisionChanges{
 if(before.version!==after.version||before.symbol!==after.symbol||before.currency!==after.currency||before.createdAt>after.createdAt)return {state:'incomparable',reason:'اختلفت الهوية أو العملة أو طريقة الحساب أو ترتيب الوقت؛ لم نحسب فروقًا مضللة.'};
 const split=actions.some(v=>v.kind==='split'&&v.date>before.priceDate&&v.date<=after.priceDate);
 const rows=after.metrics.flatMap(v=>{const old=before.metrics.find(p=>p.key===v.key);if(!old||old.unit!==v.unit)return [];const comparable=valid(old.value)&&valid(v.value)&&!(split&&['price','support'].includes(v.key));
  if(old.value===v.value&&old.period===v.period)return [];
  return [{key:v.key,name:v.name,before:old.value,after:v.value,difference:comparable?v.value!-old.value!:null,unit:v.unit,beforePeriod:old.period,afterPeriod:v.period,beforeSource:old.source,afterSource:v.source,note:split&&['price','support'].includes(v.key)?'حدث تغيير في عدد الأسهم؛ يلزم توحيد وحدات السعر قبل المقارنة.':!comparable?'أحد الرقمين غير متاح؛ لا يُعامل كصفر.':old.period!==v.period?'اختلفت فترة أو لحظة القياس؛ راجع التاريخين.':undefined}];
 });
 return {state:'available',previousAt:before.createdAt,currentAt:after.createdAt,previousConclusion:before.conclusion,currentConclusion:after.conclusion,confidenceBefore:before.confidence,confidenceAfter:after.confidence,rows};
}
