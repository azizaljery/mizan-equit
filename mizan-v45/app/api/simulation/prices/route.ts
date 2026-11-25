import {env} from 'cloudflare:workers';
import {configuredReader} from '@/lib/source-status';
import {dailyChartURL,parseChart} from '@/lib/market-data';
import {validateMarketIdentity} from '@/lib/market-identity';
import {ALL_UNIVERSE} from '@/lib/integration/backtest';
/** Five years of daily bars for one symbol of the declared universe (historical-simulation input only). */
export async function GET(request:Request){
 const symbol=(new URL(request.url).searchParams.get('symbol')||'').trim().toUpperCase();
 if(!ALL_UNIVERSE.includes(symbol))return Response.json({error:'الرمز خارج الفئة المعلنة للاختبار.'},{status:400});
 try{
  const today=new Date().toISOString().slice(0,10),read=await configuredReader((env as any).DB);
  const data=await read(dailyChartURL(symbol,today,false,'5y'),true,3600000);
  const meta=data?.chart?.result?.[0]?.meta;
  validateMarketIdentity(meta,symbol);
  const prices=parseChart(data,today).prices;
  return Response.json({symbol,currency:String(meta?.currency||''),prices:prices.map(p=>({date:p.date,open:p.open,high:p.high,low:p.low,close:p.close,volume:p.volume}))},{headers:{'Cache-Control':'public, max-age=3600'}});
 }catch{return Response.json({error:'تعذر جلب الأسعار.'},{status:422,headers:{'Cache-Control':'no-store'}});}
}
