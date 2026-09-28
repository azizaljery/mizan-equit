/** Out-of-sample windows over forecasts actually issued then; this does not fit a model. */
import {runBacktest,parseBacktestConfig,backtestDate,summarizeBacktest} from './runner';
import {BacktestInputError,type WalkForwardConfig,type WalkForwardWindow as IssuedWindow,type BacktestRunResult,type BacktestDataset,type BacktestCandle} from './types';
import {PurgedWalkForwardValidator} from '../quant-core';
import {normalizeBacktestDataset} from './dataset';
export interface WalkForwardWindow {index:number;train:BacktestCandle[];test:BacktestCandle[];trainStart:string;trainEnd:string;testStart:string;testEnd:string;purgedRecordsCount:number;embargoSessionsCount:number;}
export interface WalkForwardOptions {minTrainSessions?:number;testSessions?:number;embargoPct?:number;predictionHorizonSessions?:number;}
export function buildWalkForwardWindows(dataset:BacktestDataset,options:WalkForwardOptions={}):WalkForwardWindow[] {
  const {candles}=normalizeBacktestDataset(dataset),h=options.predictionHorizonSessions??10;
  if(!Number.isSafeInteger(h)||h<1||h>252)throw new BacktestInputError('أفق التحقق يجب أن يكون 1–252 جلسة.');
  let validator:PurgedWalkForwardValidator;
  try{validator=new PurgedWalkForwardValidator(options.minTrainSessions??252,options.testSessions??63,options.embargoPct??.02);}catch{throw new BacktestInputError('إعدادات النوافذ غير صالحة.');}
  // Unmatured anchors are omitted, never clamped to the final observed session.
  const records=candles.slice(0,Math.max(0,candles.length-h)).map((c,i)=>({id:i,timestamp:Date.parse(c.date),labelHorizonEndTimestamp:Date.parse(candles[i+h].date)}));
  return validator.generateSplits(records).map(s=>({index:s.windowIndex,train:s.trainIndices.map(i=>candles[i]),test:s.testIndices.map(i=>candles[i]),trainStart:new Date(s.trainStart).toISOString().slice(0,10),trainEnd:new Date(s.trainEnd).toISOString().slice(0,10),testStart:new Date(s.testStart).toISOString().slice(0,10),testEnd:new Date(s.testEnd).toISOString().slice(0,10),purgedRecordsCount:s.purgedCount,embargoSessionsCount:s.embargoedCount}));
}
export function parseWalkForwardConfig(input:unknown):WalkForwardConfig {
  if (!input||typeof input!=='object'||Array.isArray(input)) throw new BacktestInputError('إعداد النوافذ غير صالح.');
  const {windows,...rest}=input as Record<string,unknown>;
  if('startDate' in rest||'endDate' in rest)throw new BacktestInputError('تواريخ النوافذ تحدد في windows فقط.');
  if (!Array.isArray(windows)||!windows.length||windows.length>4) throw new BacktestInputError('اختر 1–4 نوافذ.');
  const validated:IssuedWindow[]=windows.map((w,i)=>{
    if (!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).some(k=>!['trainStart','trainEnd','testStart','testEnd'].includes(k))) throw new BacktestInputError('حقول النافذة غير صالحة.');
    const trainStart=backtestDate(w.trainStart),trainEnd=backtestDate(w.trainEnd),testStart=backtestDate(w.testStart),testEnd=backtestDate(w.testEnd);
    if (!(trainStart<=trainEnd&&trainEnd<testStart&&testStart<=testEnd)||i>0&&windows[i-1].testEnd>=testStart) throw new BacktestInputError('يلزم ماضٍ سابق للاختبار ونوافذ اختبار مرتبة دون تداخل.');
    return {trainStart,trainEnd,testStart,testEnd};
  });
  const {startDate:_,endDate:__,...base}=parseBacktestConfig({...rest,startDate:validated[0].testStart,endDate:validated.at(-1)!.testEnd});
  if (base.runId.length>85) throw new BacktestInputError('runId للنوافذ لا يتجاوز 85 حرفًا.');
  return {...base,windows:validated};
}
export async function runWalkForward(db:any,input:WalkForwardConfig) {
  const config=parseWalkForwardConfig(input),kind='mizan-issued-forecast-windows-v1',key=JSON.stringify(config);
  const prior=await db.prepare('SELECT data FROM backtest_runs WHERE id=?').bind(config.runId).first();
  if(prior){const saved=JSON.parse(prior.data);if(saved.kind!==kind||JSON.stringify(saved.config)!==key)throw new BacktestInputError('runId مستخدم لإعداد مختلف.');return {...saved,reused:true};}
  const windows:Array<{window:IssuedWindow;training:{records:number;retrained:false};result:BacktestRunResult}>=[];
  for (const [i,window] of config.windows.entries()) {
    let records=0;
    const endExclusive=new Date(Date.parse(window.trainEnd)+864e5).toISOString().slice(0,10)+'T00:00:00';
    for (const symbol of config.symbols) {
      const row=await db.prepare('SELECT COUNT(*) AS n FROM forecast_records WHERE symbol=? AND created_at>=? AND created_at<?'+(config.model?' AND model=?':'')).bind(symbol,window.trainStart+'T00:00:00',endExclusive,...(config.model?[config.model]:[])).first();records+=Number(row.n);
    }
    const {windows:_,...base}=config;
    const result=await runBacktest(db,{...base,runId:config.runId+':window:'+i,startDate:window.testStart,endDate:window.testEnd});
    windows.push({window,training:{records,retrained:false},result});
  }
  const result={kind,runId:config.runId,config,completedAt:new Date().toISOString(),windows,
    aggregate:{byHorizon:summarizeBacktest(windows.flatMap(w=>w.result.observations),config.horizons)},
    note:'حدود التدريب تصف التاريخ السابق فقط؛ لا تعاد معايرة التوقعات الأصلية أو تدريب النموذج. نتائج النوافذ مجمعة من المشاهدات، ولا يؤخذ متوسط Sharpe النوافذ.',persisted:true,reused:false};
  const data=JSON.stringify(result);if(new TextEncoder().encode(data).byteLength>1000000)throw Error('تقرير النوافذ أكبر من الحد؛ قلّل الفترة أو الرموز.');
  await db.prepare('INSERT INTO backtest_runs(id,symbol,created_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(config.runId,'*',result.completedAt,data).run();
  const stored=await db.prepare('SELECT data FROM backtest_runs WHERE id=?').bind(config.runId).first();
  if(!stored)throw Error('لم يثبت حفظ تقرير النوافذ.');
  const saved=JSON.parse(stored.data);if(saved.kind!==kind||JSON.stringify(saved.config)!==key)throw new BacktestInputError('تعارض معرف تقرير النوافذ.');
  return {...saved,reused:stored.data!==data};
}
