#!/usr/bin/env node
import {adminRequest} from './admin-http.mjs';
import {manualOk} from './verification-checks.mjs';
// This explicitly requested run WRITES due evaluations through the existing engine.
try{
  const [, ,confirm,rawLimit='5',...extra]=process.argv;
  if(confirm!=='--run'||extra.length||!/^\d+$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>100)throw Error('هذا تشغيل يكتب التقييمات المستحقة: استخدم --run [limit من 1 إلى 100] بعد مراجعة السجلات.');
  const {summary}=await adminRequest('/api/admin/run-background',{method:'POST',body:{limit:Number(rawLimit)}});
  if(!summary||summary.triggeredBy!=='manual'||!Number.isInteger(summary.evaluationsSaved))throw Error('لم يصل ملخص صالح؛ راجع الحالة قبل إعادة التشغيل.');
  console.log(JSON.stringify({runId:summary.runId,status:summary.status,triggeredBy:summary.triggeredBy,stateSaved:summary.stateSaved,symbolsScanned:summary.symbolsScanned,symbolsResolved:summary.symbolsResolved,symbolsSkipped:summary.symbolsSkipped,symbolsFailed:summary.symbolsFailed,evaluationsSaved:summary.evaluationsSaved,integrity:summary.integrity},null,2));
  process.exitCode=manualOk({summary})?0:3;
}catch(error){console.error(error.message);process.exitCode=2;}
