import {env} from 'cloudflare:workers';
import {configuredReader} from '@/lib/source-status';
import {dailyChartURL,parseChart} from '@/lib/market-data';
import {validateMarketIdentity} from '@/lib/market-identity';
import {obv,stochastic,ichimoku,fibonacci} from '@/lib/indicators-extra';
import {wyckoffAudit,latestImpulseCandidate,wyckoffClimaxes,STRUCTURE_PARAMS,CLIMAX_PARAMS} from '@/lib/structure-audit';

const SYMBOL=/^[A-Z0-9][A-Z0-9.\-]{0,14}$/;
const last=<T,>(a:T[])=>a.length?a[a.length-1]:null;
/** Read-only research audit for one symbol: the technical indicators and the rule-based structure checks, each with its numbers. Feeds no score or decision. */
export async function GET(request:Request){
 const symbol=(new URL(request.url).searchParams.get('symbol')||'').trim().toUpperCase();
 if(!SYMBOL.test(symbol))return Response.json({error:'رمز السهم غير صالح.'},{status:400});
 try{
  const today=new Date().toISOString().slice(0,10),read=await configuredReader((env as any).DB);
  const data=await read(dailyChartURL(symbol,today,false,'1y'),true,300000);
  validateMarketIdentity(data?.chart?.result?.[0]?.meta,symbol);
  const prices=parseChart(data,today).prices;
  if(prices.length<60)return Response.json({error:'بيانات الأسعار أقل من 60 جلسة.'},{status:422});
  const ich=ichimoku(prices),stoch=stochastic(prices),i=prices.length-1;
  return Response.json({
   symbol,asOf:prices[i].date,bars:prices.length,
   indicators:{obv:last(obv(prices)),stochastic:{fastK:last(stoch.fastK),slowK:last(stoch.slowK),slowD:last(stoch.slowD)},
    ichimoku:{tenkan:ich.tenkan[i],kijun:ich.kijun[i],cloudA:ich.cloudA[i],cloudB:ich.cloudB[i],position:ich.position[i]},fibonacci:fibonacci(prices)},
   structure:{wyckoff:wyckoffAudit(prices),elliottImpulse:latestImpulseCandidate(prices),climaxes:wyckoffClimaxes(prices).slice(-3)},
   params:{structure:STRUCTURE_PARAMS,climax:CLIMAX_PARAMS},
   note:'قواعد رقمية مسبقة على أسعار مرصودة؛ لا تسمّي مرحلة ولا تنسب نية ولا تعطي هدفًا. بحثي وغير مُعاير ولا يدخل أي درجة أو قرار.'
  },{headers:{'Cache-Control':'public, max-age=300'}});
 }catch(e){return Response.json({error:'تعذر جلب أسعار هذا الرمز.'},{status:422,headers:{'Cache-Control':'no-store'}});}
}
