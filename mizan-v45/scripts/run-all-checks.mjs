#!/usr/bin/env node
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {adminRequest} from './admin-http.mjs';
import {collectChecks} from './verification-checks.mjs';
import {saveReport,summarizeReport,renderHtml,renderMarkdown} from './verification-report.mjs';
try{
  const args=process.argv.slice(2);if(args.some(a=>!['--run','--render'].includes(a))||new Set(args).size!==args.length)throw Error('الاستخدام: node scripts/run-all-checks.mjs [--run] [--render]. الافتراضي للقراءة فقط.');
  if(!process.env.MIZAN_HOST||!process.env.MIZAN_COOKIE)throw Error('اضبط المضيف وجلسة المالك والإدارة محليًا، ولا ترسل الأسرار في المحادثة.');
  let host;try{host=new URL(process.env.MIZAN_HOST);}catch{throw Error('صيغة المضيف غير صالحة.');}if(host.username||host.password||host.search||host.hash||!['','/'].includes(host.pathname))throw Error('المضيف يجب أن يكون أصل الموقع فقط.');
  if(host.protocol!=='https:'&&!(host.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(host.hostname)))throw Error('يلزم HTTPS خارج الجهاز المحلي.');
  const symbols=(process.env.MIZAN_SYMBOLS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(symbols.length>3||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^([A-Z][A-Z0-9-]{0,14}|\d{4}\.SR)$/.test(s)))throw Error('حدد حتى 3 رموز صحيحة وفريدة متوافقة مع محرك الاختبار الحالي.');
  const startDate=process.env.MIZAN_BT_START,endDate=process.env.MIZAN_BT_END;
  if(startDate||endDate){if(![startDate,endDate].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)||startDate>endDate||endDate>=new Date().toISOString().slice(0,10)||Date.parse(endDate)-Date.parse(startDate)>5*366*864e5)throw Error('حدد فترة مكتملة صالحة لا تتجاوز خمس سنوات.');}
  if(process.env.MIZAN_RUN_ID&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(process.env.MIZAN_RUN_ID))throw Error('معرف التشغيل غير صالح.');
  const out=resolve(process.env.MIZAN_OUT_DIR||'verify-out');await mkdir(out,{recursive:true});const dir=await mkdtemp(join(out,'run-'));
  const report={generatedAt:new Date().toISOString(),host:host.origin,readOnly:!args.includes('--run'),runId:process.env.MIZAN_RUN_ID||'audit-'+randomUUID(),sections:{}};
  // Preserve the declared plan before any optional write request; never auto-retry mutations.
  await saveReport(join(dir,'plan.json'),JSON.stringify({...report,symbols,startDate,endDate},null,2));
  report.sections=await collectChecks({request:adminRequest,run:!report.readOnly,symbols,startDate,endDate,runId:report.runId});
  const summary=summarizeReport(report);
  await saveReport(join(dir,'run-all-checks.json'),JSON.stringify(report,null,2));
  await saveReport(join(dir,'run-all-checks-summary.json'),JSON.stringify(summary,null,2));
  if(args.includes('--render')){await saveReport(join(dir,'run-all-checks.html'),renderHtml(report));await saveReport(join(dir,'run-all-checks.md'),renderMarkdown(report));}
  console.log(JSON.stringify({...summary,reportDirectory:dir},null,2));process.exitCode=3;
}catch(error){console.error(error.message);process.exitCode=2;}
