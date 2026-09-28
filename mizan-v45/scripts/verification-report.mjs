import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const escapeHtml=s=>String(s??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const escapeMd=s=>escapeHtml(s).replaceAll('|','&#124;').replaceAll('`','&#96;').replaceAll('\n',' ').replaceAll('\r',' ');
const state=s=>['passed','failed','not_run'].includes(s?.status)?s.status:s?.ok===true?'passed':s?.ok===false?'failed':'not_run';
const label=s=>({passed:'ناجح ضمن نطاقه',failed:'يحتاج مراجعة',not_run:'لم يُنفذ'})[state(s)];
export function summarizeReport(report){
  const rows=Object.values(report.sections||{}),passed=rows.filter(s=>state(s)==='passed').length,failed=rows.filter(s=>state(s)==='failed').length,notRun=rows.length-passed-failed;
  return {generatedAt:report.generatedAt,host:report.host,overall:failed?'needs_review':'partial',ok:false,passed,failed,notRun,total:rows.length,
    scope:'النتائج تخص الفحوص المسجلة فقط؛ لا يثبت هذا التقرير الجاهزية الكاملة أو دقة التوصية.',
    sections:Object.fromEntries(Object.entries(report.sections||{}).map(([k,s])=>[k,{status:state(s),ok:s.ok??null,durationMs:s.durationMs,error:s.error??null,reason:s.reason??null}]))};
}
export async function readReport(path){
  const file=await readFile(resolve(path));if(file.length>5e6)throw Error('التقرير أكبر من الحد.');
  const r=JSON.parse(file.toString('utf8'));
  if(!r||typeof r.sections!=='object'||Array.isArray(r.sections)||!r.sections||Object.values(r.sections).some(s=>!s||typeof s!=='object'))throw Error('بنية التقرير غير صالحة.');
  return r;
}
export async function saveReport(path,text){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(resolve(path),text,{encoding:'utf8',flag:'wx',mode:0o600});}
export function renderHtml(report){
  const s=summarizeReport(report);
  const rows=Object.entries(report.sections||{}).map(([name,v])=>`<tr><th scope="row">${escapeHtml(name)}</th><td class="${state(v)}">${label(v)}</td><td>${escapeHtml(v.durationMs)} ms</td><td>${escapeHtml(v.reason||v.error||'')}<details><summary>البيانات المسجلة</summary><pre dir="ltr">${escapeHtml(JSON.stringify(v.value??null,null,2))}</pre></details></td></tr>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>ميزان — تقرير الفحوص</title><style>body{font-family:system-ui,sans-serif;background:#101c19;color:#edf2ee;margin:0;padding:24px;line-height:1.8}main{max-width:1200px;margin:auto}h1{color:#d7c18b}p{max-width:85ch}.cards{display:flex;gap:20px;flex-wrap:wrap;padding:20px 0}.cards span{padding:14px;border:1px solid #667b70;border-radius:8px}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:12px;text-align:right;border-bottom:1px solid #45554d;vertical-align:top}th{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;max-height:300px;overflow:auto;max-width:650px}.passed{color:#a5dbb4}.failed{color:#ffbdac}.not_run{color:#d7c18b}summary{cursor:pointer}td{min-width:100px}</style></head><body><main><h1>تقرير فحوص ميزان</h1><p>${escapeHtml(report.host)} · ${escapeHtml(report.generatedAt)}</p><p>${escapeHtml(s.scope)}</p><p>الحالة: ${s.failed?'توجد فحوص تحتاج مراجعة':'تحقق جزئي؛ توجد حدود لم تُثبت'}. ليس تصريحًا بجاهزية الإنتاج.</p><div class="cards"><span>الإجمالي ${s.total}</span><span>ناجح ${s.passed}</span><span>يحتاج مراجعة ${s.failed}</span><span>لم يُنفذ ${s.notRun}</span></div><div class="table"><table><thead><tr><th>الفحص</th><th>الحالة</th><th>المدة</th><th>التفاصيل</th></tr></thead><tbody>${rows}</tbody></table></div></main></body></html>`;
}
export function renderMarkdown(report){
  const s=summarizeReport(report),lines=['# تقرير فحوص ميزان','','المضيف: '+escapeMd(report.host),'','التاريخ: '+escapeMd(report.generatedAt),'',s.scope,'',`النتيجة: ${s.failed?'توجد فحوص تحتاج مراجعة':'تحقق جزئي'}؛ ليست شهادة جاهزية.`,`ناجح ${s.passed} · يحتاج مراجعة ${s.failed} · لم يُنفذ ${s.notRun} · الإجمالي ${s.total}`,'','| الفحص | الحالة | المدة | التفاصيل |','|---|---|---|---|'];
  for(const [name,v] of Object.entries(report.sections||{}))lines.push(`| ${escapeMd(name)} | ${label(v)} | ${escapeMd(v.durationMs)} ms | ${escapeMd(v.reason||v.error||JSON.stringify(v.value??null).slice(0,200))} |`);
  const observed=report.sections?.verifyAfter?.value||report.sections?.verifyBefore?.value||report.sections?.verify?.value;
  lines.push('','## Cron','',escapeMd(observed?.checks?.cron?.details||'غير متحقق'),'','## التوقعات المحفوظة','',escapeMd(JSON.stringify(observed?.checks?.forecasts??'غير متحقق')));
  const bt=report.sections?.backtestSingle?.value;
  if(Array.isArray(bt?.byHorizon)){
    const n=(v,d=3)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—',pct=v=>typeof v==='number'&&Number.isFinite(v)?n(v*100,1)+'%':'—';
    lines.push('','## قياس التوقعات الأصلية','','| الجلسات | مكتمل | مستبعد | معلّق | دقة الاتجاه | إصابة النطاق | Sharpe للعينة | Alpha |','|---|---|---|---|---|---|---|---|');
    for(const h of bt.byHorizon)lines.push(`| ${escapeMd(h.horizon)} | ${escapeMd(h.completed)} | ${escapeMd(h.excluded)} | ${escapeMd(h.pending)} | ${pct(h.directionAccuracy)} | ${pct(h.rangeHitRate)} | ${n(h.sharpe)} | ${pct(h.alpha)} |`);
    lines.push('','العوائد هنا عوائد الأصل بعد التكاليف وليست محاكاة تنفيذ قرارات الشراء/البيع. Sharpe للعينة غير سنوي، وMAE مفصول حسب العملة في JSON.');
    for(const note of bt.limitations||[])lines.push('',escapeMd(note));
  }
  return lines.join('\n')+'\n';
}
