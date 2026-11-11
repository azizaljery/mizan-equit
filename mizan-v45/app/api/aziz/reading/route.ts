import {env} from 'cloudflare:workers';
import {eligibleSaudiCompanies} from '@/lib/saudi-directory';
import {eligibleUSCompanies} from '@/lib/us-directory';
import {configuredReader} from '@/lib/source-status';
import {fetchCompany} from '@/lib/market-data';
import {azizExperimentalReading} from '@/lib/aziz/experimental-reading';

// Aziz experimental reading: computed on request from the stock's own recent prices. Nothing is saved, and it never feeds
// Mizan's forecasts, picks or accuracy records. AZIZ_MODE and the model registry are untouched (still OFF / no approved model).
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store, private'};
 const p=new URL(request.url).searchParams,market=p.get('market'),symbol=(p.get('symbol')||'').trim().toUpperCase(),horizon=Number(p.get('horizon'));
 if(!['sa','us'].includes(market||'')||!symbol||symbol.length>32||!/^[A-Z0-9.^-]+$/.test(symbol)||![5,21].includes(horizon))return Response.json({error:'حدّد السوق ورمز الشركة والمدة (5 أو 21 جلسة).'},{status:400,headers});
 const company=(market==='sa'?eligibleSaudiCompanies():eligibleUSCompanies()).find(c=>c.symbol===symbol);
 if(!company)return Response.json({error:'الشركة غير موجودة في دليل السوق المحدد.'},{status:404,headers});
 try{
  const report=await fetchCompany(symbol,await configuredReader((env as any).DB),false);
  if(report.company.symbol!==symbol||report.currency!==(market==='sa'?'SAR':'USD'))throw new Error('هوية الشركة أو العملة لا تطابق السوق المطلوب.');
  const reading=azizExperimentalReading({symbol,market:market as 'sa'|'us',currency:report.currency,source:report.priceSource,prices:report.prices,horizon:horizon as 5|21});
  return Response.json({engine:'aziz',operation:'experimental-reading',recorded:false,company:{symbol,name:company.name},currency:report.currency,reading},{headers});
 }catch(e){
  const reason=e instanceof Error&&/[؀-ۿ]/.test(e.message)?e.message.slice(0,300):'تعذر جلب أسعار الشركة أو تشغيل القراءة.';
  return Response.json({error:reason},{status:503,headers});
 }
}
