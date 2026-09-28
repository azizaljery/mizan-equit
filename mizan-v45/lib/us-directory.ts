import directory from './data/us-directory.json';
import type {Company} from './market-data';
let eligible:Company[]|undefined;
export function eligibleUSCompanies(){return eligible??=(directory.rows.filter(row=>row.analysisAvailable!==false&&row.instrument!=='OTHER'&&row.instrument!=='ETF').map(row=>({...row,sector:'',industry:'',source:directory.source,directoryDate:directory.date})) as Company[]).sort((a,b)=>a.symbol.localeCompare(b.symbol));}

const aliases:Record<string,string>={'ابل':'AAPL','تسلا':'TSLA','انفيديا':'NVDA','نفيديا':'NVDA','مايكروسوفت':'MSFT','امازون':'AMZN','جوجل':'GOOGL','الفابت':'GOOGL'};
export function searchUSDirectory(input:string,offset=0){
 if(input.length>80||!Number.isInteger(offset)||offset<0)throw new Error('عبارة البحث أو رقم الصفحة غير صالح.');
 const normalized=input.normalize('NFKC').trim().replace(/[أإآ]/g,'ا').toLowerCase();
 const q=(aliases[normalized]||normalized).toUpperCase();
 const matches=directory.rows.map(row=>{
  const symbol=row.symbol.toUpperCase(),listed=row.listedSymbol.toUpperCase(),name=row.name.toUpperCase();
  const rank=!q?1:symbol===q||listed===q?5:symbol.startsWith(q)||listed.startsWith(q)?4:name.startsWith(q)?3:q.length>1&&name.includes(q)?2:0;
  return {row,rank};
 }).filter(x=>x.rank).sort((a,b)=>b.rank-a.rank||a.row.symbol.localeCompare(b.row.symbol));
 const companies:Company[]=matches.slice(offset,offset+40).map(({row})=>({...row,sector:'',industry:'',source:directory.source,directoryDate:directory.date}));
 return {companies,total:matches.length,offset,nextOffset:offset+companies.length<matches.length?offset+companies.length:null,directory:{count:directory.rows.length,date:directory.date,source:directory.source,scope:'NASDAQ وNYSE والبورصات الأمريكية الأخرى في دليل Nasdaq Trader؛ لا يشمل OTC. العدد للأوراق المالية وليس للشركات الفريدة.'}};
}
