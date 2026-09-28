/** Adapter for the supplied payload contract, not proof of a connected official API.
 * No endpoint is enabled until an actual source response verifies this contract.
 */
import type {Parser,ParserContext,ParsedResult} from '../fallback';
import type {SourceRef} from '../types';
import type {ParsedFinancials,ParsedFinancialLine} from './types';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function json(raw:string):any{try{return JSON.parse(raw);}catch{throw Error('Tadawul: JSON غير صالح.');}}
function number(v:unknown):number|null{
 if(typeof v==='number')return Number.isFinite(v)?v:null;
 if(typeof v!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(v.trim()))return null;
 const n=Number(v);return Number.isFinite(n)?n:null;
}
function identity(item:any,expected:string){
 if(!/^\d{4}\.SR$/.test(expected)||!object(item))throw Error('Tadawul: هوية الطلب أو الرد غير صالحة.');
 const symbol=String(item.symbol??item.ticker??'');
 if(![expected,expected.slice(0,-3)].includes(symbol)||item.currency!=='SAR')throw Error('Tadawul: الرمز أو العملة مفقودان أو غير مطابقين.');
}
function date(v:unknown):string|null{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;}
function instant(v:unknown):string|null{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!date(v.slice(0,10)))return null;
 const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null;
}
export type TadawulQuote={symbol:string;price:number;currency:string;change:number|null;changePercent:number|null;volume:number|null;quoteTime:string};
export type TadawulPriceValue=TadawulQuote;
export const parseTadawulPrice:Parser<TadawulQuote>=(raw,_source,ctx)=>{
 const data=json(raw),items=Array.isArray(data)?data:[data?.data??data];
 const matches=items.filter(i=>object(i)&&[ctx.expectedSymbol,ctx.expectedSymbol?.replace(/\.SR$/,'')].includes(String(i.symbol??i.ticker??'')));
 if(matches.length!==1)throw Error('Tadawul: يجب وجود سجل واحد مطابق للرمز.');
 const item=matches[0];identity(item,ctx.expectedSymbol);
 const price=number(item.lastPrice??item.todaysClosedPrice??item.price),quoteTime=instant(item.asOfDate);
 if(price===null||price<=0||!quoteTime)throw Error('Tadawul: سعر موجب ووقت مصدر صريح مطلوبان.');
 if(ctx.asOf&&quoteTime.slice(0,10)>ctx.asOf.slice(0,10))throw Error('Tadawul: السعر بعد تاريخ التقييم.');
 const volume=number(item.volume??item.totalVolumeTraded);
 if(volume!==null&&volume<0)throw Error('Tadawul: حجم سالب غير صالح.');
 return {value:{symbol:ctx.expectedSymbol,price,currency:'SAR',change:number(item.change),changePercent:number(item.changePercent),volume,quoteTime},sourceTime:quoteTime};
};
export const parseTadawulFinancials:Parser<ParsedFinancials>=(raw,_source,ctx)=>{
 const data=json(raw);identity(data,ctx.expectedSymbol);
 // Require explicit base-unit scaling; never guess whether amounts are SAR or millions.
 if(data.unitScale!==1)throw Error('Tadawul: يلزم توثيق وحدة المبالغ بالريال الأساسي (unitScale=1).');
 const rows=data.financialStatements??data.statements,lines:ParsedFinancialLine[]=[];
 if(!Array.isArray(rows))throw Error('Tadawul: القوائم المالية مفقودة.');
 const fields:Record<string,string>={totalRevenue:'revenue',netIncome:'netIncome',operatingCashFlow:'operatingCashFlow',capitalExpenditures:'capex',totalEquity:'equity',totalDebt:'debt',cashAndEquivalents:'cash',ebitda:'ebitda',operatingIncome:'operatingIncome',interestExpense:'interestExpense'};
 for(const r of rows){
  if(!object(r))continue;
  const publication=r.announcementDate??r.publishedDate;
  const periodEnd=date(r.periodEndDate??r.fiscalEndDate),filedAt=publication==null?null:date(publication)??instant(publication);
  const annual=typeof r.isAnnual==='boolean'?r.isAnnual:r.statementType==='annual'?true:r.statementType==='quarterly'?false:null;
  if(!periodEnd||annual===null||(!annual&&r.periodType!=='3M'))continue;
  if(publication!=null&&!filedAt)continue;
  if(filedAt&&filedAt.slice(0,10)<periodEnd)continue;
  if(ctx.asOf&&(periodEnd>ctx.asOf.slice(0,10)||(filedAt&&filedAt.slice(0,10)>ctx.asOf.slice(0,10))))continue;
  for(const [field,key]of Object.entries(fields)){
   const value=number(r[field]);if(value===null)continue;
   lines.push({key,value:['capex','interestExpense'].includes(key)?Math.abs(value):value,unit:'SAR',period:annual?'annual':'quarterly',periodEnd,filedAt,form:String(r.statementType??'financial_report'),accession:r.reportId==null?null:String(r.reportId),source:_source.id});
  }
 }
 if(!lines.length)throw Error('Tadawul: لا توجد بنود مالية صالحة.');
 lines.sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
 return {value:{symbol:ctx.expectedSymbol,currency:'SAR',entityName:String(data.companyNameArabic??data.companyName??''),lines},sourceTime:lines.reduce<string|null>((m,l)=>l.filedAt&&(!m||l.filedAt>m)?l.filedAt:m,null)};
};
export function tadawulDispatch<T>(dataType:string,raw:string,source:SourceRef,ctx:ParserContext):ParsedResult<T>{
 if(dataType==='price')return parseTadawulPrice(raw,source,ctx) as unknown as ParsedResult<T>;
 if(dataType==='financials')return parseTadawulFinancials(raw,source,ctx) as unknown as ParsedResult<T>;
 throw Error(`Tadawul: نوع غير مدعوم ${dataType}.`);
}
