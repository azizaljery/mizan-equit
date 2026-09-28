/** Serialize an ALREADY computed canonical projection. Never call forecasts() here. */
import {EVALUATION_POLICY} from './forecast-metrics';
import {candidateExclusion,type ScreenerCandidate} from './screener-policy';
import type {MarketReport} from './market-data';
import type {ResearchModelOutput} from './research-model';
export const SCREENER_ARCHIVE_VERSION='screener-forward-v1';
export type ScreenerEvidence={candidate:ScreenerCandidate;report:MarketReport;projection:ResearchModelOutput};
export async function archiveFingerprint(value:string){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function issuedScreenerSnapshot(runId:string,evidence:ScreenerEvidence){
 const {candidate:c,report,projection:p}=evidence;
 if(!/^[a-f0-9-]{36}$/.test(runId)||candidateExclusion(c)||report.mode!=='current'||report.company.symbol!==c.symbol||report.currency!==c.currency||p.rows.length!==1)throw Error('invalid-issued-screener-evidence');
 const row=p.rows[0];
 if(!row.available||row.direction!==c.direction||row.price!==c.price||row.predictedPrice!==c.predictedPrice||JSON.stringify(row.range)!==JSON.stringify(c.range)||row.confidence!==c.confidence||row.evaluationPolicy!==EVALUATION_POLICY||!p.createdAt||!row.window.anchorDate)throw Error('projection-does-not-match-candidate');
 const completedAnchor=report.prices.filter(bar=>bar.date<row.window.anchorDate).at(-1);
 const snapshotId=`screener:${runId}:${c.symbol}`,forecastId=`${snapshotId}:${row.sessions}`;
 const record={...row,id:forecastId,anchorDate:row.window.anchorDate,createdAt:p.createdAt,model:p.version,
  currency:report.currency,unit:'share',assetType:report.company.instrument||'EQUITY',priceTime:p.priceTime,source:report.priceSource,
  seriesBasis:{adjustment:report.priceAdjustment||null,anchorDate:completedAnchor?.date??null,anchorClose:completedAnchor?.close??null,definition:'آخر شمعة مكتملة قبل يوم الإصدار؛ نفس أساس سجل ميزان'},
  settingsUsed:p.settingsUsed,evidenceId:report.research?.recorded?report.research.id:null,accountKey:null,
  recordClass:'prospective-public',origin:'screener-candidate',screenerRunId:runId,
  probability:null,historicalAccuracy:null,calibrationStatus:'غير محسوبة في أرشيف الفرز؛ لا تُستنتج من الثقة',evidenceQuality:row.confidence};
 // Only source-derived input: this path never accepts an uploaded supplement.
 const snapshot={...report,forecast:undefined,changes:undefined,recordClass:'prospective-public',accountKey:null,origin:'screener-candidate',screenerRunId:runId};
 return {snapshotId,forecastId,record,snapshot,createdAt:p.createdAt,
  candidate:{...c,forecastId,forecastIssuedAt:p.createdAt,estimatedEndAt:row.window.estimatedEndAt,calendarVerified:row.window.calendarVerified}};
}
