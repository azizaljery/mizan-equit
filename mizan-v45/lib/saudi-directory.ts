import directory from './data/saudi-directory.json';
import {searchSaudi,type Company} from './market-data';
import {listingRestriction,selectCurrentCandidates} from './listing-lifecycle';

let eligible:Company[]|undefined;

/** Default keeps the original directory for historical callers. Current jobs must
 * opt in; filtering today's universe into a historical sample would erase delistings.
 */
export function eligibleSaudiCompanies(scope:'directory'|'current'='directory'){
 if(!eligible)eligible=directory.rows
  .filter(row=>/^\d{4,5}$/.test(String(row.symbol))&&['M','S'].includes(row.market_type))
  .map(row=>({
   symbol:String(row.symbol)+'.SR',
   listedSymbol:String(row.symbol),
   name:row.companyNameAR||row.companyNameEN||String(row.symbol),
   nameEn:row.companyNameEN||undefined,
   exchange:row.market_type==='M'?'تداول السعودية':'نمو — السعودية',
   sector:'',
   industry:'',
   isin:row.isin||undefined,
   marketType:row.market_type,
   instrument:'EQUITY',
   source:directory.source,
   directoryDate:directory.retrievedAt,
   analysisAvailable:true,
  } satisfies Company))
  .sort((a,b)=>a.symbol.localeCompare(b.symbol,'en',{numeric:true}));
 return scope==='current'?selectCurrentCandidates(eligible):eligible;
}

export function searchSaudiPage(query:string,offset=0){
 if(query.length>80||!Number.isInteger(offset)||offset<0)throw new Error('عبارة البحث أو الصفحة غير صالحة.');
 const all=searchSaudi(directory.rows,query,directory.rows.length).sort((a,b)=>query.trim()?0:a.symbol.localeCompare(b.symbol));
 const companies=all.slice(offset,offset+40).map(c=>{
  const listing=listingRestriction(c.symbol);
  return {...c,listedSymbol:c.symbol.replace('.SR',''),directoryDate:directory.retrievedAt,
    ...(listing?{analysisAvailable:false,listingStatus:listing.status,listingEvidence:listing,analysisUnavailableReason:listing.reason}:{})};
 });
 return {companies,total:all.length,offset,nextOffset:offset+companies.length<all.length?offset+companies.length:null,directory:{count:directory.rows.length,date:directory.retrievedAt,source:directory.source,scope:'أسماء ورموز السوق الرئيسي ونمو من دليل تداول، بما فيها الرموز التاريخية. حالات الإيقاف وإلغاء الإدراج الموثقة موسومة وتُستبعد من الجمع الحالي فقط؛ غياب الوسم لا يثبت أن الإدراج نشط. توافر الأسعار والهوية يُتحقق منهما عند التحليل.'}};
}
