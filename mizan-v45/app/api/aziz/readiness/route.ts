import {eligibleSaudiCompanies} from '@/lib/saudi-directory';
import {eligibleUSCompanies} from '@/lib/us-directory';
import {listingRestriction} from '@/lib/listing-lifecycle';

// Read-only deployment gate. No model registry is connected in this release.
// Do not infer approval from research code or fall back to the Mizan journal.
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store, private'};
 const p=new URL(request.url).searchParams,market=p.get('market'),symbol=(p.get('symbol')||'').trim().toUpperCase();
 if(!['sa','us'].includes(market||'')||!symbol||symbol.length>32||! /^[A-Z0-9.^-]+$/.test(symbol))return Response.json({error:'حدّد السوق ورمز الشركة الصحيح.'},{status:400,headers});
 const company=(market==='sa'?eligibleSaudiCompanies():eligibleUSCompanies()).find(c=>c.symbol===symbol);
 if(!company)return Response.json({error:'الشركة غير موجودة في دليل السوق المحدد.'},{status:404,headers});
 const restriction=listingRestriction(symbol);
 return Response.json({schemaVersion:1,engine:'aziz',operation:'readiness',company:{symbol:company.symbol,name:company.name},market,
  status:'not_ready',canForecast:false,forecast:null,recorded:false,modelVersion:null,
  dataEligibility:'not_checked',checkedAt:new Date().toISOString(),
  reasons:[...(restriction?[{code:'listing_restricted',message:restriction.reason}]:[]),
   {code:'approved_model_not_connected',message:'لا يوجد نموذج عزيز معتمد مربوط بمسار الإصدار الحالي.'},
   {code:'company_data_not_evaluated',message:'لم تُفحص أهلية بيانات الشركة للتوقع؛ يتطلب ذلك اكتمال مسار النموذج والتحقق الزمني.'}],
 },{headers});
}
