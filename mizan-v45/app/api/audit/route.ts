import {env} from 'cloudflare:workers';
import {configuredReader} from '@/lib/source-status';
import {dailyChartURL,parseChart} from '@/lib/market-data';
import {validateMarketIdentity} from '@/lib/market-identity';
import {buildAudit} from '@/lib/audit-view';

const SYMBOL=/^[A-Z0-9][A-Z0-9.\-]{0,14}$/;
/** Read-only research audit of one symbol (indicators, structure rules, reaction, decision state). Feeds no score or decision. */
export async function GET(request:Request){
 const symbol=(new URL(request.url).searchParams.get('symbol')||'').trim().toUpperCase();
 if(!SYMBOL.test(symbol))return Response.json({error:'رمز السهم غير صالح.'},{status:400});
 try{
  const today=new Date().toISOString().slice(0,10),read=await configuredReader((env as any).DB);
  const data=await read(dailyChartURL(symbol,today,false,'1y'),true,300000);
  validateMarketIdentity(data?.chart?.result?.[0]?.meta,symbol);
  const prices=parseChart(data,today).prices;
  if(prices.length<60)return Response.json({error:'بيانات الأسعار أقل من 60 جلسة.'},{status:422});
  return Response.json({symbol,...buildAudit(prices,today),note:'بحثي: قواعد رقمية مسبقة بأوزان متساوية غير معايرة؛ لا تدخل أي درجة أو توقع أو قرار للبوت.'},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch{return Response.json({error:'تعذر جلب أسعار هذا الرمز.'},{status:422,headers:{'Cache-Control':'no-store'}});}
}
