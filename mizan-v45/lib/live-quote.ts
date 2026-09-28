import {finite} from './analysis';
import {validateMarketIdentity} from './market-identity';
export function parseLiveQuote(data:any,symbol:string,now=Date.now()){
 const m=data?.chart?.result?.[0]?.meta;
 validateMarketIdentity(m,symbol);
 if(!finite(m?.regularMarketPrice)||m.regularMarketPrice<=0||!finite(m.regularMarketTime)||m.regularMarketTime<=0||m.regularMarketTime*1000>now+5000)throw new Error('لم يصل سعر مؤرخ مطابق للشركة.');
 const session=m.currentTradingPeriod?.regular;
 const sessionKnown=finite(session?.start)&&finite(session?.end)&&session.end>session.start;
 const isOpen=sessionKnown&&now>=session.start*1000&&now<session.end*1000;
 // chartPreviousClose may precede the entire five-year chart, not yesterday.
 const previous=finite(m.previousClose)?m.previousClose:m.range==='1d'&&finite(m.chartPreviousClose)?m.chartPreviousClose:null;
 const ageSeconds=Math.max(0,Math.floor((now-m.regularMarketTime*1000)/1000));
 const lastClose=sessionKnown&&now>=session.end*1000&&m.regularMarketTime>=session.start&&m.regularMarketTime<=session.end&&ageSeconds<=4*86400;
 return {changePct:previous&&previous>0?(m.regularMarketPrice/previous-1)*100:null,symbol,price:m.regularMarketPrice as number,currency:String(m.currency||''),quoteTime:new Date(m.regularMarketTime*1000).toISOString(),retrievedAt:new Date(now).toISOString(),isOpen,sessionKnown,sessionEnd:sessionKnown?session.end*1000:null,delayed:!lastClose&&ageSeconds>60,ageSeconds,priceKind:data._mizanPriceKind==='minute-close'?'minute-close':lastClose?'last-close':isOpen?'session':'unverified-session',delayAccepted:isOpen?ageSeconds<=900:null,coverage:typeof data._mizanCoverage==='string'?data._mizanCoverage:'تغطية التغذية غير متحققة؛ لا يفترض أن الحجم مجمّع لكل السوق',feedDelayMinutes:Number.isFinite(data._mizanDelayMinutes)?data._mizanDelayMinutes:null,source:data._mizanSource||`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`};
}
export type LiveQuote=ReturnType<typeof parseLiveQuote>;
export function pollDelay(quote:LiveQuote|null){return quote?.isOpen?15000:60000}
