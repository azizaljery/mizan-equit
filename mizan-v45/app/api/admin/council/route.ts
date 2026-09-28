import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {councilStatus,runCouncil} from '@/lib/agents/council';

const headers={'Cache-Control':'no-store, private'};
export async function GET(req:Request){
  const denied=await authorizeAdminSession(req);if(denied)return denied;
  return Response.json(await councilStatus((env as any).DB,env as any),{headers});
}
export async function POST(req:Request){
  const denied=await authorizeAdminSession(req);if(denied)return denied;
  try{
    const raw=await req.text();if(raw.length>10000)throw new Error('request-too-large');
    const body=JSON.parse(raw),task=String(body?.task||'').trim();
    const result=await runCouncil((env as any).DB,env as any,{task,trigger:'manual'});
    return Response.json(result,{headers});
  }catch{return Response.json({error:'تعذر تشغيل مجلس ميزان.'},{status:400,headers});}
}
