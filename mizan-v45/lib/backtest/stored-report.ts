import {parseBacktestConfig,summarizeBacktest} from './runner';
import type {BacktestRunResult} from './types';
/** Only the issued-forecast report contract can enter its exporters/aggregator. */
export function readStoredReport(data:unknown):BacktestRunResult{
 if(typeof data!=='string'||new TextEncoder().encode(data).byteLength>1000000)throw Error('تقرير غير صالح أو أكبر من الحد.');
 const run=JSON.parse(data);
 if(!run||run.kind!=='mizan-issued-forecast-audit-v1'||typeof run.runId!=='string'||!Number.isFinite(Date.parse(run.completedAt))||!Array.isArray(run.observations)||run.observations.length>10000)throw Error('نوع التقرير غير مدعوم في هذا التصدير.');
 const config=parseBacktestConfig(run.config);
 // Recompute summaries from the stored observations, never accept an arbitrary posted aggregate.
 const byHorizon=summarizeBacktest(run.observations,config.horizons);
 return {...run,config,byHorizon};
}
