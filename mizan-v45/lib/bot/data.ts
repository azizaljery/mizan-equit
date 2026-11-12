/**
 * BOT-0001 real data plumbing for the scheduled step. Prices and bars come from the site's configured reader (the same source the other jobs use);
 * if any piece is missing the runner records suspend/abstain with the reason and fills nothing.
 */
import {fetchLiveQuote,dailyChartURL,parseChart} from '../market-data';
import {validateMarketIdentity} from '../market-identity';
import type {Market} from './engine';
import type {BotSignal,BarLite,RunnerQuote} from './runner';

type Reader=(url:string,json?:boolean,ttl?:number,purpose?:'quote')=>Promise<any>;
export const marketOf=(symbol:string):Market=>symbol.endsWith('.SR')?'sa':'us';
const AR_DIRECTION:Record<string,'up'|'down'|'neutral'>={'صاعد':'up','هابط':'down','محايد':'neutral'};
const MIZAN_SOURCE='mizan-direction';

/** Latest public prospective Mizan call per symbol+horizon (direction-engine v1). Records without a `call` are not signals. */
export async function mizanSignals(db:any,market:Market,now:number,maxAgeMs=4*86400000):Promise<BotSignal[]>{
 const since=new Date(now-maxAgeMs).toISOString(),out:BotSignal[]=[];
 const res=await db.prepare(`SELECT id,symbol,horizon,confidence,created_at,data FROM (
   SELECT id,symbol,horizon,confidence,created_at,data,ROW_NUMBER() OVER (PARTITION BY symbol,horizon ORDER BY created_at DESC,id DESC) AS rn
   FROM forecast_records WHERE market=? AND horizon IN (1,5,21) AND created_at>=? AND available=1 AND json_valid(data)
    AND json_extract(data,'$.recordClass')='prospective-public' AND json_extract(data,'$.call.direction') IS NOT NULL) WHERE rn=1`).bind(market,since).all();
 for(const r of res.results||[]){
  try{
   const d=JSON.parse(r.data),c=d?.call;if(!c)continue;
   const direction=AR_DIRECTION[String(c.direction)]??'neutral',votes=Number(c.votes);
   out.push({source:MIZAN_SOURCE,source_version:String(c.policy||'mizan-direction-v1'),market,symbol:String(r.symbol),horizon:Number(r.horizon),direction,
    confidence:r.confidence?String(r.confidence):null,strength:Number.isFinite(votes)?Math.abs(votes):null,issued_at:String(r.created_at),forecast_id:String(r.id),
    basis_json:JSON.stringify({price:d.price??null,priceTime:d.priceTime??null,range:d.range??null,targetPrice:c.targetPrice??null,components:c.components??null,model:r.model??null})});
  }catch{/* unreadable record: not a signal */}
 }
 return out;
}

export function liveFetchers(read:Reader,today:string){
 const fetchQuote=async(symbol:string):Promise<RunnerQuote|null>=>{
  const q=await fetchLiveQuote(symbol,read as any);
  return {price:q.price,quoteTime:q.quoteTime,isOpen:q.isOpen,ageSeconds:q.ageSeconds,delayAccepted:q.delayAccepted===true,source:q.source,previousClose:q.previousClose};
 };
 const fetchBars=async(symbol:string):Promise<BarLite[]>=>{
  const data=await read(dailyChartURL(symbol,today,false,'1y'),true,300000);
  validateMarketIdentity(data?.chart?.result?.[0]?.meta,symbol);
  return parseChart(data,today).prices.map((p:{date:string;close:number;volume:number})=>({date:p.date,close:p.close,volume:p.volume}));
 };
 return {fetchQuote,fetchBars};
}
