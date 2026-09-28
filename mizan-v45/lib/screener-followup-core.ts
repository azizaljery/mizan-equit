import {validateFollowupConfig,type FollowupConfig} from './screener-operations-core';
/** Both markets advance alternately. Handles with access tokens never leave this function. */
export async function executeFollowup(config:FollowupConfig,deps:{create:(input:any)=>Promise<any>;batch:(id:string,token:string,index:number)=>Promise<any>;finish:(id:string,token:string)=>Promise<any>;save:(progress:any)=>Promise<void>;now:()=>number},budgetMs=540000){
 validateFollowupConfig(config);
 if(!Number.isInteger(budgetMs)||budgetMs<1000||budgetMs>600000)throw Error('invalid-followup-budget');
 const started=deps.now(),slots:any[]=[];
 const progress:any={status:'running',startedAt:new Date(started).toISOString(),finishedAt:null,markets:{sa:{state:'pending',runId:null,planned:0,scanned:0,analyzed:0,failed:0,eligible:0,nextBatch:0},us:{state:'pending',runId:null,planned:0,scanned:0,analyzed:0,failed:0,eligible:0,nextBatch:0}},stateSaved:false};
 const save=async()=>{await deps.save({...progress,stateSaved:true});progress.stateSaved=true;};
 await save();
 for(const market of ['sa','us']){
  const m=progress.markets[market];
  try{const h=await deps.create({market,scanLimit:config.scanPerMarket,resultCount:config.resultCount,horizonSessions:config.horizonSessions});
   if(!h.runId||!h.runToken||!Array.isArray(h.symbols)||!Number.isInteger(h.batchSize)||h.batchSize<1)throw Error('invalid-plan');
   m.runId=h.runId;m.planned=h.symbols.length;m.state='scanning';slots.push({market,handle:h,expected:Math.ceil(h.symbols.length/h.batchSize)});
  }catch{m.state='failed';m.reason='تعذر إنشاء خطة السوق؛ لم تُعتمد قائمة.';}
  await save();
 }
 let running=true;
 while(running){
  running=false;
  for(const slot of slots){
   const m=progress.markets[slot.market];if(m.state!=='scanning')continue;
   if(deps.now()-started>=budgetMs){m.state='incomplete';m.reason='انتهت ميزانية الدورة؛ يبقى الأرشيف جزئيًا ولا يعرض كقائمة نهائية.';await save();continue;}
   running=true;
   try{
    if(m.nextBatch<slot.expected){const b=await deps.batch(slot.handle.runId,slot.handle.runToken,m.nextBatch);if(!['scanned','analyzed','failed','eligible'].every(k=>Number.isInteger(b[k])&&b[k]>=0)||b.scanned!==Math.min(slot.handle.batchSize,m.planned-m.scanned)||b.analyzed+b.failed!==b.scanned||b.eligible>b.analyzed)throw Error('invalid-batch-counters');m.scanned+=b.scanned;m.analyzed+=b.analyzed;m.failed+=b.failed;m.eligible+=b.eligible;m.nextBatch++;await save();}
    if(m.nextBatch===slot.expected){const end=await deps.finish(slot.handle.runId,slot.handle.runToken);
     if(end.status!=='complete'||end.integrity!==true)throw Error('unsealed-archive');
     m.state='complete';m.selected=end.picks.length;m.fingerprint=end.fingerprint;
    }
   }catch{m.state='failed';m.reason='تعذر تحليل أو حفظ دفعة. أُبقي الأصل والدفعات السابقة؛ لا تُخفّض شروط النموذج.';}
   await save();
  }
 }
 progress.status=Object.values(progress.markets).every((v:any)=>v.state==='complete')?'completed':'partial';progress.finishedAt=new Date(deps.now()).toISOString();await save();return progress;
}
