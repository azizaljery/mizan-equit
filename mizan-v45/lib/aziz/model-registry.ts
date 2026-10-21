// Aziz model registry (spec 2026-10-21, phase 2). Code-reviewed, append-only list: an entry is never edited
// after it is published; a change is a new entry. No entry here may be used for production unless its status is
// 'active_approved' AND approvedBy/approvedAt are set — and no such entry exists in this release.
export type AzizModelStatus='trained'|'rejected'|'shadow_approved'|'active_approved'|'suspended';
export type AzizIssueType='direct'|'bridge_5_to_21';
export type AzizMode='OFF'|'REPLAY'|'SHADOW'|'ASSIST'|'ACTIVE';
export type AzizModelEntry=Readonly<{
 modelFamily:string;modelVersion:string;artifactId:string|null;artifactHash:string|null;
 market:'sa'|'us';issueType:AzizIssueType;horizonSessions:5|21;featureSchemaVersion:string;
 trainedThrough:string|null;calibratedThrough:string|null;validFrom:string|null;expiresAt:string|null;
 trainingDatasetHash:string|null;policyHash:string|null;evaluationReportId:string;
 status:AzizModelStatus;approvedBy:string|null;approvedAt:string|null;note:string;
}>;

/** Only horizons the Aziz package supports. 63/126/252 are NOT supported (spec 5.22). */
export const AZIZ_HORIZONS=[5,21] as const;
/** Global switch for this release. Changing it requires a separate owner authorisation (spec §1). */
export const AZIZ_MODE:AzizMode='OFF';

export const AZIZ_MODEL_REGISTRY:readonly AzizModelEntry[]=Object.freeze([
 Object.freeze({modelFamily:'aziz-direction-logistic-platt',modelVersion:'dir-0001-dev',artifactId:null,artifactHash:null,
  market:'sa',issueType:'direct',horizonSessions:5,featureSchemaVersion:'negsel-v1(mom126_5=ln(P[t-5]/P[t-126]),trend50_200,mom252_21,rev5,vol63)',
  trainedThrough:null,calibratedThrough:null,validFrom:null,expiresAt:null,trainingDatasetHash:null,policyHash:'protocol:9f7d4b5',
  evaluationReportId:'research/DIR-0001-DEV-REPORT.md',status:'rejected',approvedBy:null,approvedAt:null,
  note:'DIR-0001 REJECTED (FA-004, 2026-10-18): lift +3.26 [−0.19,+6.71]، BSS −0.031، معايرة فاشلة.'}),
 Object.freeze({modelFamily:'aziz-direction-logistic-platt',modelVersion:'dir-0001-dev',artifactId:null,artifactHash:null,
  market:'sa',issueType:'direct',horizonSessions:21,featureSchemaVersion:'negsel-v1',
  trainedThrough:null,calibratedThrough:null,validFrom:null,expiresAt:null,trainingDatasetHash:null,policyHash:'protocol:9f7d4b5',
  evaluationReportId:'research/DIR-0001-DEV-REPORT.md',status:'rejected',approvedBy:null,approvedAt:null,
  note:'فرضية ثانوية ضمن DIR-0001 المرفوضة؛ لا تُستخدم.'}),
 Object.freeze({modelFamily:'aziz-direction-logistic-platt',modelVersion:'dir-0001-dev',artifactId:null,artifactHash:null,
  market:'us',issueType:'direct',horizonSessions:5,featureSchemaVersion:'negsel-v1',
  trainedThrough:null,calibratedThrough:null,validFrom:null,expiresAt:null,trainingDatasetHash:null,policyHash:'protocol:9f7d4b5',
  evaluationReportId:'research/DIR-0001-DEV-REPORT.md',status:'rejected',approvedBy:null,approvedAt:null,
  note:'فرضية ثانوية ضمن DIR-0001 المرفوضة؛ لا تُستخدم.'}),
 Object.freeze({modelFamily:'aziz-direction-logistic-platt',modelVersion:'dir-0001-dev',artifactId:null,artifactHash:null,
  market:'us',issueType:'direct',horizonSessions:21,featureSchemaVersion:'negsel-v1',
  trainedThrough:null,calibratedThrough:null,validFrom:null,expiresAt:null,trainingDatasetHash:null,policyHash:'protocol:9f7d4b5',
  evaluationReportId:'research/DIR-0001-DEV-REPORT.md',status:'rejected',approvedBy:null,approvedAt:null,
  note:'فرضية ثانوية ضمن DIR-0001 المرفوضة؛ لا تُستخدم.'}),
]);

export type UsabilityCheck={usable:false;code:string;message:string}|{usable:true;entry:AzizModelEntry};
export type UsabilityQuery={market:'sa'|'us';horizonSessions:number;issueType:AzizIssueType;purpose:'research'|'production';asOf:string;featureSchemaVersion?:string};

/** Central gate: identity, horizon, issue type, status, approval, validity window, future artifact. Never falls back to another market/horizon. */
export function checkModelUsable(entry:AzizModelEntry|undefined|null,q:UsabilityQuery):UsabilityCheck{
 const no=(code:string,message:string):UsabilityCheck=>({usable:false,code,message});
 if(!entry)return no('model_missing','لا يوجد نموذج عزيز مسجل لهذا السوق والأفق ونوع الإصدار.');
 if(entry.market!==q.market||entry.horizonSessions!==q.horizonSessions||entry.issueType!==q.issueType)return no('model_identity_mismatch','النموذج المسجل لا يطابق السوق أو الأفق أو نوع الإصدار المطلوب.');
 if(q.featureSchemaVersion&&entry.featureSchemaVersion!==q.featureSchemaVersion)return no('feature_schema_mismatch','إصدار الميزات لا يطابق النموذج.');
 if(entry.status==='rejected')return no('model_rejected','النموذج مرفوض بقرار مسجل ('+entry.evaluationReportId+').');
 if(entry.status==='suspended')return no('model_suspended','النموذج معلّق.');
 if(!entry.artifactId||!entry.artifactHash)return no('artifact_missing','لا يوجد أثر تدريب مجمد ببصمة.');
 if(entry.trainedThrough&&entry.trainedThrough>q.asOf)return no('artifact_from_future','أثر التدريب يتضمن بيانات بعد وقت الطلب.');
 if(entry.validFrom&&q.asOf<entry.validFrom)return no('artifact_not_yet_valid','الأثر لم يبدأ صلاحيته.');
 if(entry.expiresAt&&q.asOf>=entry.expiresAt)return no('artifact_expired','انتهت صلاحية الأثر.');
 if(q.purpose==='production'){
  if(entry.status!=='active_approved'||!entry.approvedBy||!entry.approvedAt)return no('production_not_approved','لا يوجد اعتماد مالك للاستخدام الفعلي.');
  if(AZIZ_MODE!=='ACTIVE')return no('mode_not_active','وضع عزيز ليس ACTIVE.');
 }
 return {usable:true,entry};
}

/** Latest published entry for a slot (entries are append-only; the last one wins). */
export function latestModel(market:'sa'|'us',horizonSessions:number,issueType:AzizIssueType,registry:readonly AzizModelEntry[]=AZIZ_MODEL_REGISTRY){
 for(let i=registry.length-1;i>=0;i--){const e=registry[i];if(e.market===market&&e.horizonSessions===horizonSessions&&e.issueType===issueType)return e;}
 return null;
}
