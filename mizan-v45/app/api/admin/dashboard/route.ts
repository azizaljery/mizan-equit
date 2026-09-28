import {env} from 'cloudflare:workers';
import {GET as verifyGET} from '../verify/route';

/** Same verification and owner/admin gate; adds bounded existing-journal summaries. */
export async function GET(req:Request){
  const verification=await verifyGET(req);
  if(!verification.ok)return verification;
  const report=await verification.json(),db=(env as unknown as {DB:any}).DB;
  const [runs,outcomes]=await Promise.allSettled([
    db.prepare(`SELECT id,symbol,created_at,
      CASE WHEN json_valid(data) THEN json_extract(data,'$.kind') END AS kind,
      CASE WHEN json_valid(data) THEN json_extract(data,'$.symbolsSucceeded') END AS symbolsSucceeded
      FROM backtest_runs ORDER BY created_at DESC,id DESC LIMIT 5`).all(),
    db.prepare(`SELECT o.id,f.symbol,f.horizon,o.evaluated_at,
      CASE WHEN json_valid(o.data) THEN json_extract(o.data,'$.state') ELSE 'invalid' END AS state
      FROM forecast_outcomes o LEFT JOIN forecast_records f ON f.id=o.id
      ORDER BY o.evaluated_at DESC,o.id DESC LIMIT 10`).all(),
  ]);
  const read=(r:typeof runs)=>r.status==='fulfilled'?{ok:true,rows:r.value.results??[]}:{ok:false,rows:null,error:'تعذرت قراءة هذا الجزء؛ لم يُستبدل بصفر.'};
  return Response.json({...report,backtest:read(runs),recentOutcomes:read(outcomes)}, {headers:verification.headers});
}
