import {forecastSchedulerStatus} from '@/lib/jobs/schedule';
import {forecastVisibilitySql} from '@/lib/forecast-access';
import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {testAccount,canReadForecast,forecastTestPage,dueForecastTests,forecastTestRevisions,createForecastTests,listForecastTests,measureForecastTest,validForecastId,forecastTestHtml,forecastTestFilename} from '@/lib/forecast-tests';
import {fetchCompany,validSymbol} from '@/lib/market-data';
import {configuredReader} from '@/lib/source-status';
import {zipFiles} from '@/lib/zip-files';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
function error(e:any){return Response.json({error:typeof e?.message==='string'&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر حفظ أو قراءة الاختبار؛ السجلات السابقة محفوظة.'},{status:e?.status||400,headers});}
export async function GET(req:Request){try{
 const account=await testAccount(req.headers),runtime=env as any,{DB}=runtime,url=new URL(req.url),symbol=url.searchParams.get('symbol'),forecastId=url.searchParams.get('forecast'),id=url.searchParams.get('id'),format=url.searchParams.get('format');
 if(id&&!validForecastId(id)||forecastId&&!validForecastId(forecastId)||symbol&&!validSymbol(symbol))throw Error('معرف الاختبار أو الرمز غير صالح.');
 if(url.searchParams.get('history')==='1'){if(!id)throw Error('اختر الاختبار لفتح إصدارات قياسه.');const rawBefore=url.searchParams.get('before');return Response.json(await forecastTestRevisions(DB,account,id,rawBefore===null?undefined:Number(rawBefore)),{headers});}
 const listing=id?{tests:await listForecastTests(DB,account,id),page:null}:await forecastTestPage(DB,account,{cursor:url.searchParams.get('cursor'),query:url.searchParams.get('q'),archived:url.searchParams.get('archived')==='1'}),tests=listing.tests;
 if(format){if(!['html','json','zip'].includes(format))throw Error('صيغة غير مدعومة.');if(format!=='zip'&&!id)throw Error('اختر اختبارًا للتنزيل.');if(!tests.length)throw Object.assign(Error('لا يوجد اختبار متاح لهذا الحساب.'),{status:404});
  if(format==='zip')return new Response(zipFiles(tests.map((t:any)=>({name:forecastTestFilename(t),content:forecastTestHtml(t)}))) as any,{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="MZN_TESTS_PAGE.zip"'}});
  const test=tests[0];return new Response(format==='html'?forecastTestHtml(test):JSON.stringify({format:'mizan-test-export',version:1,exportedAt:new Date().toISOString(),verifiedImport:false,test},null,2),{headers:{...headers,'Content-Type':format==='html'?'text/html; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+(format==='html'?forecastTestFilename(test):forecastTestFilename(test).replace('.html','.json'))+'"'}});
 }
 let forecasts=[];if(symbol||forecastId){const owner=!!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||''),visibility=forecastVisibilitySql(account,owner),result=await DB.prepare("SELECT f.*,json_extract(s.data,'$.company') AS company_data FROM forecast_records f JOIN analysis_snapshots s ON s.id=f.snapshot_id WHERE "+(forecastId?'f.snapshot_id=(SELECT target.snapshot_id FROM forecast_records target WHERE target.id=?)':'f.symbol=?')+' AND '+visibility.clause+' ORDER BY f.created_at DESC,f.horizon LIMIT 120').bind(forecastId||symbol,...visibility.args).all();forecasts=(result.results||[]).filter((r:any)=>canReadForecast(r,account,owner)).map((r:any)=>({id:r.id,snapshotId:r.snapshot_id,symbol:r.symbol,createdAt:r.created_at,available:!!r.available,forecast:JSON.parse(r.data),company:JSON.parse(r.company_data)}));}
 return Response.json({tests,page:listing.page,forecasts,scheduler:await forecastSchedulerStatus(DB),limit:200},{headers});
 }catch(e){return error(e);}}
export async function POST(req:Request){try{
 const account=await testAccount(req.headers),runtime=env as any,{DB}=runtime;if(req.headers.get('origin')!==new URL(req.url).origin)throw Object.assign(Error('طلب غير مسموح.'),{status:403});
 const raw=await req.text();if(raw.length>3000)throw Error('الطلب أكبر من الحد.');const b=JSON.parse(raw);
 if(b.action==='create')return Response.json({tests:await createForecastTests(DB,account,b.ids,!!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||''))},{headers});
 if(b.action==='archive'){if(!validForecastId(b.id)||typeof b.archived!=='boolean')throw Error('طلب أرشفة غير صالح.');await DB.prepare('UPDATE forecast_tests SET archived=? WHERE id=? AND owner=?').bind(b.archived?1:0,b.id,account).run();return Response.json({tests:await listForecastTests(DB,account)},{headers});}
 if(b.action==='measure'){if(!validForecastId(b.id))throw Error('اختر الاختبار.');const read=await configuredReader(DB);return Response.json(await measureForecastTest(DB,account,b.id,symbol=>fetchCompany(symbol,read,true)),{headers});}
 if(b.action==='catch-up'){const tests=await dueForecastTests(DB,account),read=await configuredReader(DB),reports=new Map<string,Promise<any>>(),results=[];const readOnce=(symbol:string)=>{if(!reports.has(symbol))reports.set(symbol,fetchCompany(symbol,read,true));return reports.get(symbol)!;};for(const t of tests)try{results.push(await measureForecastTest(DB,account,t.id,readOnce));}catch{results.push({id:t.id,message:'تعذر الوصول إلى بيانات النتيجة؛ أعد المحاولة.'});}return Response.json({tests:await listForecastTests(DB,account),results,message:'فُحصت '+tests.length+' اختبارات مستحقة في هذا الطلب. '+(await forecastSchedulerStatus(DB)).message},{headers});}
 throw Error('عملية غير معروفة.');
 }catch(e){return error(e);}}
