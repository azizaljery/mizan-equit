import {buildOverview,type MarketOverview} from '@/lib/market-overview';

// Public, read-only market overview (index price + descriptive analysis). Cached 5 minutes at the edge and in memory so a
// busy home page does not fan out ~45 provider requests per visitor. No D1 access, no writes.
// No cross-request promise sharing: in Workers, awaiting another request's in-flight fetch throws
// ("Cannot perform I/O on behalf of a different request") — the likely cause of a 500 seen right after deploy.
const TTL_MS=5*60*1000;
const memo=new Map<string,{at:number;body:MarketOverview}>();
export async function GET(request:Request){
 // Whole handler is guarded: any failure answers JSON (never an HTML platform page the browser cannot parse), with the
 // failing stage named so a device that cannot reach it can be diagnosed from the screen.
 let stage='start';
 try{
  const market=new URL(request.url).searchParams.get('market');
  const headers:Record<string,string>={'Cache-Control':'public, max-age=60, s-maxage=300','Content-Type':'application/json; charset=utf-8'};
  if(market!=='sa'&&market!=='us')return Response.json({error:'حدّد السوق: sa أو us.'},{status:400,headers:{'Cache-Control':'no-store'}});
  stage='memo';const hit=memo.get(market);if(hit&&Date.now()-hit.at<TTL_MS)return new Response(JSON.stringify(hit.body),{headers:{...headers,'x-mo-path':'memo'}});
  const cache=(globalThis as any).caches?.default as Cache|undefined,key=new Request(new URL('/api/market-overview?market='+market,request.url).toString());
  if(cache){stage='cache-match';try{const c=await cache.match(key);if(c){const text=await c.text();JSON.parse(text);return new Response(text,{headers:{...headers,'x-mo-path':'cache'}});}}catch{}}
  stage='build';
  const body=await buildOverview(market);memo.set(market,{at:Date.now(),body});
  const text=JSON.stringify(body);
  if(cache){stage='cache-put';try{await cache.put(key,new Response(text,{headers}));}catch{}}
  return new Response(text,{headers:{...headers,'x-mo-path':'build'}});
 }catch(e){return Response.json({error:'تعذر جلب بيانات السوق الآن.',stage,detail:String(e instanceof Error?e.message:e).slice(0,160)},{status:502,headers:{'Cache-Control':'no-store'}});}
}
