import {searchCompanies} from '@/lib/market-data';
import {searchUSDirectory} from '@/lib/us-directory';
import {searchSaudiPage} from '@/lib/saudi-directory';
import {env} from 'cloudflare:workers';
import {readSettings} from '@/lib/site-settings';
import {configuredReader} from '@/lib/source-status';
import {listingRestriction} from '@/lib/listing-lifecycle';
export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams,q=params.get('q')||'',market=params.get('market')||'auto';
  if(!['auto','sa','us','global'].includes(market))throw new Error('سوق غير صالح.');
  const settings=await readSettings((env as any).DB);
  if(market!=='auto'&&!settings.enabledMarkets.includes(market))throw Error('هذا السوق متوقف من إعدادات الإدارة.');
  let result;
  try{result=market==='us'?searchUSDirectory(q,Number(params.get('offset')||0)):market==='sa'?searchSaudiPage(q,Number(params.get('offset')||0)):{companies:await searchCompanies(q,market,await configuredReader((env as any).DB,settings))};if(market==='sa'&&!result.companies.length&&q.trim())throw new Error('لم تظهر نتيجة في الدليل السعودي.');}
  catch(error){
   const alternate=market==='sa'&&settings.enabledMarkets.includes('us')&&q.trim()?searchUSDirectory(q,Number(params.get('offset')||0)):null;
   if(!alternate?.total)throw error;
   result={...alternate,suggestedMarket:'us',notice:'السوق المختار سعودي، لكن توجد نتائج مطابقة في السوق الأمريكي. اختر الشركة الأمريكية المقصودة أدناه.'};
  }
  const companies=result.companies.map(c=>{const listing=listingRestriction(c.symbol);return listing?{...c,analysisAvailable:false,listingStatus:listing.status,listingEvidence:listing,analysisUnavailableReason:listing.reason}:c;});
  return Response.json({...result,companies},{headers:{'Cache-Control':'private, max-age=60'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'تعذر البحث.'},{status:422})}
}
