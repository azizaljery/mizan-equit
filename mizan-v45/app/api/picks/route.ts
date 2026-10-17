import {env} from 'cloudflare:workers';
import {validPicksRequest,selectPicks,trackRecord,type PickRow} from '@/lib/picks';

const headers={'Cache-Control':'public, max-age=120'};
/** Read-only: ranks forecasts already stored in D1. Runs no analysis and calls no provider. */
export async function GET(request:Request){
 let req;try{const p=new URL(request.url).searchParams;req=validPicksRequest(p.get('market'),p.get('horizon'),p.get('count'));}
 catch(e){return Response.json({error:e instanceof Error?e.message:'طلب غير صالح.'},{status:400,headers:{'Cache-Control':'no-store'}});}
 try{
  const db=(env as any).DB,since=new Date(Date.now()-req.horizon.maxAgeHours*3600000).toISOString();
  const rows=await db.prepare(`SELECT f.id,f.symbol,f.created_at,f.horizon,f.market,f.confidence,f.available,f.data,
     json_extract(s.data,'$.company.name') AS name,json_extract(s.data,'$.company.exchange') AS exchange
   FROM forecast_records f LEFT JOIN analysis_snapshots s ON s.id=f.snapshot_id
   WHERE f.market=? AND f.horizon=? AND f.created_at>=? AND COALESCE(json_extract(f.data,'$.recordClass'),'')='prospective-public'
   ORDER BY f.created_at DESC LIMIT 2000`).bind(req.market,req.horizon.sessions,since).all();
  const outcomes=await db.prepare(`SELECT o.data FROM forecast_outcomes o JOIN forecast_records f ON f.id=o.id
   WHERE f.market=? AND f.horizon=? AND COALESCE(json_extract(f.data,'$.recordClass'),'')='prospective-public' LIMIT 20000`).bind(req.market,req.horizon.sessions).all();
  const sel=selectPicks((rows.results||[]) as PickRow[],req.horizon.name,req.count);
  return Response.json({market:req.market,horizon:req.horizon.sessions,horizonName:req.horizon.name,since,generatedAt:new Date().toISOString(),
   ...sel,trackRecord:trackRecord((outcomes.results||[]) as {data:string}[]),
   policy:'نفس شروط فرز التوقعات: متاح، صاعد، ثقة متوسطة أو مرتفعة، نطاق صالح، وسعر مركزي متسق. ترتيب: جودة البيانات ثم الثقة ثم تغطية العوامل ثم العينة ثم التغير المتوقع.'},{headers});
 }catch{return Response.json({error:'تعذر قراءة التوقعات المحفوظة الآن؛ أعد المحاولة.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
