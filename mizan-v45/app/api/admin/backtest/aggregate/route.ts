import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {readStoredReport} from '@/lib/backtest/stored-report';
import {aggregateBacktests} from '@/lib/backtest/aggregate';
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 const headers={'Cache-Control':'no-store, private'};
 try{
  const p=new URL(req.url).searchParams,text=p.get('limit')||'10',format=p.get('format')||'json';
  if(!/^\d+$/.test(text)||Number(text)<1||Number(text)>20||!['json','md'].includes(format)||[...p.keys()].some(k=>!['limit','format'].includes(k)||p.getAll(k).length!==1))return Response.json({error:'حد التجميع من 1 إلى 20 وصيغته json أو md.'},{status:400,headers});
  const rows=await (env as unknown as {DB:any}).DB.prepare('SELECT substr(data,1,1000001) AS data FROM backtest_runs ORDER BY created_at DESC,id DESC LIMIT ?').bind(Number(text)).all();
  let skipped=0;const runs=[];
  for(const row of rows.results??[]){try{runs.push(readStoredReport(row.data));}catch{skipped++;}}
  const aggregate=aggregateBacktests(runs,{summarizeFn:r=>({byHorizon:r.byHorizon})});
  const output={aggregate,skippedUnsupportedOrInvalid:skipped,readOnly:true};
  if(format==='md')return new Response('# تجميع الاختبارات المحفوظة\n\n'+aggregate.notes.join('\n\n')+'\n\n```json\n'+JSON.stringify(output,null,2)+'\n```\n',{headers:{...headers,'Content-Type':'text/markdown; charset=utf-8'}});
  return Response.json(output,{headers});
 }catch{return Response.json({error:'تعذرت قراءة تقارير الاختبار.'},{status:503,headers});}
}
