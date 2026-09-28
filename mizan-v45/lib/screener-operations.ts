/** Read the existing sealed cohorts; do not generate or revise a forecast here. */
import {performanceStats} from './forecast-journal';
import {FOLLOWUP_DEFAULT,validateFollowupConfig,summarizeSelectedForecasts,makeAgentWorkPlan} from './screener-operations-core';
export const FOLLOWUP_CONFIG_ID='screener:followup:config:v1';
export const FOLLOWUP_LAST_ID='job:screener-followup:last';
export async function operationsRows(db:any,sql:string,params:unknown[]=[]){
 const stmt=db.prepare(sql),r=await (params.length?stmt.bind(...params):stmt).all();
 if(r?.success===false||!Array.isArray(r?.results))throw Error('screener-operations-read-failed');return r.results;
}
export async function readFollowupConfig(db:any){
 const row=await db.prepare('SELECT data,updated_at FROM research_state WHERE id=?').bind(FOLLOWUP_CONFIG_ID).first();
 if(!row)return {config:{...FOLLOWUP_DEFAULT},updatedAt:null};
 const parsed=JSON.parse(row.data);return {config:validateFollowupConfig(parsed.config),updatedAt:row.updated_at};
}
export async function saveFollowupConfig(db:any,input:unknown){
 const config=validateFollowupConfig(input),updatedAt=new Date().toISOString();
 const saved=await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(FOLLOWUP_CONFIG_ID,JSON.stringify({config}),updatedAt).run();
 if(saved?.success===false)throw Error('followup-config-save-failed');return {config,updatedAt};
}
export async function readScreenerOperations(db:any){
 const [settings,cohorts,counts,picks,sources,last,prior]=await Promise.all([
  readFollowupConfig(db),
  operationsRows(db,'SELECT id,created_at,completed_at,status,plan_json,result_json FROM screener_runs ORDER BY created_at DESC,id DESC LIMIT 12'),
  operationsRows(db,'SELECT status,COUNT(*) AS n FROM screener_runs GROUP BY status'),
  operationsRows(db,`SELECT p.run_id,f.id,f.symbol,f.created_at,f.market,f.horizon,f.model,f.sector,f.confidence,f.available,
    json_extract(f.data,'$.recordClass') AS recordClass,json_extract(f.data,'$.evaluationPolicy') AS evaluationPolicy,o.data AS outcome_data
    FROM screener_picks p JOIN screener_runs r ON r.id=p.run_id JOIN forecast_records f ON f.id=p.forecast_id
    LEFT JOIN forecast_outcomes o ON o.id=f.id WHERE r.status='complete' AND json_valid(f.data)
    ORDER BY f.created_at DESC,f.id DESC,p.run_id DESC LIMIT 10000`),
  operationsRows(db,'SELECT id,status,last_attempt,last_success FROM source_status ORDER BY id LIMIT 60'),
  db.prepare('SELECT data,updated_at FROM research_state WHERE id=?').bind(FOLLOWUP_LAST_ID).first(),
  operationsRows(db,"SELECT id,created_at,status,task,data FROM council_runs ORDER BY created_at DESC,id DESC LIMIT 3"),
 ]);
 const rows=picks.map((r:any)=>{try{return {...r,outcome:r.outcome_data?JSON.parse(r.outcome_data):null};}catch{return {...r,outcome:null,outcomeParseError:true};}});
 const recent=cohorts.map((r:any)=>{
  const p=JSON.parse(r.plan_json),f=r.result_json?JSON.parse(r.result_json):null;
  return {id:r.id,createdAt:r.created_at,completedAt:r.completed_at,status:r.status,market:p.market,horizon:p.horizonSessions,modelVersion:p.modelVersion,planned:p.symbols.length,
   selected:f?.result?.returned??null,analyzed:f?.result?.analyzed??null,failed:f?.result?.failed??null,
   exclusions:f?.result?.exclusionCounts??{},failures:(f?.result?.failures??[]).slice(0,3).map((x:any)=>({symbol:x.symbol,reason:typeof x.reason==='string'?x.reason.slice(0,200):'unknown'}))};
 });
 const previousReviews=prior.map((r:any)=>{try{const d=JSON.parse(r.data);return {id:r.id,createdAt:r.created_at,status:r.status,executionStatus:d.executionStatus??null,workVersion:typeof r.task==='string'&&r.task.includes('screener-followup-v1')?'screener-followup-v1':null,taskIds:typeof r.task==='string'?['DATA-01','OPS-01','QA-01','QUANT-01','RD-01','RD-02','SEC-01'].filter(id=>r.task.includes(id)):[],securityDecision:d.securityReviewer?.decision?.decision??null};}catch{return {id:r.id,status:'invalid-record'};}});
 const out={asOf:new Date().toISOString(),settings,cohortCounts:counts,recent,performance:summarizeSelectedForecasts(rows,performanceStats),sources,
  sampleCap:10000,sampleCapReached:picks.length===10000,lastFollowup:last?{updatedAt:last.updated_at,summary:JSON.parse(last.data)}:null,previousReviews,
  benchmark:{state:'not_implemented',availableBaseline:'unchanged-price-error',note:'هذا خطأ التوقع مقارنة بثبات السعر؛ ليس تفوقًا على تاسي أو S&P 500 ولا عائد محفظة.'},
  modelComparison:{state:'not_validated',note:'اختبار النسخة البديلة خارج عينة التطوير مطلوب قبل أي اعتماد. لا تعديل تلقائي للأوزان.'},
  note:'الأداء من القوائم المثبتة فقط، لا المرشحين الوسيطين. الدقة بالنسبة المئوية من policy ميزان؛ غياب نتائج ناضجة لا يعني دقة صفر، والتشغيل الجزئي لا يثبت اكتمال المسح.'};
 return {...out,workPacket:makeAgentWorkPlan(out)};
}
