import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {readSettings} from '@/lib/site-settings';
import {configuredReader} from '@/lib/source-status';
import {createAccuracyRun,getAccuracyRun,listAccuracyRuns,processAccuracyRow} from '@/lib/accuracy-sample';
const headers={'Cache-Control':'no-store, private'};
function access(req:Request){const r=env as unknown as {DB:any;RECOMMENDATION_OWNER_EMAIL:string};
 if(!req.headers.get('oai-authenticated-user-email'))throw Object.assign(Error('سجّل الدخول بحساب مالك ميزان لبدء الاختبار وفتح نتائجه المحفوظة.'),{status:401,code:'SIGN_IN_REQUIRED'});
 if(!r.RECOMMENDATION_OWNER_EMAIL)throw Object.assign(Error('تعذر التحقق من إعداد حساب المالك؛ لم تتغير البيانات.'),{status:503});
 if(!ownerIdentity(req.headers,r.RECOMMENDATION_OWNER_EMAIL))throw Object.assign(Error('هذا الاختبار متاح لحساب مالك ميزان.'),{status:403});return r;
}
function failed(e:any){const text=typeof e?.message==='string'&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر تحميل الاختبار أو حفظه؛ أعد المحاولة. البيانات السابقة محفوظة.';return Response.json({error:text,code:e?.code||'SAMPLE_ERROR'},{status:e?.status||400,headers});}
export async function GET(req:Request){try{const {DB}=access(req),id=new URL(req.url).searchParams.get('id');return Response.json(id?await getAccuracyRun(DB,id):{runs:await listAccuracyRuns(DB)},{headers});}catch(e){return failed(e);}}
export async function POST(req:Request){try{
 const {DB}=access(req);if(req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'طلب غير مسموح.'},{status:403,headers});
 const raw=await req.text();if(raw.length>2500)throw Error('الطلب أكبر من الحد.');const b=JSON.parse(raw),settings=await readSettings(DB);
 if(b.action==='create')return Response.json(await createAccuracyRun(DB,b,settings),{headers});
 if(!['forecast','measure'].includes(b.action))throw Error('اختر إنشاء الاختبار أو متابعة قياسه.');
 return Response.json(await processAccuracyRow(DB,b.runId,b.rowId,b.action,await configuredReader(DB,settings)),{headers});
 }catch(e){return failed(e);}}
