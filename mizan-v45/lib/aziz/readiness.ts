// Aziz readiness (spec 2026-10-21, phase 3). Read-only: it inspects the model registry and the archived data
// summary, never trains, never forecasts, never writes. Creating a research forecast is a separate, authorised
// operation that does not exist in this release.
import {AZIZ_HORIZONS,AZIZ_MODE,AZIZ_MODEL_REGISTRY,checkModelUsable,latestModel,type AzizIssueType,type AzizModelEntry} from './model-registry';

export type AzizStatus='ready'|'partial'|'collecting'|'insufficient_data'|'model_missing'|'model_rejected'|'suspended'|'error';
export type Reason={code:string;message:string};
export type DataSummary={bars:number;firstSession:string|null;lastSession:string|null;pointInTimeBars:number;lastRetrievedAt:string|null};
/** Reader contract: SELECT-only access. Implementations must not mutate anything. */
export type DataReader=(market:'sa'|'us',symbol:string)=>Promise<DataSummary|null>;

/** Minimum archived sessions before any model could even be evaluated (126+5 feature window + 21 target + buffer). Operational floor, not a statistical sufficiency claim. */
export const MIN_SESSIONS=260;
/** Calendar days after which the archive is stale for a new issue. */
export const STALE_DAYS=10;

export const DATA_SUMMARY_SQL="SELECT COUNT(*) AS bars, MIN(b.session_date) AS firstSession, MAX(b.session_date) AS lastSession, "+
 "SUM(CASE WHEN b.availability_basis='provider_published_time' AND b.available_at IS NOT NULL THEN 1 ELSE 0 END) AS pointInTimeBars, "+
 "MAX(b.retrieved_at) AS lastRetrievedAt FROM aziz_market_bars b JOIN aziz_symbols s ON s.id=b.symbol_id WHERE s.market=? AND s.symbol=?";

/** D1 reader. The statement is a single SELECT; the guard makes a future edit that adds a write fail loudly. */
export function d1DataReader(DB:{prepare:(sql:string)=>{bind:(...v:unknown[])=>{first:()=>Promise<any>}}}):DataReader{
 if(!/^\s*SELECT\s/i.test(DATA_SUMMARY_SQL)||/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(DATA_SUMMARY_SQL))throw Error('readiness reader must be SELECT-only');
 return async(market,symbol)=>{const r=await DB.prepare(DATA_SUMMARY_SQL).bind(market,symbol).first();
  if(!r)return null;return {bars:Number(r.bars)||0,firstSession:r.firstSession??null,lastSession:r.lastSession??null,pointInTimeBars:Number(r.pointInTimeBars)||0,lastRetrievedAt:r.lastRetrievedAt??null};};
}

type SlotStatus={horizonSessions:number;issueType:AzizIssueType;modelVersion:string|null;status:'model_missing'|'model_rejected'|'suspended'|'not_approved'|'usable_research';code:string;message:string;evaluationReportId:string|null};

export function slotStatuses(market:'sa'|'us',asOf:string,registry:readonly AzizModelEntry[]=AZIZ_MODEL_REGISTRY):SlotStatus[]{
 const out:SlotStatus[]=[];
 for(const h of AZIZ_HORIZONS)for(const issueType of (h===21?['direct','bridge_5_to_21']:['direct']) as AzizIssueType[]){
  const e=latestModel(market,h,issueType,registry);const c=checkModelUsable(e,{market,horizonSessions:h,issueType,purpose:'research',asOf});
  const status=c.usable?'usable_research':c.code==='model_rejected'?'model_rejected':c.code==='model_suspended'?'suspended':c.code==='model_missing'?'model_missing':'not_approved';
  out.push({horizonSessions:h,issueType,modelVersion:e?.modelVersion??null,status,code:c.usable?'usable_research':c.code,message:c.usable?'نموذج بحثي صالح للاستخدام البحثي فقط.':c.message,evaluationReportId:e?.evaluationReportId??null});
 }
 return out;
}

export function assessData(summary:DataSummary|null,now:Date):{eligibility:'eligible'|'exploratory_only'|'insufficient'|'not_imported'|'unavailable';ready:boolean;reasons:Reason[]}{
 if(summary===null)return {eligibility:'unavailable',ready:false,reasons:[{code:'data_unavailable',message:'تعذر قراءة أرشيف بيانات عزيز؛ لم يُحكم على الشركة.'}]};
 if(!summary.bars)return {eligibility:'not_imported',ready:false,reasons:[{code:'data_not_imported',message:'لا توجد أسعار مؤرشفة لهذه الشركة في أرشيف عزيز.'}]};
 const reasons:Reason[]=[];
 if(summary.bars<MIN_SESSIONS)reasons.push({code:'insufficient_history',message:`الأرشيف ${summary.bars} جلسة، والحد التشغيلي الأدنى ${MIN_SESSIONS}.`});
 if(summary.lastSession&&(now.getTime()-Date.parse(summary.lastSession+'T00:00:00Z'))/864e5>STALE_DAYS)reasons.push({code:'data_stale',message:`آخر جلسة مؤرشفة ${summary.lastSession}؛ أقدم من ${STALE_DAYS} أيام.`});
 if(reasons.length)return {eligibility:'insufficient',ready:false,reasons};
 if(summary.pointInTimeBars<summary.bars)return {eligibility:'exploratory_only',ready:false,reasons:[{code:'availability_not_point_in_time',message:'الأسعار محفوظة بوقت الجلب فقط (availableAt غير موثق)؛ تصلح للاستكشاف ولا تصلح دليلًا زمنيًا حاسمًا.'}]};
 return {eligibility:'eligible',ready:true,reasons:[]};
}

export async function buildReadiness(input:{market:'sa'|'us';company:{symbol:string;name:string};restriction:{reason:string}|null;reader:DataReader|null;now?:Date;registry?:readonly AzizModelEntry[]}){
 const now=input.now??new Date(),asOf=now.toISOString();
 let summary:DataSummary|null=null,readerError=false;
 if(input.reader){try{summary=await input.reader(input.market,input.company.symbol);}catch{readerError=true;}}
 const data=assessData(readerError||!input.reader?null:summary,now);
 const slots=slotStatuses(input.market,asOf,input.registry);
 const modelReady=slots.some(s=>s.status==='usable_research');
 const reasons:Reason[]=[];
 if(input.restriction)reasons.push({code:'listing_restricted',message:input.restriction.reason});
 if(!modelReady){
  if(slots.some(s=>s.status==='model_rejected'))reasons.push({code:'model_rejected',message:'نموذج الاتجاه المسجل لعزيز (DIR-0001) مرفوض بقرار موثق؛ لا يُستخدم ولا تُعرض احتمالاته.'});
  if(slots.some(s=>s.status==='model_missing'))reasons.push({code:'model_missing',message:'لا يوجد أثر نموذج مدرّب ومجمد لبقية الآفاق ونوع الجسر 5→21.'});
 }
 reasons.push(...data.reasons);
 reasons.push({code:'calibration_not_ready',message:'لا توجد معايرة احتمال أو نطاق صالحة؛ الاحتمال والنطاق غير متاحين.'});
 reasons.push({code:'monitor_not_ready',message:'لا توجد حالة مراقب مسجلة لأي نموذج معتمد.'});
 if(AZIZ_MODE==='OFF')reasons.push({code:'mode_off',message:'وضع عزيز OFF؛ لا إصدار بحثي ولا تأثير على توصيات ميزان.'});
 const status:Exclude<AzizStatus,'ready'|'partial'|'collecting'>|'error'=readerError?'error':slots.some(s=>s.status==='suspended')?'suspended':!modelReady&&slots.every(s=>s.status==='model_rejected'||s.status==='model_missing')&&slots.some(s=>s.status==='model_rejected')?'model_rejected':!modelReady?'model_missing':'insufficient_data';
 return {schemaVersion:2,engine:'aziz' as const,operation:'readiness' as const,company:input.company,market:input.market,
  status,mode:AZIZ_MODE,
  readiness:{dataReady:data.ready,modelReady,calibrationReady:false,monitorReady:false},
  researchForecastAvailable:false,productionUseApproved:false,
  forecast:null,recorded:false,modelVersion:null,artifactId:null,targetSession:null,
  dataEligibility:data.eligibility,
  data:summary&&!readerError?{bars:summary.bars,firstSession:summary.firstSession,lastSession:summary.lastSession,pointInTimeBars:summary.pointInTimeBars}:null,
  sourceAsOf:summary&&!readerError?summary.lastRetrievedAt:null,
  componentStatus:{data:readerError?'error':data.eligibility,model:modelReady?'usable_research':slots.some(x=>x.status==='model_rejected')?'model_rejected':'model_missing',calibration:'not_available',monitor:'not_available',listing:input.restriction?'restricted':'ok'},
  horizons:slots,abstentionReasons:reasons,checkedAt:asOf};
}
export type ReadinessResponse=Awaited<ReturnType<typeof buildReadiness>>;
