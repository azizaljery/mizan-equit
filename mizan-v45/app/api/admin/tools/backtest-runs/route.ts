// Read-only list of recent saved backtest reports so the tools page can offer exports.
// Reads ids/metadata only; report bodies are never returned here.
import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
const headers={'Cache-Control':'no-store, private'};
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 try{
  const p=new URL(req.url).searchParams,text=p.get('limit')||'20';
  if(!/^\d+$/.test(text)||Number(text)<1||Number(text)>50||[...p.keys()].some(k=>k!=='limit'||p.getAll(k).length!==1))return Response.json({error:'الحد من 1 إلى 50.'},{status:400,headers});
  const rows=await (env as unknown as {DB:any}).DB.prepare("SELECT id,symbol,created_at,length(CAST(data AS BLOB)) AS size,CASE WHEN json_valid(data) THEN json_extract(data,'$.kind') ELSE NULL END AS kind FROM backtest_runs ORDER BY created_at DESC,id DESC LIMIT ?").bind(Number(text)).all();
  const runs=(rows.results??[]).map((r:any)=>({id:String(r.id),symbol:r.symbol??null,createdAt:r.created_at??null,size:Number(r.size)||0,kind:typeof r.kind==='string'?r.kind:null,exportable:r.kind==='mizan-issued-forecast-audit-v1'}));
  return Response.json({runs,readOnly:true},{headers});
 }catch{return Response.json({error:'تعذرت قراءة قائمة الاختبارات المحفوظة.'},{status:503,headers});}
}
