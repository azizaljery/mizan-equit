import {EVALUATION_POLICY} from './forecast-metrics';
import {forecastAccount,canReadForecast} from './forecast-access';
export {canReadForecast} from './forecast-access';
import {evaluateForecast,saveEvaluationRevision} from './forecast-journal';
import type {MarketReport} from './market-data';
export const validForecastId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
export async function testAccount(headers:Headers){const account=await forecastAccount(headers);if(!account)throw Object.assign(Error('سجّل الدخول لحفظ اختباراتك وفتحها من أجهزتك.'),{status:401});return account;}
export function testState(forecast:any,outcome:any,now=Date.now()){
 if(outcome?.state==='complete')return {state:'complete',label:'اكتمل التقييم'};
 if(outcome?.state==='excluded')return {state:'unavailable',label:'تعذر التقييم',reason:outcome.reason};
 if(!forecast.available)return {state:'unavailable',label:'تعذر التقييم',reason:(forecast.reasons||[]).join(' ')};
 const end=Date.parse(forecast.window?.estimatedEndAt||'');
 if(!Number.isFinite(end))return {state:'awaiting',label:'بانتظار التحقق من نهاية المدة',reason:'السجل القديم لا يحتوي موعدًا محفوظًا؛ القياس يتحقق من جلسات السوق ولا يعيد بدء الفترة.'};
 return now>=end?{state:'awaiting',label:'انتهى الموعد التقديري وبانتظار بيانات النتيجة',reason:'لا يثبت موعد نهاية الأسبوع اكتمال جلسات التداول والعطلات؛ ننتظر مرجع السوق وسعر نهاية المدة.'}:{state:'pending',label:'قيد القياس'};
}
export async function createForecastTests(db:any,account:string,ids:string[],owner=false,selection='manual'){
 if(!Array.isArray(ids)||!ids.length||ids.length>6||!ids.every(validForecastId))throw Error('اختر من توقع واحد إلى ستة توقعات محفوظة.');
 const unique=[...new Set(ids)],rows=[];
 for(const id of unique){const row=await db.prepare("SELECT f.*,json_extract(s.data,'$.company') AS company_data,json_extract(s.data,'$.currency') AS currency FROM forecast_records f JOIN analysis_snapshots s ON s.id=f.snapshot_id WHERE f.id=?").bind(id).first();if(!row||!canReadForecast(row,account,owner))throw Object.assign(Error('التوقع غير موجود أو غير متاح لهذا الحساب.'),{status:404});if(!row.available)throw Error('لم يصدر نطاق لهذه المدة؛ لا يُنشأ لها توقع وهمي للاختبار.');rows.push(row);}
 if(new Set(rows.map(r=>r.symbol)).size!==1)throw Error('مجموعة المدد تخص أصلًا واحدًا.');
 if(new Set(rows.map(r=>r.snapshot_id)).size!==1||new Set(rows.map(r=>r.horizon)).size!==rows.length)throw Error('اختر نسخة تحليل واحدة ومددًا غير مكررة لكل مجموعة.');
 const groupId=crypto.randomUUID(),at=new Date().toISOString();
 await db.batch(rows.map(row=>{const f=JSON.parse(row.data),snapshot={company:JSON.parse(row.company_data),currency:row.currency},end=Date.parse(f.window?.estimatedEndAt||'');return db.prepare('INSERT OR IGNORE INTO forecast_tests(id,owner,forecast_id,group_id,symbol,created_at,archived,policy,selection,data) VALUES(?,?,?,?,?,?,0,?,?,?)').bind(crypto.randomUUID(),account,row.id,groupId,row.symbol,at,EVALUATION_POLICY,selection,JSON.stringify({company:snapshot.company,currency:snapshot.currency,unit:f.unit||'share',forecastId:row.id,original:f,selectedAfterEstimatedEnd:Number.isFinite(end)?Date.parse(at)>=end:null,selectedAt:at,measurementKind:'اختبار توقع سعري',policy:EVALUATION_POLICY}));}));
 return listForecastTests(db,account);
}
const TEST_SELECT='SELECT t.*,o.data AS outcome_data,o.evaluated_at AS evaluated_at,(SELECT MAX(revision) FROM evaluation_revisions e WHERE e.forecast_id=t.forecast_id) AS revision FROM forecast_tests t LEFT JOIN forecast_outcomes o ON o.id=t.forecast_id';
function presentTest(r:any){const data=JSON.parse(r.data),outcome=r.outcome_data?JSON.parse(r.outcome_data):null;return {id:r.id,forecastId:r.forecast_id,groupId:r.group_id,symbol:r.symbol,createdAt:r.created_at,archived:!!r.archived,selection:r.selection,evaluatedAt:r.evaluated_at,revision:r.revision,...data,outcome,...testState(data.original,outcome)};}
export async function listForecastTests(db:any,account:string,id?:string){
 const query=TEST_SELECT+' WHERE t.owner=?'+(id?' AND t.id=?':'')+' ORDER BY t.created_at DESC,t.id DESC LIMIT 200';
 const result=await (id?db.prepare(query).bind(account,id):db.prepare(query).bind(account)).all();return (result.results||[]).map(presentTest);
}
export type TestPageOptions={cursor?:string|null;query?:string|null;archived?:boolean;limit?:number};
export async function forecastTestPage(db:any,account:string,options:TestPageOptions={}){
 const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('حجم صفحة الاختبارات غير صالح.');
 const clauses=['t.owner=?','t.archived=?'],args:any[]=[account,options.archived?1:0],query=(options.query||'').trim();
 if(query.length>120)throw Error('نص البحث أطول من الحد.');
 if(query){clauses.push("(instr(lower(t.symbol),lower(?))>0 OR instr(lower(json_extract(t.data,'$.company.name')),lower(?))>0 OR instr(json_extract(t.data,'$.original.period'),?)>0 OR instr(lower(json_extract(t.data,'$.original.model')),lower(?))>0)");args.push(query,query,query,query);}
 const total=await db.prepare('SELECT COUNT(*) AS n FROM forecast_tests t WHERE '+clauses.join(' AND ')).bind(...args).first();
 if(options.cursor){const parts=options.cursor.split('|');if(parts.length!==2||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parts[0])||!Number.isFinite(Date.parse(parts[0]))||!validForecastId(parts[1]))throw Error('مؤشر صفحة الاختبارات غير صالح.');clauses.push('(t.created_at<? OR (t.created_at=? AND t.id<?))');args.push(parts[0],parts[0],parts[1]);}
 const result=await db.prepare(TEST_SELECT+' WHERE '+clauses.join(' AND ')+' ORDER BY t.created_at DESC,t.id DESC LIMIT ?').bind(...args,limit+1).all(),all=result.results||[],rows=all.slice(0,limit),last=rows.at(-1);
 return {tests:rows.map(presentTest),page:{limit,query,archived:!!options.archived,total:total?.n||0,returned:rows.length,nextCursor:all.length>limit&&last?last.created_at+'|'+last.id:null,cursor:options.cursor||null}};
}
/** Due records are selected across the archive, rotating attempted rows behind untried rows. */
export async function dueForecastTests(db:any,account:string,now=new Date().toISOString(),limit=4){
 const result=await db.prepare(TEST_SELECT+" LEFT JOIN research_state a ON a.id='forecast-test-attempt:'||t.owner||':'||t.id WHERE t.owner=? AND o.id IS NULL AND COALESCE(json_extract(t.data,'$.original.available'),0)=1 AND (json_extract(t.data,'$.original.window.estimatedEndAt') IS NULL OR json_extract(t.data,'$.original.window.estimatedEndAt')<=?) ORDER BY COALESCE(a.updated_at,''),t.created_at,t.id LIMIT ?").bind(account,now,Math.min(4,Math.max(1,limit))).all();return (result.results||[]).map(presentTest);
}
export async function forecastTestRevisions(db:any,account:string,id:string,before?:number){
 const test=(await listForecastTests(db,account,id))[0];if(!test)throw Object.assign(Error('لم يُعثر على الاختبار في هذا الحساب.'),{status:404});
 if(before!==undefined&&(!Number.isInteger(before)||before<0))throw Error('رقم إصدار القياس غير صالح.');
 const query='SELECT revision,created_at,data FROM evaluation_revisions WHERE forecast_id=?'+(before!==undefined?' AND revision<?':'')+' ORDER BY revision DESC LIMIT 21',result=await (before!==undefined?db.prepare(query).bind(test.forecastId,before):db.prepare(query).bind(test.forecastId)).all(),rows=result.results||[],page=rows.slice(0,20);
 return {revisions:page.map((r:any)=>({revision:r.revision,createdAt:r.created_at,...JSON.parse(r.data)})),nextBefore:rows.length>20?page.at(-1).revision:null};
}
export async function measureForecastTest(db:any,account:string,id:string,read:(symbol:string)=>Promise<MarketReport>){
 const test=(await listForecastTests(db,account,id))[0];if(!test)throw Object.assign(Error('لم يُعثر على الاختبار في هذا الحساب.'),{status:404});
 if(test.state==='pending')return {test,message:'الفترة لم تكتمل بعد؛ لم يُجلب سعر جديد ولم يُنشأ توقع آخر.'};
 const at=new Date().toISOString();
 await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind('forecast-test-attempt:'+account+':'+id,JSON.stringify({testId:id,attemptedAt:at}),at).run();
 const record=await db.prepare('SELECT * FROM forecast_records WHERE id=?').bind(test.forecastId).first();
 if(!record)throw Error('لم يُعثر على أصل التوقع؛ بقي سجل الاختبار محفوظًا دون نتيجة مصطنعة.');
 const report=await read(test.symbol),outcome=evaluateForecast(record,report);
 if(outcome)await saveEvaluationRevision(db,record.id,outcome,'إعادة قياس نفس التوقع من بيانات المصدر؛ حفظ النتيجة السابقة عند التصحيح.');
 return {test:(await listForecastTests(db,account,id))[0],message:outcome?'قيس التوقع الأصلي؛ لم يتغير سعره أو مواعيده.':'لم تصل بيانات نهاية المدة ومرجع جلساتها كاملة؛ بقي الاختبار بانتظار النتيجة.'};
}
const escape=(value:unknown)=>String(value??'غير متاح').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function forecastTestFilename(test:any){return 'MZN_TEST_'+test.id.replace(/[^a-zA-Z0-9_-]/g,'')+'_'+test.symbol.replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+test.original.sessions+'_'+test.createdAt.slice(0,10)+'.html';}
export function forecastTestHtml(test:any,exportedAt=new Date().toISOString()){
 const f=test.original,o=test.outcome,m=o?.metrics,entry=(name:string,value:unknown)=>'<tr><th>'+escape(name)+'</th><td>'+'<bdi dir="'+(/[\u0600-\u06ff]/.test(String(value))?'auto':'ltr')+'">'+escape(typeof value==='number'?new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value):value)+'</bdi></td></tr>';
 const source=(url:unknown)=>{try{const u=new URL(String(url));return u.protocol==='https:'&&!u.username&&!u.password?'<a href="'+escape(u.href)+'" target="_blank" rel="noopener noreferrer">تحقق من المصدر</a>':'المصدر بلا رابط صالح';}catch{return 'المصدر بلا رابط صالح';}};
 return '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>اختبار ميزان</title><style>body{font:17px/1.8 sans-serif;color:#153d31;background:#f7f7ef;margin:auto;padding:24px;max-width:900px}table{width:100%;border-collapse:collapse;background:white}td,th{padding:12px;border:1px solid #ccd8cf;text-align:right;overflow-wrap:anywhere}th{width:42%}section{margin-block:24px}a{color:#165c43}</style><h1>اختبار ميزان — '+escape(test.company.name)+'</h1><p>'+escape(test.label)+' · اختبار توقع سعري، وليس ربح صفقة منفذة.</p><table>'+entry('الرمز / العملة / الوحدة',test.symbol+' / '+test.currency+' / '+test.unit)+entry('معرف الاختبار',test.id)+entry('معرف التوقع الأصلي',test.forecastId)+entry('وقت الإصدار',f.createdAt)+entry('وقت اختيار الاختبار',test.createdAt)+entry('اختير بعد الموعد التقديري',test.selectedAfterEstimatedEnd?'نعم؛ ليس اختيارًا مسبقًا':'لم يثبت الاختيار بعد النتيجة')+entry('المدة',f.period)+entry('البداية',f.window?.startAt||f.anchorDate)+entry('نهاية تقديرية',f.window?.estimatedEndAt)+entry('السعر المرجعي / وقته',f.price+' / '+(f.priceTime||'غير متاح'))+entry('السعر المركزي المتوقع للنهاية',f.predictedPrice)+entry('نطاق النهاية',f.range?.join(' – '))+entry('الاتجاه الأصلي',f.direction)+entry('الحركة المتوقعة %',f.expectedChangePct)+entry('قوة الأدلة',f.confidence)+entry('إصدار القياس / وقته',(test.revision??'سابق')+' / '+(test.evaluatedAt||'لم يُقَس'))+entry('سعر النهاية الفعلي',o?.actualPrice)+entry('تاريخ النهاية الفعلي',o?.actualDate)+entry('الحركة الفعلية %',m?.actualChangePct)+entry('الخطأ النقدي المطلق',m?.absoluteError)+entry('الخطأ النسبي % — مقامه سعر النهاية',m?.relativeErrorPct)+entry('خطأ الحركة بالنقاط المئوية',m?.movementErrorPp)+entry('صحة الاتجاه',typeof o?.directionCorrect==='boolean'?(o.directionCorrect?'صحيح':'خاطئ'):null)+entry('النهاية داخل النطاق',typeof o?.rangeHit==='boolean'?(o.rangeHit?'نعم':'لا'):null)+entry('لمس هدف أو إبطال داخل الفترة','لا يُستنتج من سعر النهاية وحده')+'</table><section><h2>الأسباب والمخاطر الأصلية</h2><p>'+escape((f.basis||[]).join('؛ '))+'</p><p>'+escape((f.risks||[]).join('؛ '))+'</p><p>'+escape((f.invalidation||[]).join('؛ '))+'</p></section><section><h2>المصدر وقواعد القياس</h2>'+source(f.source)+(o?.source?'<p>مصدر النتيجة: '+source(o.source)+'</p>':'')+'<p>'+escape(f.window?.successRule)+'</p><p>'+escape(m?.pointReason||m?.denominatorReason||test.reason||'الخطأ لا يتحول إلى نسبة دقة بطرحِه من 100.')+'</p><p>القيم غير المتاحة لا تساوي صفرًا. لا يُستنتج منتصف نطاق قديم كسعر توقع مركزي.</p><p>إصدار النموذج: '+escape(f.model)+' · سياسة القياس '+escape(test.policy)+'</p></section><footer>إصدار التصدير 1 · '+escape(exportedAt)+'<p>نسخة مستقلة لا تتحدث تلقائيًا؛ الأصل محفوظ في ميزان.</p></footer></html>';
}
