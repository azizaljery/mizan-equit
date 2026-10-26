import {directionOf,EVALUATION_POLICY} from './forecast-metrics';
import {scenarioCenter,inspectScenarioRange,forecastDiagnostic,type ForecastBlock} from './forecast-diagnostics';
import {DEFAULT_SETTINGS,adjustedWeights,type SiteSettings} from './site-settings';
import {forecastWindow} from './forecast-window';
import {automaticAnalysis} from './automatic-analysis';
import {finite,ageDays,fmt,technical} from './analysis';
import type {MarketReport} from './market-data';
import type {LiveQuote} from './live-quote';
import {resolveFinancialSources} from './source-resolution';
import {forecastConditions,horizonCondition} from './forecast-conditions';
import {calibrateForecastRange,CONFORMAL_RANGE_CALIBRATION_ENABLED,type RangeCalibration} from './conformal-calibration';
export {HORIZONS,type ForecastHorizon} from './forecast-horizons';
import {HORIZONS,type ForecastHorizon} from './forecast-horizons';
export type Horizon='short'|'medium'|'long';
export const MODEL_VERSION='mizan-scenarios-7-shock-warning-1';
export type ResearchModelOutput=ReturnType<typeof forecasts>;
const clamp=(v:number)=>Math.max(-1,Math.min(1,v));
const avg=(v:(number|null)[])=>{const x=v.filter(finite);return x.length?x.reduce((s,n)=>s+n,0)/x.length:null};
const norm=(v:number|null|undefined,scale=1)=>finite(v)?clamp(v/scale):null;
export type ResearchFactor={key:string;name:string;signal:number|null;detail:string;source:string;date:string};
export const RESEARCH_WEIGHTS:Record<Horizon,Record<string,number>>={
 short:{growth:3,quality:4,debt:3,valuation:3,trend:20,momentum:14,liquidity:18,risk:10,levels:10,market:5,sector:4,events:6},
 medium:{growth:15,quality:15,debt:10,valuation:15,trend:10,momentum:7,liquidity:8,risk:7,levels:4,market:4,sector:3,events:2},
 long:{growth:20,quality:22,debt:15,valuation:18,trend:5,momentum:2,liquidity:4,risk:5,levels:1,market:3,sector:3,events:2}
};
export function forecastWeights(sessions:number):Record<string,number>{
 if(sessions===1)return {growth:0,quality:1,debt:0,valuation:1,trend:22,momentum:20,liquidity:24,risk:10,levels:8,market:10,sector:2,events:2};
 if(sessions<=5)return RESEARCH_WEIGHTS.short;
 if(sessions<=21)return {growth:6,quality:7,debt:4,valuation:9,trend:16,momentum:10,liquidity:16,risk:9,levels:7,market:5,sector:4,events:7};
 if(sessions<=63)return RESEARCH_WEIGHTS.medium;
 if(sessions<=126)return Object.fromEntries(Object.keys(RESEARCH_WEIGHTS.medium).map(k=>[k,(RESEARCH_WEIGHTS.medium[k]+RESEARCH_WEIGHTS.long[k])/2]));
 return RESEARCH_WEIGHTS.long;
}
export function researchFactors(report:MarketReport,now=Date.now()){
 const a=automaticAnalysis(report);
 const conditioning=forecastConditions(report,now);
 report={...report,facts:resolveFinancialSources(report).facts};
 const t=a.tech,price=a.price,source=report.priceSource,financial=report.facts.find(f=>f.key==='revenue')?.source||source,date=t.last?.date||'';
 const factors:ResearchFactor[]=[];const add=(key:string,name:string,signal:number|null,detail:string,url=source,asOf=date)=>factors.push({key,name,signal,detail,source:url,date:asOf});
 const annualFresh=!!a.annualDate&&ageDays(report.asOf,a.annualDate)<=550&&(!a.latestQuarterDate||ageDays(report.asOf,a.latestQuarterDate)<=210);
 const fsignal=(v:number|null)=>annualFresh&&!a.specialized?v:null;
 const incomeDates=report.facts.filter(f=>f.key==='netIncome'&&f.period==='annual'&&f.currency===a.currency).sort((x,y)=>x.date.localeCompare(y.date));
 const lastIncome=incomeDates.at(-1),priorIncome=incomeDates.filter(f=>lastIncome&&f.date<lastIncome.date).at(-1);
 const incomeGrowth=lastIncome&&priorIncome&&priorIncome.value>0&&lastIncome.value>0?(lastIncome.value/priorIncome.value-1)*100:null;
 add('growth','النمو',fsignal(avg([norm(a.cagrRevenue,25),norm(a.cagrCfo,25),norm(incomeGrowth,30)])),`نمو الإيرادات ${fmt(a.cagrRevenue)}% والتدفق التشغيلي ${fmt(a.cagrCfo)}%؛ نمو الربح السنوي ${fmt(incomeGrowth)}%.`,financial,a.annualDate);
 const margins=a.history.map(h=>h.operatingMargin).filter(finite),stability=margins.length>=3?norm(15-(Math.max(...margins)-Math.min(...margins)),15):null;
 const fcf=conditioning.cashFlow,fcfSignal=fcf.periodEnd===a.annualDate?fcf.qualitySignal:null;
 add('quality','الربحية وجودة التدفق',fsignal(avg([norm(a.cashConversion===null?null:a.cashConversion-1),norm(a.operatingMargin,25),stability,finite(a.annual.operatingCashFlow)?(a.annual.operatingCashFlow>0?1:-1):null,fcfSignal])),`CFO/صافي الربح ${fmt(a.cashConversion)}؛ الهامش التشغيلي ${fmt(a.operatingMargin)}%؛ ${margins.length} سنوات هوامش. التدفق الحر ${fmt(fcf.freeCashFlow)} ${report.currency}؛ أثره ضمن الجودة ${fcfSignal===null?'غير متحقق':'وصفي ومحدود بوزن الجودة'}.`,financial,a.annualDate);
 add('debt','القدرة على خدمة الدين',fsignal(avg([norm(a.netDebtEbitda===null?null:3-a.netDebtEbitda,3),norm(a.interestCoverage===null?null:a.interestCoverage-3,5)])),`صافي الدين/EBITDA ${fmt(a.netDebtEbitda)}؛ تغطية التمويل ${fmt(a.interestCoverage)}.`,financial,a.annualDate);
 add('valuation','التقييم مقابل النظراء',fsignal(a.pe&&a.peerPE&&a.peerCount>=2?clamp((a.peerPE/a.pe-1)/.5):null),`P/E ${fmt(a.pe)} مقابل ${fmt(a.peerPE)} لعينة ${a.peerCount} نظراء؛ لا تمثل القطاع كله.`,financial,a.ttmDate);
 const s50=t.sma50.at(-1),s200=t.sma200.at(-1),rsi=t.rsi.at(-1),macd=t.macdHist.at(-1);
 add('trend','اتجاه السعر',price&&finite(s50)&&finite(s200)?avg([norm(price/s50-1,.15),norm(s50/s200-1,.15)]):null,`السعر ${fmt(price)}؛ متوسط 50 ${fmt(s50)} ومتوسط 200 ${fmt(s200)}.`);
 add('momentum','الزخم والحجم النسبي',avg([finite(rsi)?norm(rsi-50,30):null,finite(macd)&&price?norm(macd/price,.01):null]),`RSI ${fmt(rsi)}؛ MACD ${fmt(macd)}؛ الحجم النسبي ${fmt(t.relativeVolume)}×.`);
 // Absolute turnover is used within the same market/currency; spread remains unknown if untimestamped.
 add('liquidity','السيولة واستمرارية التداول',finite(t.turnover)&&t.turnover>0&&t.zeroVolume!==null?avg([clamp((Math.log10(t.turnover)-6)/2),t.zeroVolume===0?.5:-1,finite(t.volumeRatio)?norm(t.volumeRatio-1):null]):null,`متوسط قيمة التداول التقريبي ${fmt(t.turnover)} ${report.currency}؛ أيام دون حجم ${t.zeroVolume??'—'}؛ الفارق المؤرخ غير متحقق.`);
 add('risk','التذبذب والهبوط',avg([norm(t.atrPct===null?null:3-t.atrPct,3),norm(t.maxDD===null?null:25-t.maxDD,25)]),`ATR ${fmt(t.atrPct)}%؛ أكبر هبوط في آخر 252 جلسة ${fmt(t.maxDD)}%.`);
 add('levels','موضع السعر بين الدعم والمقاومة',price&&finite(t.support)&&finite(t.resistance)?clamp(((t.resistance-price)/(price-t.support)-2)/3):null,`دعم ${fmt(t.support)}؛ مقاومة ${fmt(t.resistance)}؛ المستويات قابلة للكسر وليست أوامر تنفيذ.`);
 for(const key of ['market','sector'] as const){const b=report.context?.[key];const bt=b?technical(b.prices):null;const p=bt?.last?.close,b50=bt?.sma50.at(-1),b200=bt?.sma200.at(-1);const fresh=b&&bt?.last&&ageDays(report.asOf,bt.last.date)<=3;add(key,key==='market'?'حالة السوق':'حالة القطاع',fresh&&p&&finite(b50)&&finite(b200)?avg([norm(p/b50-1,.15),norm(b50/b200-1,.15)]):null,b?`${b.name} (${b.symbol})؛ مؤشر مرجعي، وليس كل الأوراق في السوق.`:'لم يتوفر مرجع حديث مطابق.',b?.source||source,bt?.last?.date||'');}
 const events=(report.official?.events||[]).filter(x=>x.date>=report.asOf&&ageDays(x.date,report.asOf)<=14);
 add('events','الإفصاحات والأحداث القريبة',events.length?-1:null,events.length?events.map(x=>`${x.title} (${x.date})`).join('؛ '):`${report.news.length} أخبار/إفصاحات متاحة؛ غياب حدث مؤكد لا يعني خلو التقويم. لا نحول عناوين الأخبار إلى إشارة إيجابية.`,report.official?.source||source,report.asOf);
 return {a,factors,incomeGrowth,conditioning};
}
export function researchScore(report:MarketReport,horizon:Horizon,minTurnover=0,settings:SiteSettings=DEFAULT_SETTINGS){
 const {a,factors}=researchFactors(report),weights=adjustedWeights(RESEARCH_WEIGHTS[horizon],settings);const available=factors.filter(f=>f.signal!==null);
 const coverage=available.reduce((s,f)=>s+weights[f.key],0),weighted=available.reduce((s,f)=>s+(f.signal!+1)*50*weights[f.key],0);
 const reasons=horizon==='short'?a.blockers.filter(reason=>!['القوائم السنوية غير متاحة','عملة القوائم لا تطابق','هذه الورقة تحتاج نموذجًا متخصصًا'].some(m=>reason.startsWith(m))):[...a.blockers];
 if(horizon!=='short'&&available.filter(f=>['growth','quality','debt','valuation'].includes(f.key)).length<3)reasons.push('لا تكفي محاور النمو والجودة والديون والتقييم لترتيب استثماري.');
 if(coverage<(horizon==='short'?65:70))reasons.push('تغطية عوامل المقارنة غير كافية.');
 if(a.tech.turnover===null||a.tech.turnover<minTurnover)reasons.push('السيولة أقل من الحد المطلوب أو غير متاحة.');
 if(!report.checks.some(c=>c.name==='الأسعار اليومية'&&c.state==='ok'))reasons.push('لم يتحقق مصدر الأسعار.');
 return {score:reasons.length?null:Math.round(weighted/coverage),coverage,reasons,factors:factors.map(f=>({...f,weight:weights[f.key]})),a};
}
export function quantile(values:number[],p:number){if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),i=(v.length-1)*p,lo=Math.floor(i);return v[lo]+(v[Math.ceil(i)]-v[lo])*(i-lo);}
function deviation(values:number[]){if(values.length<2)return null;const mean=values.reduce((s,v)=>s+v,0)/values.length;return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1));}
function dailyReturnRange(prices:MarketReport['prices'],sessions:number){
 const daily=prices.slice(1).map((p,i)=>Math.log(p.close/prices[i].close)).filter(Number.isFinite);
 if(daily.length<12)return null;
 const median=quantile(daily,.5),sigma=deviation(daily);
 if(median===null||sigma===null||sigma<=0)return null;
 return {median:median*sessions,low:median*sessions-1.28155*sigma*Math.sqrt(sessions),high:median*sessions+1.28155*sigma*Math.sqrt(sessions),sample:daily.length,derived:true};
}
export function forecastReadiness(report:MarketReport,now=Date.now()){
 const last=report.prices.at(-1),priceOk=!!last&&finite(last.close)&&last.close>0;
 const pricesOk=report.prices.filter(p=>finite(p.close)&&p.close>0).length>=20;
 const stale=last?ageDays(new Date(now).toISOString().slice(0,10),last.date):Infinity;
 const priceCheck=report.checks.find(c=>c.name==='الأسعار اليومية');
 const {a,factors}=researchFactors(report,now),coverage=factors.filter(f=>f.signal!==null).length;
 const financial=factors.filter(f=>['growth','quality','debt','valuation'].includes(f.key)&&f.signal!==null).length;
 const financialFacts=new Set(resolveFinancialSources(report).facts.filter(f=>['revenue','netIncome','operatingIncome','operatingCashFlow','freeCashFlow','debt','cash','equity','ebitda'].includes(f.key)&&finite(f.value)&&f.currency===report.currency).map(f=>f.key)).size;
 const warnings:string[]=[];
 if(priceCheck?.state!=='ok')warnings.push(pricesOk?'لم يكتمل تحقق المصدر، لكن توجد سلسلة سعرية قابلة للقراءة.':'لم تصل سلسلة سعرية كافية؛ لا نعتبر غياب الأسعار بيانات صالحة.');
 if(stale>3)warnings.push(`آخر جلسة سعرية بتاريخ ${last?.date||'غير متاح'}؛ قد لا تمثل السعر اللحظي.`);
 if(financialFacts<2)warnings.push('درجة الثقة منخفضة بسبب نقص بعض البيانات المالية.');
 if(a.sourceComparisons.some(item=>item.disagreed&&item.resolved))warnings.push('اعتُمد المصدر الأعلى أولوية عند اختلاف الأرقام المتقابلة؛ تفاصيل القيم الأصلية محفوظة في المصادر.');
 if(a.sourceComparisons.some(item=>item.excluded))warnings.push('استُبعد العامل المختلف عليه بين مصادر متساوية؛ تستمر القراءة بالعوامل الأخرى دون اختيار رقم عشوائي.');
 if(!report.context?.market||!report.context?.sector)warnings.push('مرجع السوق أو القطاع غير مكتمل؛ يُخفّض وزن السياق الخارجي.');
 if(!report.news.some(n=>n.contentRead))warnings.push('الأخبار والإفصاحات المتاحة غير مكتملة؛ لا يعني ذلك غياب الأحداث.');
 if(report.mode==='historical')warnings.push('هذا تقدير على لقطة تاريخية، وليس توقعًا حيًا للسوق الحالي.');
 const unavailable:string[]=[];
 if(!priceOk||!pricesOk)unavailable.push('لا توجد سلسلة سعرية صالحة لا تقل عن 20 جلسة.');
 if(stale>21)unavailable.push('آخر سعر قديم جدًا لإصدار توقع مفيد.');
 let quality=unavailable.length?'غير صالحة':stale<=3&&report.prices.length>=252&&financial>=3&&financialFacts>=3&&coverage>=7?'ممتازة':stale<=7&&report.prices.length>=120&&financialFacts>=2&&coverage>=4?'جيدة':report.prices.length>=60?'متوسطة':'ضعيفة';
 if(quality==='ممتازة'&&(!report.context?.market||!report.context?.sector||!report.news.some(n=>n.contentRead)))quality='جيدة';
 if(a.sourceComparisons.some(item=>item.conflict)&&!unavailable.length)quality='متوسطة';
 if(report.facts.some(f=>f.source.startsWith('ملف المستخدم:'))&&!unavailable.length){quality='متوسطة';warnings.push('توجد بنود من ملف المستخدم لم يتحقق مصدرها مستقلًا؛ خُفضت الثقة.');}
 const provisional=resolveFinancialSources(report).provisional;
 const limitedFeed=report.priceCoverage?.includes('IEX');
 if(limitedFeed)warnings.push('تغطية IEX محدودة؛ لا يمثل حجمها حجم السوق الأمريكي المجمع، والثقة منخفضة.');
 if(provisional)warnings.push('التقييم أولي: بعض المصادر ثانوية أو لا تحمل تاريخ نشر موثقًا؛ خُفضت الثقة ولم تتوقف القراءة.');
 const confidence=provisional||limitedFeed?'منخفض':quality==='ممتازة'?'متوسط':quality==='جيدة'?'متوسط':'منخفض';
 return {quality,confidence,warnings,unavailable,financial,financialFacts,coverage,stale,priceCount:report.prices.length};
}
export function forecasts(report:MarketReport,quote:LiveQuote|null=null,now=Date.now(),settings:SiteSettings=DEFAULT_SETTINGS,horizons:readonly {name:string;sessions:number}[]=HORIZONS){
 if(horizons.some(h=>!Number.isInteger(h.sessions)||h.sessions<1||h.sessions>252)||new Set(horizons.map(h=>h.sessions)).size!==horizons.length)throw new RangeError('Forecast horizons must be unique integers from 1 to 252');
 const {a,factors,conditioning}=researchFactors(report,now),last=report.prices.at(-1);
 const quoteUsable=report.mode!=='historical'&&quote&&finite(quote.price)&&quote.price>0&&quote.symbol===report.company.symbol&&quote.currency===report.currency&&now-Date.parse(quote.quoteTime)>=0&&now-Date.parse(quote.quoteTime)<=15*60000;
 const price=quoteUsable?quote!.price:last?.close??null;
 const readiness=forecastReadiness(report,now);
 const missing=factors.filter(f=>f.signal===null).map(f=>`${f.name}: ${f.detail}`);
 const rows=horizons.map(h=>{
  const condition=horizonCondition(conditioning,h.sessions);
  const modelCondition={...condition,calibrated:false as const,regime:conditioning.regime.currentRegime,relativeVolume:conditioning.relativeVolume,cashFlow:conditioning.cashFlow,notes:conditioning.notes};
  const window=forecastWindow(report.company.symbol,h.sessions,report.asOf,now,report.mode==='historical');
  const weights=adjustedWeights(forecastWeights(h.sessions),settings);
  const available=factors.filter(f=>f.signal!==null),coverage=available.reduce((s,f)=>s+weights[f.key],0);
  const blockers:ForecastBlock[]=readiness.unavailable.map(message=>({code:readiness.stale>21&&message.includes('قديم')?'data_stale':'data_missing',message}));
  const block=(code:string,message:string)=>blockers.push({code,message});
  if(!conditioning.pricesValid)block('price_series_invalid','سلسلة الأسعار تحوي قيمة أو تاريخًا غير صالح، أو جلسات مكررة/غير مرتبة/بعد تاريخ القطع.');
  if(condition.abstainReason)block('volatility_shock_policy',condition.abstainReason);
  if(h.sessions===1&&report.mode!=='historical'&&readiness.stale>4)block('daily_data_stale','آخر جلسة قديمة جدًا لتوقع الجلسة التالية.');
  if(settings.periods[h.sessions]?.enabled===false)block('horizon_disabled','أوقفت هذه المدة من إعدادات الإدارة؛ يمكنك إعادة تشغيلها.');
  const returns:number[]=[];for(let i=h.sessions;i<report.prices.length;i++)returns.push(Math.log(report.prices[i].close/report.prices[i-h.sessions].close));
  const median=quantile(returns,.5),q10=quantile(returns,.1),q90=quantile(returns,.9),fallback=dailyReturnRange(report.prices,h.sessions);
  const history=median!==null&&q10!==null&&q90!==null&&q90-q10>0?{median,low:q10,high:q90,sample:returns.length,derived:false}:fallback;
  if(!price||history===null)block('range_history_unavailable','لا تتوفر عينة تذبذب سعرية صالحة لبناء نطاق استرشادي.');
  const reasons=blockers.map(b=>b.message);
  const diagnosticInput={sessions:h.sessions,closes:report.prices.map(p=>p.close),sourceAsOf:last?.date||'',blocks:blockers};
  const basis=available.sort((x,y)=>Math.abs(y.signal!)*weights[y.key]-Math.abs(x.signal!)*weights[x.key]).slice(0,6).map(f=>`${f.name}: ${f.detail}`);
  const contributions=factors.map(f=>({name:f.name,weight:weights[f.key],impact:f.signal===null?null:Math.round(f.signal*weights[f.key]*100)/100}));
  const invalidation=[...(finite(a.tech.support)?[`إغلاق السعر دون الدعم ${fmt(a.tech.support)} يستدعي مراجعة الفرضية الفنية.`]:[]),h.sessions===1?'انعكاس الزخم أو انكماش السيولة في الجلسة التالية يبطل القراءة القصيرة.':'تراجع الإيرادات أو التدفق التشغيلي في نتائج جديدة يضعف فرضية النمو.','إعلان جوهري مخالف للفرضيات أو تغير اتجاه السوق والقطاع يستدعي إعادة التحليل.'];
  const risks=[...invalidation,...a.weaknesses,...missing,...readiness.warnings,'تغير النظام السوقي أو الأرباح والسيولة قد يخرج السعر عن النطاق.','التوزيعات النقدية وتكاليف التنفيذ غير داخلة في نطاق حركة السعر.'];
  if(reasons.length)return {diagnostics:forecastDiagnostic({...diagnosticInput,pointAvailable:false,rangeAvailable:false}),modelCondition,window,riskLevel:a.riskLabel,contributions,period:h.name,sessions:h.sessions,available:false,direction:'غير متاح',price,range:null,change:null,confidence:'منخفض',coverage,reasons,risks,invalidation,basis,sample:returns.length,independent:Math.max(0,Math.floor((report.prices.length-1)/h.sessions)),dataQuality:readiness.quality};
  // Transparent scenario model: multi-factor tilt (bounded to +/-15% annual log drift),
  // plus centered 10th/90th-percentile historical horizon returns. These are NOT calibrated probabilities.
  const bias=coverage?available.reduce((s,f)=>s+f.signal!*weights[f.key],0)/100:0;
  const empiricalSigma=deviation(returns)??0;
  const daily=report.prices.slice(1).map((p,i)=>Math.log(p.close/report.prices[i].close));
  const recentSigma=deviation(daily.slice(-63))??0,longSigma=deviation(daily.slice(-252))??recentSigma;
  const shortSigma=deviation(daily.slice(-20))??recentSigma;
  const baseDaySigma=h.sessions<=21?recentSigma:(recentSigma+longSigma)/2;
  // Shock warning rows use at least the latest-20-session volatility (data-driven widening, no new constant).
  // Capped so a shocked short range never exceeds the 63-session volatility scale (ranges stay ordered by horizon): sqrt(63/21)=1.732.
  const daySigma=condition.shockWarning?Math.min(Math.max(baseDaySigma,shortSigma),Math.max(baseDaySigma,Math.sqrt(3)*(recentSigma+longSigma)/2)):baseDaySigma;
  const sigma=daySigma*Math.sqrt(h.sessions),expectedScale=Math.max(sigma,empiricalSigma);
  const centerCalculation=scenarioCenter({bias,sessions:h.sessions,dailySigma:daySigma,expectedScale,positiveTiltMultiplier:condition.positiveTiltMultiplier});
  const center=centerCalculation.centerLogReturn;
  const widthLow=Math.max(history!.median-history!.low,1.28155*sigma),widthHigh=Math.max(history!.high-history!.median,1.28155*sigma);
  const penalty=1+Math.min(.20,(100-coverage)/500)+(readiness.quality==='ضعيفة'?.10:0);
  let low=price!*Math.exp(center-widthLow*penalty),high=price!*Math.exp(center+widthHigh*penalty);
  const predictedPrice=price!*Math.exp(center),expectedChange=predictedPrice-price!,expectedChangePct=100*expectedChange/price!,neutralThresholdPct=h.sessions===1?.1:h.sessions<=5?.25:.5;
  const rangeCalibration:RangeCalibration=CONFORMAL_RANGE_CALIBRATION_ENABLED
    ? calibrateForecastRange({prices:report.prices,sessions:h.sessions,center:predictedPrice,range:[low,high]})
    : {status:'insufficient',range:[low,high],sample:0,targetCoverage:.9,empiricalCoverage:null,quantileLogError:null,reason:'معايرة Conformal التجريبية معطلة حتى مراجعة تغطيتها خارج العينة.'};
  if(rangeCalibration.status==='calibrated'&&rangeCalibration.range){low=rangeCalibration.range[0];high=rangeCalibration.range[1];}
  const direction=directionOf(expectedChangePct,neutralThresholdPct);
  const independent=Math.max(0,Math.floor((report.prices.length-1)/h.sessions));
  const confidence=condition.shock?'منخفض':h.sessions===1?(!quoteUsable||now-Date.parse(quote!.quoteTime)>60000||!report.context?.market?'منخفض':readiness.confidence):h.sessions>=126&&readiness.financial<3?'منخفض':readiness.confidence;
  const longJump=daily.slice(-20).some(v=>Math.abs(v)>.25&&Math.abs(v)>Math.max(.01,longSigma)*6);
  const rangeBlocks=inspectScenarioRange({low,high,reference:price!,sigma,expectedScale,maxSigma:settings.maxSigma,longJump});
  const anomalous=rangeBlocks.length>0;
  const confidenceBlocked=settings.minConfidence==='high'||settings.minConfidence==='medium'&&confidence==='منخفض';
  blockers.push(...rangeBlocks);
  if(confidenceBlocked)block('confidence_policy','الثقة المتاحة أقل من الحد الذي حددته في الإدارة.');
  const diagnostics=forecastDiagnostic({...diagnosticInput,pointAvailable:!anomalous&&!confidenceBlocked,rangeAvailable:!anomalous&&!confidenceBlocked,center:centerCalculation,neutralThresholdPct,range:{low,high,reference:price!,expectedScale,maxSigma:settings.maxSigma}});
  if(anomalous||confidenceBlocked)return {diagnostics,modelCondition,window,riskLevel:a.riskLabel,contributions,period:h.name,sessions:h.sessions,available:false,direction:'غير متاح',price,range:null,change:null,confidence,coverage,reasons:blockers.map(b=>b.message),risks,invalidation,basis,sample:history!.sample,independent,dataQuality:readiness.quality,rangeCalibration};
  const logWidth=Math.log(high/low),q25=low*Math.exp(logWidth*.25),q75=low*Math.exp(logWidth*.75);
  return {diagnostics,modelCondition,shockWarning:condition.shockWarning,predictedPrice,expectedChange,expectedChangePct,neutralThresholdPct,rangeMeaning:'end_close_estimate',evaluationPolicy:EVALUATION_POLICY,window,riskLevel:a.riskLabel,rangeCheck:{dailyVolatility:daySigma*100,horizonVolatility:expectedScale*100,maxSigma:settings.maxSigma,market:report.context?.market?.symbol||null,sector:report.context?.sector?.symbol||null},contributions,scenarios:{negative:[low,q25],base:[q25,q75],positive:[q75,high]},catalysts:[h.sessions===1?'استمرار الزخم والسيولة واتجاه السوق في الجلسة التالية.':'استمرار النمو والتدفق والهوامش وفق الفرضيات المستخدمة.','تحقق اختراق يؤكده الحجم، أو إعلان جوهري جديد بعد مراجعته.'],period:h.name,sessions:h.sessions,available:true,direction,price,range:[low,high],change:[(low/price!-1)*100,(high/price!-1)*100],confidence,coverage,reasons:readiness.warnings,risks,invalidation,basis,sample:history!.sample,independent:Math.max(0,Math.floor((report.prices.length-1)/h.sessions)),dataQuality:readiness.quality,derivedRange:history!.derived,rangeCalibration};
 });
  return {createdAt:new Date(now).toISOString(),version:forecastModelVersion(settings),settingsUsed:{weights:settings.weights,maxSigma:settings.maxSigma,minConfidence:settings.minConfidence,periods:settings.periods},price,currency:report.currency,priceTime:quoteUsable?quote!.quoteTime:last?.date||'',retrievedAt:report.retrievedAt,rows,factors,dataQuality:readiness.quality,dataWarnings:[...readiness.warnings,...(quoteUsable&&now-Date.parse(quote!.quoteTime)>60000?['السعر المرجعي متأخر حتى 15 دقيقة؛ لا يصلح كسعر تنفيذ لحظي.']:[])],dailyScope:'اليومي: الجلسة التالية، وليس توصية تنفيذ داخل الدقيقة. السعر قد يتأخر حتى 15 دقيقة.',method:'نموذج سيناريو متعدد العوامل؛ اليومي للجلسة التالية بميل محدود بربع التذبذب اليومي مرجحًا بالفني والسيولة والسوق، وللمدد الأطول ميل سنوي محدود ±15% تُحدده الأوزان المعلنة، واتساع من المئينين 10 و90 لعوائد تاريخية مماثلة للأفق والتذبذب اليومي الحديث مضروبًا بجذر عدد جلسات المدة؛ أضيفت طبقة معايرة نطاق Conformal تجريبية لكنها معطلة حتى تثبت تغطيتها خارج العينة. السعر المركزي ناتج ميل النموذج، وليس منتصف النطاق. مقام مساهمات الأوزان 100 دائمًا؛ لا يعاد توزيع وزن العامل الناقص. المئينات وصف للماضي وليست احتمال تحقق مستقبلي. عند نقص القوائم ينخفض مستوى الثقة ولا يختفي التوقع ما دامت الأسعار صالحة. لا تثبت دقة النموذج باختبار مستقبلي؛ لذلك لا تمنح ثقة مرتفعة.'};
}
export function forecastModelVersion(settings:SiteSettings){const s=JSON.stringify([settings.weights,settings.maxSigma,settings.minConfidence,settings.periods]);let hash=2166136261;for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619);return MODEL_VERSION+"-"+(hash>>>0).toString(16);}

/** Full report required: aligned candles, source identity, dated financials and currency. */
export interface ForecastInput {
 report: MarketReport;
 quote?: LiveQuote | null;
 now?: number;
 settings?: SiteSettings;
}
export interface HorizonForecast {
 horizon: ForecastHorizon;
 targetDate: string | null;
 calendarVerified: false;
 centralTarget: number | null;
 range: [number,number] | null;
 direction: string;
 probabilityUp: null;
 confidenceScore: null;
 evidenceQuality: string;
 expectedReturnPercent: number | null;
 fcfDriftImpact: null;
 status: 'active' | 'abstain';
 abstainReason?: string;
 warning?: string;
}
export interface ComprehensiveForecastReport {
 symbol: string;
 anchorPrice: number | null;
 generatedAt: string;
 modelVersion: string;
 calibrated: false;
 horizons: Record<ForecastHorizon,HorizonForecast>;
 regimeSummary: string;
 modelGovernanceNotes: string[];
}

/**
 * Compatibility name requested by the user. This is a view of the canonical model,
 * not a new calibration engine. Scalar win-rate/Brier inputs cannot calibrate it.
 * Recorded forecasts remain immutable; this function creates a fresh calculation.
 */
export function generateCalibratedForecast(input: ForecastInput): ComprehensiveForecastReport {
 const {report,quote=null,now=Date.now(),settings=DEFAULT_SETTINGS}=input;
 const result=forecasts(report,quote,now,settings);
 const entries=result.rows.map(row=>[row.sessions,{
  horizon:row.sessions,targetDate:row.window.estimatedEndAt?.slice(0,10)??null,
  calendarVerified:false as const,
  centralTarget:row.available&&finite(row.predictedPrice)?row.predictedPrice:null,
  range:row.available&&row.range?[row.range[0],row.range[1]] as [number,number]:null,
  direction:row.direction,probabilityUp:null,confidenceScore:null,evidenceQuality:row.confidence,
  expectedReturnPercent:row.available&&finite(row.expectedChangePct)?row.expectedChangePct:null,
  fcfDriftImpact:null,status:row.available?'active' as const:'abstain' as const,
  ...(!row.available?{abstainReason:row.reasons.join(' ')}:{}),
  ...(row.available&&(row as any).shockWarning?{warning:(row as any).shockWarning as string}:{})
 }]);
 const condition=result.rows[0]?.modelCondition;
 const label=condition?.regime==='VOLATILITY_SHOCK'?'صدمة تقلب':condition?.regime==='BULL_TREND'?'اتجاه صاعد وصفي':condition?.regime==='MEAN_REVERTING'?'مسار عرضي':'غير متحقق';
 return {symbol:report.company.symbol,anchorPrice:result.price,generatedAt:result.createdAt,
  modelVersion:result.version,calibrated:false,
  horizons:Object.fromEntries(entries) as Record<ForecastHorizon,HorizonForecast>,
  regimeSummary:`بيئة السوق: ${label} | حجم نسبي: ${condition?.relativeVolume==null?'غير متحقق':condition.relativeVolume.toFixed(2)+'×'}`,
  modelGovernanceNotes:[...(condition?.notes??[]),result.method,
   'المركز والنطاق تقديرات سيناريو؛ لم تثبت معايرتها كمئينات مستقبلية Q10/Q50/Q90.',
   'التدفق الحر يدخل في عامل الجودة؛ لا يُحوّل عائده إلى نمو سعري مضمون ولا تُفترض تكلفة رأس مال.',
   result.rows[0].window.deadlineNote]
 };
}
