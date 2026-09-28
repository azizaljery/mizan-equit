import {configuredReader} from '@/lib/source-status';
import {analyzedCompany} from '@/lib/research-service';
import {env} from 'cloudflare:workers';
import {fetchLiveQuote,validSymbol} from '@/lib/market-data';
import {finalDecision,privateDecisionEvidence} from '@/lib/final-decision';
import {tradeScenario} from '@/lib/trade-scenario';
import {authorizeAdminRequest} from '@/lib/admin-request';
import {ownerIdentity,unlock,validPin} from '@/lib/pin-lock';
const headers={'Cache-Control':'no-store, private'};
export function OPTIONS(){return new Response(null,{status:204,headers});}
export async function POST(request:Request){
 try{
  const denied=authorizeAdminRequest(request);if(denied)return denied;
  const runtime=env as unknown as {DB:any;RECOMMENDATION_OWNER_EMAIL?:string;RECOMMENDATION_INITIAL_HASH?:string};
  const raw=await request.text();if(raw.length>1000)throw new Error('الطلب أكبر من الحد.');
  const body=JSON.parse(raw);
  if(body?.action!=='view')throw new Error('طلب غير صالح.');
  if(!validSymbol(body.symbol||''))throw new Error('رمز الشركة غير صالح.');
  if(!runtime.DB)throw new Error('الخدمة غير متاحة الآن.');
  if(!runtime.RECOMMENDATION_INITIAL_HASH)throw new Error('رمز ميزان الخاص غير مهيأ على الخادم.');
  if(!validPin(body.pin))throw new Error('أدخل رمز ميزان الخاص المكوّن من 6 إلى 12 رقمًا.');
  await unlock(runtime.DB,runtime.RECOMMENDATION_INITIAL_HASH,ownerIdentity(request.headers,runtime.RECOMMENDATION_OWNER_EMAIL||'')||'',body.pin);
  try{const [report,quote]=await Promise.all([analyzedCompany(body.symbol,runtime.DB,undefined,true),fetchLiveQuote(body.symbol,await configuredReader(runtime.DB)).catch(()=>null)]);const result=tradeScenario(report);return Response.json({symbol:report.company.symbol,result,decision:finalDecision(report,result,quote),quote,currency:report.currency,priceSource:report.priceSource,name:report.company.name,sources:report.checks,forecast:report.forecast,evidence:privateDecisionEvidence(report)},{headers})}
  catch{return Response.json({unavailable:true,error:'التوصية الأولية: نفضل الانتظار. لم تصل بيانات سعرية ومالية يمكن نسبتها للشركة بثقة؛ إعادة الجلب قد تغيّر القرار. هذه خلاصة غير مضمونة ولا تتضمن سعرًا افتراضيًا.'},{headers})}
 }catch(e){return Response.json({error:e instanceof Error?e.message:'تعذر فتح التوصية.'},{status:400,headers})}
}
