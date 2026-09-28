/** Semantics shared by the CLI and its tests. HTTP 200 alone never means success. */
export function privateChecks(rec,symbol){
  const rows=rec?.forecast?.rows;
  return {identity:rec?.symbol===symbol,decision:typeof rec?.decision?.buy==='boolean'&&typeof rec.decision.explanation==='string'&&rec.decision.explanation.length>0,
    forecasts:Array.isArray(rows)&&rows.length===6&&[1,5,21,63,126,252].every(h=>rows.some(r=>r.sessions===h)),forecastRecorded:rec?.forecast?.recorded===true,sourceDetails:Array.isArray(rec?.evidence?.sources)};
}
export function backtestOk(value){
  return value?.kind==='mizan-issued-forecast-audit-v1'&&value.persisted===true&&value.symbolsSucceeded>0&&Array.isArray(value.symbolsFailed)&&value.symbolsFailed.length===0&&Array.isArray(value.byHorizon)&&value.byHorizon.some(h=>Number.isSafeInteger(h.completed)&&h.completed>0);
}
export function manualOk(value){
  const s=value?.summary;
  return s?.triggeredBy==='manual'&&s.status==='completed'&&s.stateSaved===true&&s.lockAcquired===true&&s.symbolsFailed===0&&Number.isSafeInteger(s.evaluationsSaved)&&s.evaluationsSaved>=0;
}
export async function collectChecks({request,run=false,symbols=[],pin,startDate,endDate,runId,now=()=>Date.now()}){
  const sections={};
  const section=async(name,fn,valid)=>{
    const started=now();
    try{const value=await fn(),ok=valid(value)===true;sections[name]={ok,status:ok?'passed':'failed',durationMs:Math.max(0,now()-started),value,...(ok?{}:{error:'الاستجابة وصلت لكن شرط التحقق لم يتحقق.'})};}
    catch(error){sections[name]={ok:false,status:'failed',durationMs:Math.max(0,now()-started),error:typeof error?.message==='string'?error.message:'تعذر الفحص.'};}
  };
  const skip=(name,reason)=>{sections[name]={ok:null,status:'not_run',durationMs:0,reason};};
  await section('stateKeys',()=>request('/api/admin/state?mode=keys&limit=100'),v=>Array.isArray(v?.keys)&&typeof v.hasMore==='boolean');
  await section('cronExists',()=>request('/api/admin/state?mode=exists&id=job:evaluate-due:last-cron'),v=>v?.exists===true);
  const fields='runId,triggeredBy,cron,scheduledTime,startedAt,finishedAt,status,lockAcquired,stateSaved,symbolsScanned,symbolsResolved,symbolsSkipped,symbolsFailed,evaluationsSaved,durationMs';
  for(const [name,id] of [['cronFields','job:evaluate-due:last-cron'],['lastRunFields','job:evaluate-due:last']])await section(name,()=>request('/api/admin/state?'+new URLSearchParams({mode:'fields',id,fields})),v=>!!v?.fields&&!v.fields._invalidJson&&!v.fields._omittedFields);
  await section('stateRows',()=>request('/api/admin/state?mode=list&limit=50'),v=>Array.isArray(v?.rows)&&Number.isSafeInteger(v.total));
  await section('verifyBefore',()=>request('/api/admin/verify'),v=>v?.readOnly===true&&v?.checks?.cron?.ok===true&&v?.checks?.forecasts?.ok===true&&v?.checks?.idempotency?.integrityOk===true);
  if(run){
    await section('manualTrigger',()=>request('/api/admin/run-background',{method:'POST',body:{limit:5}}),manualOk);
    if(startDate&&endDate&&symbols.length)await section('backtestSingle',()=>request('/api/admin/backtest',{method:'POST',body:{mode:'single',runId,symbols,startDate,endDate,horizons:[1,5,21,63,126,252]}}),backtestOk);
    else skip('backtestSingle','لم تُحدد الرموز وفترة الاختبار صراحة؛ لا نفترض وجود توقعات في عام قديم.');
    if(symbols.length){
      // One private attempt per symbol, sequential. Abort subsequent attempts after a failure
      // to avoid multiplying a transient outage.
      for(const [i,symbol] of symbols.entries()){
        await section('private_'+symbol,async()=>{
          const rec=await request('/api/private-recommendation',{method:'POST',body:{action:'view',symbol}});
          return {symbol,checks:privateChecks(rec,symbol)};
        },v=>Object.values(v.checks).every(Boolean));
        if(!sections['private_'+symbol].ok){for(const rest of symbols.slice(i+1))skip('private_'+rest,'لم تُكرر محاولة الدخول بعد تعثر المحاولة السابقة.');break;}
      }
    }else skip('private','لم تُحدد رموز محليًا؛ لم نحاول فتح القسم الخاص.');
    await section('verifyAfter',()=>request('/api/admin/verify'),v=>v?.readOnly===true&&v?.checks?.cron?.ok===true&&v?.checks?.forecasts?.ok===true&&v?.checks?.idempotency?.integrityOk===true);
  }else for(const name of ['manualTrigger','backtestSingle','private'])skip(name,'القراءة فقط هي الوضع الافتراضي؛ يتطلب هذا الفحص --run لأنه قد يحفظ نتائج.');
  const observed=sections.verifyAfter?.value||sections.verifyBefore?.value;
  sections.forecasts={ok:observed?.checks?.forecasts?.ok===true,status:observed?.checks?.forecasts?.ok===true?'passed':'failed',durationMs:0,value:observed?.checks?.forecasts??null};
  sections.idempotency={ok:null,status:'not_run',durationMs:0,value:observed?.checks?.idempotency??null,reason:'قراءة اتساق السجلات لا تثبت عدم التكرار؛ لم يُشغّل اختبار إعادة مضبوط على الإنتاج.'};
  return sections;
}
