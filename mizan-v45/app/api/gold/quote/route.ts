import {env} from 'cloudflare:workers';
import {getGoldQuote,goldSettings,type GoldRuntime} from '@/lib/gold-service';
export async function GET(){try{const runtime=env as unknown as GoldRuntime;const settings=await goldSettings(runtime.DB);return Response.json({...await getGoldQuote(runtime,settings),settings},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'تعذر تحميل خدمة الذهب. أعد المحاولة.',quote:null,current:false},{status:503,headers:{'Cache-Control':'no-store'}});}}
