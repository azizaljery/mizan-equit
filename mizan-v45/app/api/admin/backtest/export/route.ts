import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {readStoredReport} from '@/lib/backtest/stored-report';
import {backtestToCsv,backtestToTsv} from '@/lib/backtest/export';
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 const headers={'Cache-Control':'no-store, private'};
 try{
  const p=new URL(req.url).searchParams,id=p.get('runId')||'',format=p.get('format')||'csv';
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)||!['csv','tsv'].includes(format)||[...p.keys()].some(k=>!['runId','format'].includes(k)||p.getAll(k).length!==1))return Response.json({error:'معرف أو صيغة غير صالحة.'},{status:400,headers});
  const db=(env as unknown as {DB:any}).DB,row=await db.prepare('SELECT substr(data,1,1000001) AS data FROM backtest_runs WHERE id=?').bind(id).first();
  if(!row)return Response.json({error:'التقرير غير موجود.'},{status:404,headers});
  const run=readStoredReport(row.data);
  return new Response(format==='csv'?backtestToCsv(run):backtestToTsv(run),{headers:{...headers,'Content-Type':format==='csv'?'text/csv; charset=utf-8':'text/tab-separated-values; charset=utf-8','Content-Disposition':`attachment; filename="mizan-${id}.${format}"`}});
 }catch{return Response.json({error:'تعذر تصدير التقرير؛ النوع أو البيانات غير صالحين.'},{status:400,headers});}
}
