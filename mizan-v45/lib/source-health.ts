/** Read/transport telemetry only; successful reads are not a data-quality verdict. */
export async function recordSourceRead(db:any,sourceId:string,ok:boolean,latencyMs:number,at:string){
 if(!sourceId||!Number.isFinite(latencyMs)||latencyMs<0||!Number.isFinite(Date.parse(at)))throw Error('Invalid source telemetry');
 await db.prepare(`INSERT INTO source_health(source_id,state,success_count,failure_count,avg_latency_ms,last_success_at,last_failure_at,last_error,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
 state=CASE WHEN excluded.updated_at>=source_health.updated_at THEN excluded.state ELSE source_health.state END,
 avg_latency_ms=(COALESCE(source_health.avg_latency_ms,0)*(source_health.success_count+source_health.failure_count)+excluded.avg_latency_ms)/(source_health.success_count+source_health.failure_count+1),
 success_count=source_health.success_count+excluded.success_count,failure_count=source_health.failure_count+excluded.failure_count,
 last_success_at=CASE WHEN excluded.last_success_at IS NOT NULL AND (source_health.last_success_at IS NULL OR excluded.last_success_at>source_health.last_success_at) THEN excluded.last_success_at ELSE source_health.last_success_at END,
 last_failure_at=CASE WHEN excluded.last_failure_at IS NOT NULL AND (source_health.last_failure_at IS NULL OR excluded.last_failure_at>source_health.last_failure_at) THEN excluded.last_failure_at ELSE source_health.last_failure_at END,
 last_error=CASE WHEN excluded.updated_at>=source_health.updated_at THEN excluded.last_error ELSE source_health.last_error END,
 updated_at=MAX(source_health.updated_at,excluded.updated_at)`)
 .bind(sourceId,ok?'read_ok':'read_failed',ok?1:0,ok?0:1,latencyMs,ok?at:null,ok?null:at,ok?null:'تعذرت قراءة المصدر؛ تفاصيل المحاولة في source_status.',at).run();
}
