/**
 * VOSA (Veto-Only Survival Architecture) core, adapted to Mizan's pure-function style. Evidence in, verdict out; no I/O except the injected clock/id/sink.
 * Constitution: the default is silence; every gate holds a veto only (PASS = permission to survive the gate, never acceptance or a buy);
 * KILL is final for that candidate+version+run; SUSPEND = evidence missing/invalid (not rankable); a ranker sees survivors only and cannot revive a rejected candidate.
 * Fail closed: a gate that throws, returns a foreign identity, or KILLs without proof becomes SUSPEND.
 */
export const VOSA_STATUSES=['PASS','KILL','SUSPEND'] as const;
export type VosaStatus=typeof VOSA_STATUSES[number];
export type VosaRunMode='EXECUTION'|'AUDIT';
export type Json=string|number|boolean|null|Json[]|{[k:string]:Json};
export type Finding={ruleId:string;message:string;observed?:unknown;required?:unknown};
export type GateResult={gateId:string;gateVersion:string;status:VosaStatus;findings:Finding[]};
export type CandidateIdentity={candidateId:string;version:number;payloadHash:string;parentVersion?:number|null};
export type VosaCandidate={identity:CandidateIdentity;payload:Readonly<Record<string,unknown>>};
export type GateContext={pipelineId:string;pipelineVersion:string;runId:string;mode:VosaRunMode;gateOrder:number};
export type VosaGate={gateId:string;gateVersion:string;pure:boolean;configHash:string;description:string;evaluate:(c:VosaCandidate,ctx:GateContext)=>GateResult|Promise<GateResult>};
export type AuditEvent={eventId:string;runId:string;pipelineId:string;pipelineVersion:string;mode:VosaRunMode;candidate:CandidateIdentity;gate:{gateId:string;gateVersion:string};gateOrder:number;
 gateConfigHash:string;status:VosaStatus;findings:Finding[];startedAt:string;completedAt:string;durationMs:number};
export type VosaEvaluation={candidate:CandidateIdentity;finalStatus:VosaStatus;gateResults:GateResult[];auditTrail:AuditEvent[];pipelineId:string;pipelineVersion:string;runId:string;mode:VosaRunMode};
export type VosaOptions={pipelineId:string;pipelineVersion:string;mode?:VosaRunMode;now?:()=>Date;makeId?:()=>string;auditSink?:{append:(e:AuditEvent)=>void|Promise<void>}};
export type Ranked={rank:number;score:number;candidate:VosaCandidate};
export type ConflictReport={code:'CONSTRAINT_CONFLICT';candidates:number;byStatus:Record<VosaStatus,number>;byGate:Record<string,{KILL:number;SUSPEND:number}>;message:string};
export type VosaSelection={evaluations:VosaEvaluation[];ranking:Ranked[];conflict:ConflictReport|null};

const PRECEDENCE:Record<VosaStatus,number>={PASS:0,SUSPEND:1,KILL:2};

/** Makes any value JSON-safe for audit/export: non-finite numbers become the strings 'NaN'/'Infinity'/'-Infinity' (never silently dropped). */
export function jsonSafe(v:unknown):Json{
 if(v===null||v===undefined)return null;
 if(typeof v==='number')return Number.isFinite(v)?v:(Number.isNaN(v)?'NaN':v>0?'Infinity':'-Infinity');
 if(typeof v==='string'||typeof v==='boolean')return v;
 if(Array.isArray(v))return v.map(jsonSafe);
 if(typeof v==='object'){const o:{[k:string]:Json}={};for(const k of Object.keys(v as object).sort())o[k]=jsonSafe((v as Record<string,unknown>)[k]);return o;}
 return String(v);
}
function canonical(v:unknown,path='$'):string{
 if(v===null)return 'null';
 if(typeof v==='number'){if(!Number.isFinite(v))throw new TypeError(`non-finite number at ${path}`);return JSON.stringify(v);}
 if(typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map((x,i)=>canonical(x,`${path}[${i}]`)).join(',')+']';
 if(typeof v==='object')return '{'+Object.keys(v as object).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k],`${path}.${k}`)).join(',')+'}';
 throw new TypeError(`unsupported value at ${path}`);
}
/** SHA-256 (hex) of the canonical JSON (sorted keys). Rejects NaN/Infinity/undefined instead of hashing a silent substitute. */
export async function canonicalHash(v:unknown):Promise<string>{
 const bytes=new TextEncoder().encode(canonical(v)),d=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...d].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** Builds a candidate; the payload hash is taken over the JSON-safe form so a NaN field is hashed as the visible marker 'NaN' (and the gates then SUSPEND it). */
export async function makeCandidate(candidateId:string,version:number,payload:Record<string,unknown>,parentVersion:number|null=null):Promise<VosaCandidate>{
 if(!candidateId.trim())throw new Error('empty candidateId');
 if(!Number.isInteger(version)||version<1)throw new Error('version must be an integer >= 1');
 return {identity:{candidateId,version,payloadHash:await canonicalHash(jsonSafe(payload)),parentVersion},payload:Object.freeze({...payload})};
}
/** A corrected payload is a NEW immutable version: it starts from scratch and inherits no verdict (no inherited KILL, no inherited PASS). */
export const nextVersion=(c:VosaCandidate,payload:Record<string,unknown>)=>makeCandidate(c.identity.candidateId,c.identity.version+1,payload,c.identity.version);
/** Gate identity helper: hashes the frozen configuration so every audit event proves which thresholds produced it. */
export async function makeGate(g:{gateId:string;gateVersion:string;pure?:boolean;description:string;config:Record<string,unknown>;evaluate:VosaGate['evaluate']}):Promise<VosaGate>{
 if(!g.gateId||!g.gateVersion)throw new Error('gate identity required');
 return {gateId:g.gateId,gateVersion:g.gateVersion,pure:g.pure!==false,configHash:await canonicalHash(jsonSafe(g.config)),description:g.description,evaluate:g.evaluate};
}

const failClosed=(g:{gateId:string;gateVersion:string},ruleId:string,message:string,observed:unknown):GateResult=>({gateId:g.gateId,gateVersion:g.gateVersion,status:'SUSPEND',findings:[{ruleId,message,observed:jsonSafe(observed),required:'successful deterministic gate evaluation'}]});

/** Runs the gates in order. EXECUTION stops at the first KILL/SUSPEND; AUDIT runs all (pure gates only). Final status follows KILL > SUSPEND > PASS. */
export async function vosaEvaluate(gates:readonly VosaGate[],candidate:VosaCandidate,opts:VosaOptions):Promise<VosaEvaluation>{
 if(!gates.length)throw new Error('at least one VOSA gate is required');
 const ids=gates.map(g=>g.gateId+'@'+g.gateVersion);if(new Set(ids).size!==ids.length)throw new Error('duplicate gate identity');
 const mode=opts.mode??'EXECUTION',now=opts.now??(()=>new Date()),makeId=opts.makeId??(()=>crypto.randomUUID());
 if(mode==='AUDIT'&&gates.some(g=>!g.pure))throw new Error('AUDIT mode permits pure read-only gates only');
 const runId=makeId(),results:GateResult[]=[],audit:AuditEvent[]=[];
 for(const [i,g] of gates.entries()){
  const order=i+1,started=now();let r:GateResult;
  try{
   r=await g.evaluate(candidate,{pipelineId:opts.pipelineId,pipelineVersion:opts.pipelineVersion,runId,mode,gateOrder:order});
   if(!r||r.gateId!==g.gateId||r.gateVersion!==g.gateVersion)r=failClosed(g,'GATE-IDENTITY-CONFLICT','Gate result identity conflict',{expected:ids[i],got:r?`${r.gateId}@${r.gateVersion}`:null});
   else if(!VOSA_STATUSES.includes(r.status))r=failClosed(g,'GATE-INVALID-STATUS','Gate returned an unknown status',r.status);
   else if(r.status==='KILL'&&!(r.findings?.length>0))r=failClosed(g,'KILL-WITHOUT-PROOF','A KILL requires at least one finding as proof',null);
   else r={gateId:r.gateId,gateVersion:r.gateVersion,status:r.status,findings:(r.findings||[]).map(f=>({ruleId:String(f.ruleId),message:String(f.message),observed:jsonSafe(f.observed),required:jsonSafe(f.required)}))};
  }catch(e){r=failClosed(g,'GATE-EXCEPTION','Gate failed closed',{name:e instanceof Error?e.name:'UnknownError',message:e instanceof Error?e.message:String(e)});}
  const done=now(),ev:AuditEvent={eventId:makeId(),runId,pipelineId:opts.pipelineId,pipelineVersion:opts.pipelineVersion,mode,candidate:candidate.identity,gate:{gateId:g.gateId,gateVersion:g.gateVersion},
   gateOrder:order,gateConfigHash:g.configHash,status:r.status,findings:r.findings,startedAt:started.toISOString(),completedAt:done.toISOString(),durationMs:done.getTime()-started.getTime()};
  results.push(r);audit.push(ev);await opts.auditSink?.append(ev);
  if(mode==='EXECUTION'&&r.status!=='PASS')break;
 }
 const finalStatus=results.reduce<VosaStatus>((cur,r)=>PRECEDENCE[r.status]>PRECEDENCE[cur]?r.status:cur,'PASS');
 return {candidate:candidate.identity,finalStatus,gateResults:results,auditTrail:audit,pipelineId:opts.pipelineId,pipelineVersion:opts.pipelineVersion,runId,mode};
}
/** Audit export: complete and always valid JSON (non-finite numbers are written as visible markers). */
export const auditToJson=(events:readonly AuditEvent[])=>JSON.stringify(events.map(e=>jsonSafe(e)));

/** Survivors only reach the ranker. A forged finalStatus cannot revive a candidate: the status is recomputed from the gate results. A non-finite score is a hard error. */
export async function vosaSelect(items:readonly {candidate:VosaCandidate;evaluation:VosaEvaluation}[],ranker:(c:VosaCandidate)=>number|Promise<number>):Promise<VosaSelection>{
 const byStatus:Record<VosaStatus,number>={PASS:0,KILL:0,SUSPEND:0},byGate:ConflictReport['byGate']={},scored:{score:number;candidate:VosaCandidate}[]=[];
 for(const {candidate,evaluation} of items){
  const real=evaluation.gateResults.length?evaluation.gateResults.reduce<VosaStatus>((c,r)=>PRECEDENCE[r.status]>PRECEDENCE[c]?r.status:c,'PASS'):'SUSPEND';
  const st:VosaStatus=PRECEDENCE[real]>PRECEDENCE[evaluation.finalStatus]?real:evaluation.finalStatus;
  byStatus[st]++;
  if(st!=='PASS'){for(const r of evaluation.gateResults)if(r.status!=='PASS'){(byGate[r.gateId]??={KILL:0,SUSPEND:0})[r.status]++;}continue;}
  const score=Number(await ranker(candidate));
  if(!Number.isFinite(score))throw new TypeError(`ranker returned a non-finite score for ${candidate.identity.candidateId}`);
  scored.push({score,candidate});
 }
 scored.sort((a,b)=>b.score-a.score||a.candidate.identity.candidateId.localeCompare(b.candidate.identity.candidateId)||a.candidate.identity.version-b.candidate.identity.version);
 const conflict:ConflictReport|null=scored.length?null:{code:'CONSTRAINT_CONFLICT',candidates:items.length,byStatus,byGate,message:'لا ناجٍ: القيود متعارضة أو الأدلة ناقصة. لا يُمرَّر «أقل المرفوضين سوءًا».'};
 return {evaluations:items.map(i=>i.evaluation),ranking:scored.map((s,i)=>({rank:i+1,score:s.score,candidate:s.candidate})),conflict};
}
