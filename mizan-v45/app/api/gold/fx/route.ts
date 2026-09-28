import {env} from 'cloudflare:workers';
import {getGoldFx,goldSettings,type GoldRuntime} from '@/lib/gold-service';
export async function GET(){try{const runtime=env as unknown as GoldRuntime;return Response.json(await getGoldFx(runtime,await goldSettings(runtime.DB)),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'تعذر تحميل مرجع الصرف؛ تبقى أسعار الدولار مستقلة.',fx:null},{status:503});}}
