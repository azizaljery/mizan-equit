import directory from './data/saudi-directory.json';
import {searchSaudi} from './market-data';
let eligible:ReturnType<typeof searchSaudi>|undefined;
export function eligibleSaudiCompanies(){return eligible??=searchSaudi(directory.rows,'',directory.rows.length).filter(c=>c.analysisAvailable!==false&&c.instrument!=='OTHER'&&c.instrument!=='ETF').sort((a,b)=>a.symbol.localeCompare(b.symbol));}
export function searchSaudiPage(query:string,offset=0){
 if(query.length>80||!Number.isInteger(offset)||offset<0)throw new Error('عبارة البحث أو الصفحة غير صالحة.');
 const all=searchSaudi(directory.rows,query,directory.rows.length).sort((a,b)=>query.trim()?0:a.symbol.localeCompare(b.symbol));
 const companies=all.slice(offset,offset+40).map(c=>({...c,listedSymbol:c.symbol.replace('.SR',''),directoryDate:directory.retrievedAt}));
 return {companies,total:all.length,offset,nextOffset:offset+companies.length<all.length?offset+companies.length:null,directory:{count:directory.rows.length,date:directory.retrievedAt,source:directory.source,scope:'أسماء ورموز السوق الرئيسي ونمو من دليل تداول. قد يتضمن الدليل رموزًا تاريخية أو منتقلة؛ حالة الإدراج الحالية وتوافر الأسعار يُتحقق منهما عند التحليل.'}};
}
