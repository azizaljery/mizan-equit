#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';
import {adminRequest} from './admin-http.mjs';
try {
  const data=await adminRequest('/api/admin/verify');
  if(data.readOnly!==true||!['partial','fail'].includes(data.overall)||!data.checks?.cron||!data.checks?.idempotency)throw Error('بنية تقرير غير معروفة؛ لم يُعتمد نجاح.');
  const path=process.env.MIZAN_REPORT_PATH||`verify-prod-report-${Date.now()}.json`;
  // Exclusive creation prevents overwriting a prior evidence report.
  await writeFile(path,JSON.stringify(data,null,2),{encoding:'utf8',flag:'wx',mode:0o600});
  console.log('تقرير التحقق الإنتاجي — قراءة فقط');
  for(const c of Object.values(data.checks))console.log(`${c.ok?'✓':'غير مثبت'} ${c.label}\n${c.details}`);
  console.log(data.scope+'\nالتقرير: '+path);
  process.exitCode=data.overall==='fail'?2:3;
}catch{console.error('تعذر جلب التقرير أو حفظه؛ تحقق من الجلسة ومسار الملف. لم تُطبع بيانات الدخول.');process.exitCode=2;}
