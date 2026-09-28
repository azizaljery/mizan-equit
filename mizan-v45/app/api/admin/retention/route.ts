import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {previewRetention} from '@/lib/jobs/retention';
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 const headers={'Cache-Control':'no-store, private'};
 try{
  const params=new URL(req.url).searchParams;
  if([...params.keys()].some(k=>!['days','keep'].includes(k))||[...params.keys()].some(k=>params.getAll(k).length!==1))throw Error('حقول غير صالحة.');
  for(const k of ['days','keep'])if(params.has(k)&&!/^\d+$/.test(params.get(k)!))throw Error('يلزم عدد صحيح موجب.');
  const value=await previewRetention((env as unknown as {DB:any}).DB,{days:params.has('days')?Number(params.get('days')):90,keepRuns:params.has('keep')?Number(params.get('keep')):50});
  return Response.json(value,{headers});
 }catch{return Response.json({error:'تعذرت معاينة الاحتفاظ؛ تحقق من الحدود والبيانات.'},{status:400,headers});}
}
