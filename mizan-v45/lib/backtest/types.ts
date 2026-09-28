/** Serialized configuration: existing issued forecasts are measured, never regenerated. */
export type CostModel = {commissionBps:number;slippageBps:number;doubleSided:boolean};
export const DEFAULT_COSTS:CostModel = {commissionBps:5,slippageBps:10,doubleSided:true};
export type BacktestCandle=import('../analysis').Price;
export interface BacktestDataset {symbol:string;currency:string;candles:BacktestCandle[];adjustment:'split-adjusted'|'total-return-adjusted'|'raw';}
export interface BacktestTrade {id:string;entryDate:string;exitDate:string;entryPrice:number;exitPrice:number;returnPct:number;won:boolean;netPnl:number;exitReason:'stop'|'target'|'horizon';}
export interface BacktestResult {symbol:string;totalTrades:number;winRate:number|null;profitFactor:number|null;maxDrawdown:number|null;sharpeRatio:number|null;initialCapital:number;finalCapital:number;trades:BacktestTrade[];}
export type BacktestConfig = {
  runId:string; symbols:string[]; startDate:string; endDate:string; horizons:number[];
  costs:CostModel; minSessions:number; model?:string;
};
export type WalkForwardWindow = {trainStart:string;trainEnd:string;testStart:string;testEnd:string};
export type WalkForwardConfig = Omit<BacktestConfig,'startDate'|'endDate'> & {windows:WalkForwardWindow[]};
export type Observation = {
  id:string;symbol:string;model:string;horizon:number;currency:string;
  state:'complete'|'excluded'|'pending';reason:string|null;
  anchorDate:string|null;actualDate:string|null;directionCorrect:boolean|null;rangeHit:boolean|null;
  absoluteError:number|null;relativeErrorPct:number|null;
  netAssetReturn:number|null;netBenchmarkReturn:number|null;
};
export type HorizonResult = {
  horizon:number;total:number;completed:number;excluded:number;pending:number;
  directionCount:number;directionAccuracy:number|null;rangeCount:number;rangeHitRate:number|null;
  pointCount:number;maeByCurrency:Record<string,{count:number;mae:number}>;meanRelativeErrorPct:number|null;
  returnCount:number;meanReturn:number|null;stdReturn:number|null;sharpe:number|null;
  benchmarkCount:number;benchmarkSharpe:number|null;alpha:number|null;
};
export type BacktestRunResult = {
  kind:'mizan-issued-forecast-audit-v1';runId:string;startedAt:string;completedAt:string;
  config:BacktestConfig;byHorizon:HorizonResult[];observations:Observation[];
  symbolsFailed:Array<{symbol:string;reason:string}>;symbolsSucceeded:number;
  symbols:Array<{symbol:string;recordsScanned:number;currency:string|null;source:string|null;benchmark:string|null;checks:unknown[];attempts:unknown[];trace:unknown}>;
  limitations:string[];persisted:boolean;reused:boolean;
};
export class BacktestInputError extends Error {}
