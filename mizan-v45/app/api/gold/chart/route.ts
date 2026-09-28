import {env} from 'cloudflare:workers';
import {GOLD_FRAMES,type GoldFrame} from '@/lib/gold-core';
import {getGoldSeries,goldSettings,type GoldRuntime} from '@/lib/gold-service';
export async function GET(req:Request){const frame=new URL(req.url).searchParams.get('frame') as GoldFrame;if(!GOLD_FRAMES.includes(frame))return Response.json({error:'الإطار الزمني غير مدعوم.'},{status:400});try{const runtime=env as unknown as GoldRuntime;return Response.json(await getGoldSeries(runtime,await goldSettings(runtime.DB),frame),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({series:null,error:'تعذر تحميل شموع الذهب لهذا الإطار.'},{status:503});}}
