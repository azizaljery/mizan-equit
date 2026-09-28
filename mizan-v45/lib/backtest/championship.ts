import {PurgedWalkForwardValidator,type OOSMetrics} from '../quant-core';
import {tradeScenario} from '../trade-scenario';
import {technical,finite} from '../analysis';
import type {MarketReport,Fact} from '../market-data';
import {factsKnownAsOf,pickLatest} from './all-in-one';
import {buildWalkForwardWindows,type WalkForwardOptions} from './walk-forward';
import {normalizeBacktestDataset} from './dataset';
import {BacktestInputError,DEFAULT_COSTS,type CostModel,type BacktestDataset,type BacktestCandle,type BacktestResult,type BacktestTrade} from './types';

export interface ChampionshipOptions extends WalkForwardOptions {initialCapital?:number;allocation?:number;costs?:CostModel;}
export interface ChampionshipBacktestResult extends BacktestResult {
  championshipMetrics:OOSMetrics;windowsEvaluated:number;skippedIncompleteHorizons:number;
  missingFinancialSafetyChecks:number;
  equityCurve:{date:string;equity:number;return:number}[];
  method:'mizan-technical-walk-forward-v1';retrained:false;limitations:string[];
}

/** Whitelist the historical report. Current peers, quote, forecast and news cannot leak in. */
export function historicalScenarioReport(base:MarketReport,dataset:BacktestDataset,prices:BacktestCandle[]):MarketReport {
  const asOf=prices.at(-1)?.date;
  if(!asOf)throw new BacktestInputError('لا توجد جلسة سابقة لبناء الإشارة.');
  const known=factsKnownAsOf(base.facts,asOf);
  return {company:{...base.company},currency:dataset.currency,asOf,retrievedAt:asOf+'T23:59:59.000Z',mode:'historical',prices,priceSource:base.priceSource,priceAdjustment:dataset.adjustment,quoteTime:null,facts:known.known,official:null,news:[],peers:[],warnings:known.warnings,checks:[{name:'الأسعار اليومية',state:'ok',detail:'شموع مدخلة اجتازت فحص البنية؛ توثيق المصدر مستقل.',url:base.priceSource}],historicalNote:'محاكاة القاعدة الفنية بإشارة الجلسة السابقة؛ ليست إعادة بناء للتوصية الخاصة كاملة.'};
}

/** Only an opening price in the previously fixed entry zone can execute. */
export function simulatePlannedTrade(candles:BacktestCandle[],entry:number,horizon:number,levels:{low:number;high:number;stop:number;target1:number},costs:CostModel) {
  if(entry<0||!Number.isSafeInteger(entry)||!Number.isSafeInteger(horizon)||horizon<1||entry+horizon>candles.length)return null;
  const open=candles[entry].open;
  if(![levels.low,levels.high,levels.stop,levels.target1].every(finite)||levels.stop<=0||levels.stop>=levels.low||levels.low>levels.high||levels.target1<=levels.high||open<levels.low||open>levels.high)return null;
  const fee=costs.commissionBps/10000,slip=costs.slippageBps/10000;
  const entryPrice=open*(1+slip),entryCost=entryPrice*(1+fee);
  // A slippage-adjusted fill outside the entry zone is not chased.
  if(entryPrice>levels.high)return null;
  let exit=entry+horizon-1,rawExit=candles[exit].close,exitReason:BacktestTrade['exitReason']='horizon';
  for(let k=entry;k<entry+horizon;k++){
    const c=candles[k];
    if(c.open<=levels.stop){exit=k;rawExit=c.open;exitReason='stop';break;}
    if(c.open>=levels.target1){exit=k;rawExit=c.open;exitReason='target';break;}
    // Unknown intraday ordering: stop first when both levels are touched.
    if(c.low<=levels.stop){exit=k;rawExit=levels.stop;exitReason='stop';break;}
    if(c.high>=levels.target1){exit=k;rawExit=levels.target1;exitReason='target';break;}
  }
  const exitPrice=rawExit*(costs.doubleSided?1-slip:1),exitProceeds=exitPrice*(costs.doubleSided?1-fee:1);
  return {entryPrice,entryCost,exitPrice,exitProceeds,exit,exitReason,netReturn:exitProceeds/entryCost-1};
}

export function parseChampionshipRequest(input:unknown):{dataset:BacktestDataset;report:MarketReport} {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BacktestInputError('طلب الاختبار غير صالح.');
  const r=input as Record<string,unknown>,dataset=normalizeBacktestDataset(r.dataset),report=r.report as MarketReport;
  if(!report||typeof report!=='object'||!report.company||report.company.symbol!==dataset.symbol||report.currency!==dataset.currency)throw new BacktestInputError('يجب أن يتطابق التقرير مع رمز الشموع وعملتها.');
  if(!Array.isArray(report.facts)||report.facts.length>1000||typeof report.priceSource!=='string'||report.priceSource.length>2000)throw new BacktestInputError('مصدر التقرير أو القوائم غير صالح.');
  const facts:Fact[]=report.facts.map(f=>{
    if(!f||typeof f.key!=='string'||f.key.length>80||!finite(f.value)||typeof f.date!=='string'||!['annual','quarterly','trailing'].includes(f.period)||typeof f.currency!=='string'||typeof f.source!=='string'||f.source.length>2000||f.publishedAt!==undefined&&typeof f.publishedAt!=='string')throw new BacktestInputError('بند مالي غير صالح.');
    if(f.unit&&f.unit!=='base')throw new BacktestInputError('وحّد وحدات البنود إلى base قبل الاختبار.');
    return {key:f.key,value:f.value,date:f.date,period:f.period,currency:f.currency,source:f.source,publishedAt:f.publishedAt,unit:'base'};
  });
  const stringField=(key:'name'|'exchange'|'sector'|'industry'|'source')=>typeof report.company[key]==='string'?report.company[key].slice(0,300):'';
  const clean:MarketReport={company:{symbol:dataset.symbol,name:stringField('name'),exchange:stringField('exchange'),sector:stringField('sector'),industry:stringField('industry'),source:stringField('source')},currency:dataset.currency,prices:[],facts,priceSource:report.priceSource,asOf:'',retrievedAt:'',quoteTime:null,official:null,news:[],peers:[],checks:[],warnings:[],mode:'historical'};
  return {dataset,report:clean};
}

/** Fixed-rule simulation. Training windows are history; no model is fitted or tuned here. */
export function runChampionshipBacktest(input:BacktestDataset,baseReport:MarketReport,options:ChampionshipOptions={}):ChampionshipBacktestResult {
  const {dataset,report}=parseChampionshipRequest({dataset:input,report:baseReport});
  if(dataset.adjustment==='raw')throw new BacktestInputError('يلزم توحيد تعديل OHLC قبل الاختبار عبر إجراءات الشركات.');
  const initialCapital=options.initialCapital??100000,allocation=options.allocation??.1,horizon=options.predictionHorizonSessions??10,costs=options.costs??DEFAULT_COSTS;
  if(!finite(initialCapital)||initialCapital<=0||initialCapital>1e12||!finite(allocation)||allocation<=0||allocation>1||!costs||![costs.commissionBps,costs.slippageBps].every(v=>finite(v)&&v>=0&&v<=1000)||typeof costs.doubleSided!=='boolean')throw new BacktestInputError('رأس المال أو حجم المركز أو تكاليف التنفيذ غير صالحة.');
  const windows=buildWalkForwardWindows(dataset,{...options,predictionHorizonSessions:horizon});
  if(!windows.length)throw new BacktestInputError('لا توجد نافذة مكتملة بعد التطهير والحظر وأفق النتيجة؛ 50 شمعة لا تكفي للإعداد الافتراضي.');
  const candles=dataset.candles,index=new Map(candles.map((c,i)=>[c.date,i]));
  const start=index.get(windows[0].testStart)!,end=index.get(windows.at(-1)!.testEnd)!;
  const closingEquity=new Map<number,number>();let capital=initialCapital,skippedIncompleteHorizons=0,missingFinancialSafetyChecks=0;
  const trades:BacktestTrade[]=[];
  for(const win of windows){
    const last=index.get(win.testEnd)!;
    for(let j=index.get(win.testStart)!;j<=last;j++){
      const history=candles.slice(0,j),historical=historicalScenarioReport(report,dataset,history);
      const scenario=tradeScenario(historical),t=technical(history),bar=history.at(-1)!;
      const s50=t.sma50.at(-1),s200=t.sma200.at(-1),rsi=t.rsi.at(-1);
      const financials=historical.facts.filter(f=>f.currency===dataset.currency);
      const latest=(key:string)=>pickLatest(financials,key,'annual');
      const income=latest('netIncome'),operating=latest('operatingCashFlow');
      const net=income?.value,cfo=income?.date===operating?.date?operating?.value:undefined;
      const negativeEquity=latest('equity')?.value;
      if(income===null&&operating===null&&negativeEquity===undefined)missingFinancialSafetyChecks++;
      if(!scenario.levels||scenario.reasons.length||!finite(s50)||!finite(s200)||s50<=s200||!finite(rsi)||rsi<50||rsi>70||!finite(t.relativeVolume)||t.relativeVolume<1.5||bar.close<=scenario.levels.resistance||negativeEquity!==undefined&&negativeEquity<=0||finite(net)&&finite(cfo)&&net<0&&cfo<0){closingEquity.set(j,capital);continue;}
      if(j+horizon-1>last){skippedIncompleteHorizons++;closingEquity.set(j,capital);continue;}
      const fill=simulatePlannedTrade(candles,j,horizon,scenario.levels,costs);
      if(!fill){closingEquity.set(j,capital);continue;}
      const budget=capital*allocation,shares=budget/fill.entryCost,cash=capital-budget;
      for(let k=j;k<fill.exit;k++)closingEquity.set(k,cash+shares*candles[k].close);
      const pnl=shares*fill.exitProceeds-budget;
      capital=cash+shares*fill.exitProceeds;closingEquity.set(fill.exit,capital);
      trades.push({id:`trade-${win.index}-${j}`,entryDate:candles[j].date,exitDate:candles[fill.exit].date,entryPrice:fill.entryPrice,exitPrice:fill.exitPrice,returnPct:fill.netReturn*100,won:pnl>0,netPnl:pnl,exitReason:fill.exitReason});
      j=fill.exit;
    }
  }
  let previous=initialCapital;
  const equityCurve=candles.slice(start,end+1).map((c,k)=>{const equity=closingEquity.get(start+k)??previous,ret=equity/previous-1;previous=equity;return {date:c.date,equity,return:ret};});
  const championshipMetrics=new PurgedWalkForwardValidator().evaluateChampionship(equityCurve.map(p=>p.return),[],[],1,252);
  const gains=trades.reduce((s,t)=>s+Math.max(0,t.netPnl),0),losses=trades.reduce((s,t)=>s+Math.max(0,-t.netPnl),0);
  return {method:'mizan-technical-walk-forward-v1',retrained:false,symbol:dataset.symbol,totalTrades:trades.length,winRate:trades.length?trades.filter(t=>t.won).length/trades.length*100:null,profitFactor:losses>0?gains/losses:null,maxDrawdown:championshipMetrics.maxDrawdown===null?null:championshipMetrics.maxDrawdown*100,sharpeRatio:championshipMetrics.annualizedSharpe,initialCapital,finalCapital:capital,trades,championshipMetrics,windowsEvaluated:windows.length,skippedIncompleteHorizons,missingFinancialSafetyChecks,equityCurve,limitations:['محاكاة القاعدة الفنية فقط؛ لا تدريب أو ضبط أوزان ولا إعادة بناء كاملة للتوصية الخاصة.','مصدر الشموع وتعديلاتها مقدمان من المستدعي؛ اجتياز فحص البنية لا يثبت صحتهما تاريخيًا.','هوية الشركة والقطاع من التقرير المدخل؛ لم تختبر عينة خالية من تحيز البقاء.',...(missingFinancialSafetyChecks?[`لم تتوفر حقائق مالية معروفة وقتيًا لفحص حقوق الملكية والربح والتدفق التشغيلي في ${missingFinancialSafetyChecks} نقطة تقييم؛ لم يُفترض أنها سليمة.`]:[]),'لا احتمالات دخول معايرة: Brier وDSR غير متاحين ولا يعلن قبول البطولة.','تنفيذ عند افتتاح داخل المنطقة فقط، مركز واحد، أسهم كسرية، وقف أولًا عند لمس الوقف والهدف في الشمعة نفسها.','السنوية مبنية على عوائد المحفظة لكل جلسة بافتراض 252 جلسة سنويًا؛ الفجوات غير الموثقة في الشموع تحتاج فحص تقويم مستقل.']};
}
