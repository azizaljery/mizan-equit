import {env} from 'cloudflare:workers';
import {latestMacro} from '@/lib/macro/collect';

/** Read-only: latest stored macro observations. Descriptive context only; calls no provider and feeds no score. */
export async function GET(){
 try{
  const series=await latestMacro((env as any).DB);
  return Response.json({series,note:'بيانات وصفية من FRED والبنك الدولي؛ لا تدخل أي درجة أو قرار. وقت النشر الأصلي غير متاح، فالتوفر يُقاس بوقت الجلب.'},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch{return Response.json({error:'تعذر قراءة بيانات الاقتصاد الكلي.'},{status:502,headers:{'Cache-Control':'no-store'}});}
}
