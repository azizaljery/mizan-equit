import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {listScreenerArchives,readScreenerArchiveForOwner} from '@/lib/screener-archive';
const headers={'Cache-Control':'no-store, private'};
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 try{const p=new URL(req.url).searchParams,db=(env as any).DB,id=p.get('id');return Response.json(id?await readScreenerArchiveForOwner(db,id):{runs:await listScreenerArchives(db,p.get('before')||undefined)},{headers});}
 catch{return Response.json({error:'تعذر قراءة أرشيف الفرز.'},{status:400,headers});}
}
