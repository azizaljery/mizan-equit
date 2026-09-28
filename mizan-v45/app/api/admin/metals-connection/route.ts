import {env} from 'cloudflare:workers';
import {adminSession} from '@/lib/admin-access';
import {ownerIdentity} from '@/lib/pin-lock';
import {metalsCredentialStatus,saveMetalsCredential} from '@/lib/gold-credentials';
import {getGoldQuote,goldSettings,type GoldRuntime} from '@/lib/gold-service';
const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'};
export async function POST(req:Request){
  const runtime=env as unknown as GoldRuntime&{RECOMMENDATION_OWNER_EMAIL:string};
  try{
    if(req.headers.get('origin')!==new URL(req.url).origin||!ownerIdentity(req.headers,runtime.RECOMMENDATION_OWNER_EMAIL||'')||!await adminSession(runtime.DB,req))return Response.json({error:'يلزم حساب المالك وجلسة إدارة ميزان الحالية.'},{status:401,headers});
    if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return Response.json({error:'صيغة الطلب غير صالحة.'},{status:415,headers});
    // Bounded streaming read; never log or echo a malformed credential body.
    const reader=req.body?.getReader();if(!reader)throw Error('empty');
    let raw='',size=0;const decoder=new TextDecoder();
    while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>2048){await reader.cancel();return Response.json({error:'المفتاح أكبر من الحد المسموح.'},{status:413,headers});}raw+=decoder.decode(r.value,{stream:true});}
    raw+=decoder.decode();let body:any;try{body=JSON.parse(raw);}catch{return Response.json({error:'تعذر قراءة الطلب؛ أعد المحاولة.'},{status:400,headers});}
    if(body.action==='save'){
      try{const status=await saveMetalsCredential(runtime,body.apiKey);return Response.json({...status,message:'حُفظ المفتاح بأمان. اضغط «اختبار الاتصال» للتحقق من السعر.'},{headers});}
      catch(e){const allowed=['الصق مفتاح','أدخل المفتاح','لم تكتمل تهيئة','تكررت محاولات'];const message=e instanceof Error&&allowed.some(p=>e.message.startsWith(p))?e.message:'تعذر حفظ المفتاح؛ أعد المحاولة. لم يتم تأكيد الحفظ.';return Response.json({error:message},{status:400,headers});}
    }
    if(body.action==='test'){
      const settings=await goldSettings(runtime.DB);
      // Tests use the configured provider and its existing quota/cache. They
      // do not silently enable a provider the owner disabled.
      const result=await getGoldQuote(runtime,{...settings,primary:'metalsdev',backup:'goldapi',enabled:{...settings.enabled,goldapi:false}});
      const state=result.statuses.find(s=>s.id==='metalsdev');
      return Response.json({...await metalsCredentialStatus(runtime),test:{ok:result.current&&result.quote?.source==='metalsdev',message:state?.message??'لم يتم التحقق من السعر.',quote:result.current?result.quote:null,diagnostic:state?.diagnostic??null}},{headers});
    }
    if(body.action!=='status')return Response.json({error:'طلب غير صالح.'},{status:400,headers});
    return Response.json(await metalsCredentialStatus(runtime),{headers});
  }catch{return Response.json({error:'تعذر إكمال إعداد الاتصال. أعد المحاولة.'},{status:503,headers});}
}
