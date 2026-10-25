import {buildOverview,type MarketOverview} from '@/lib/market-overview';

// Public, read-only market overview (index price + descriptive analysis). Cached 5 minutes at the edge and in memory so a
// busy home page does not fan out ~45 provider requests per visitor. No D1 access, no writes.
// No cross-request promise sharing: in Workers, awaiting another request's in-flight fetch throws
// ("Cannot perform I/O on behalf of a different request") — the likely cause of a 500 seen right after deploy.
const TTL_MS=5*60*1000;
const memo=new Map<string,{at:number;body:MarketOverview}>();
export async function GET(request:Request){
 const market=new URL(request.url).searchParams.get('market');
 const headers={'Cache-Control':'public, max-age=60, s-maxage=300','Content-Type':'application/json; charset=utf-8'};
 if(market!=='sa'&&market!=='us')return Response.json({error:'حدّد السوق: sa أو us.'},{status:400,headers:{'Cache-Control':'no-store'}});
 const hit=memo.get(market);if(hit&&Date.now()-hit.at<TTL_MS)return Response.json(hit.body,{headers});
 const cache=(globalThis as any).caches?.default as Cache|undefined,key=new Request(new URL('/api/market-overview?market='+market,request.url).toString());
 if(cache){try{const c=await cache.match(key);if(c)return c;}catch{}}
 try{
  const body=await buildOverview(market);memo.set(market,{at:Date.now(),body});
  const res=Response.json(body,{headers});
  if(cache){try{await cache.put(key,res.clone());}catch{}}
  return res;
 }catch{return Response.json({error:'تعذر جلب بيانات السوق الآن.'},{status:502,headers:{'Cache-Control':'no-store'}});}
}
