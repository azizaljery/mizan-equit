import {env} from 'cloudflare:workers';
import {analyzedCompany} from '@/lib/research-service';
import {forecastAccount} from '@/lib/forecast-access';
import {validSymbol} from '@/lib/market-data';
export async function POST(request:Request){try{if(Number(request.headers.get('content-length'))>250000)throw new Error('طلب أكبر من الحد.');const text=await request.text();if(text.length>250000)throw new Error('طلب أكبر من الحد.');const input=JSON.parse(text);if(typeof input.symbol!=='string'||!validSymbol(input.symbol))throw new Error('رمز غير صالح.');const account=await forecastAccount(request.headers);if(input.upload&&!account)return Response.json({error:'سجّل الدخول لربط التحليل بالملف الخاص بحسابك.'},{status:401});return Response.json(await analyzedCompany(input.symbol,(env as any).DB,input.upload,true,account),{headers:{'Cache-Control':'no-store'}})}catch(e){return Response.json({error:e instanceof Error?e.message:'تعذر جلب بيانات الشركة.'},{status:422})}}
