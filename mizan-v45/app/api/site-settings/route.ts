import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {readSettings} from '@/lib/site-settings';
export async function GET(req?:Request){try{return Response.json({...await readSettings((env as any).DB),viewerIsOwner:!!(req&&ownerIdentity(req.headers,(env as any).RECOMMENDATION_OWNER_EMAIL||''))},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'تعذر تحميل إعدادات البحث.'},{status:503})}}
