import { parseSECFacts } from '../../sec-data';
import type { Parser, ParsedResult, ParserContext } from '../fallback';
import type { SourceRef } from '../types';
import type { ParsedFinancials, ParsedFinancialLine, ParsedFiling, ParsedFilings } from './types';

const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
function safeJson(raw:string,label:string):any{
  try{return JSON.parse(raw)}catch{throw new Error(`${label}: الاستجابة ليست JSON صالحاً.`)}
}
function normalizeCik(v:unknown):string|null{
  if(typeof v==='string'||typeof v==='number'){
    const s=String(v).padStart(10,'0');
    return /^\d{10}$/.test(s)?s:null;
  }
  return null;
}
function requireExpectedCik(ctx:ParserContext,label:string):string{
  const cik=ctx.expectedCik;
  if(!cik)throw new Error(`${label}: expectedCik مفقود من سياق الطلب.`);
  if(!/^\d{10}$/.test(cik))throw new Error(`${label}: expectedCik غير صالح.`);
  return cik;
}
function requireMatchingCik(data:any,expectedCik:string,label:string){
  const responseCik=normalizeCik(data?.cik);
  if(!responseCik)throw new Error(`${label}: الاستجابة لا تحتوي CIK.`);
  if(responseCik!==expectedCik)throw new Error(`${label}: CIK في الاستجابة (${responseCik}) لا يطابق المتوقع (${expectedCik}).`);
}
/** Reuse live SEC selection and revision de-duplication, never a second CIK resolver. */
export const parseSecFinancials:Parser<ParsedFinancials>=(raw,_source,ctx)=>{
  const expectedCik=requireExpectedCik(ctx,'SEC financials');
  const data=safeJson(raw,'SEC financials');
  requireMatchingCik(data,expectedCik,'SEC financials');
  const facts=parseSECFacts(data,expectedCik,ctx.asOf??new Date().toISOString().slice(0,10));
  const forms=new Map<string,string>();
  for(const tag of Object.values(data.facts?.['us-gaap']??{}) as any[])for(const records of Object.values(tag?.units??{}))if(Array.isArray(records))for(const r of records)if(typeof r?.accn==='string'&&typeof r.form==='string')forms.set(r.accn,r.form);
  const lines:ParsedFinancialLine[]=facts.map(f=>({key:f.key,value:f.value,unit:f.currency,
    period:f.period==='trailing'?'ttm':f.period,periodEnd:f.date,filedAt:f.publishedAt??null,
    form:forms.get(f.accession??'')??'',accession:f.accession??null,source:'sec-facts'}));
  if(!lines.length)throw new Error('SEC: لا بنود مالية مقبولة ضمن النماذج المسموحة.');
  const dates=lines.flatMap(l=>l.filedAt?[l.filedAt]:[]).sort();
  return {value:{symbol:ctx.expectedSymbol,currency:lines[0].unit,entityName:typeof data.entityName==='string'?data.entityName:'',lines},sourceTime:dates.at(-1)??null};
};

export const parseSecFilings:Parser<ParsedFilings>=(raw,_source,ctx)=>{
  const expectedCik=requireExpectedCik(ctx,'SEC filings');
  const data=safeJson(raw,'SEC filings');
  requireMatchingCik(data,expectedCik,'SEC filings');
  const recent=data?.filings?.recent;
  const filings:ParsedFiling[]=[];
  const ACCEPTED=new Set(['10-K','10-K/A','10-Q','10-Q/A','20-F','8-K','8-K/A','DEF 14A','S-1','S-1/A']);
  if(recent&&Array.isArray(recent.accessionNumber)){
    for(let i=0;i<recent.accessionNumber.length&&filings.length<40;i++){
      const accn=recent.accessionNumber[i],form=recent.form?.[i],filed=recent.filingDate?.[i];
      const periodEnd=recent.reportDate?.[i]??'',doc=recent.primaryDocument?.[i];
      if(typeof accn!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accn))continue;
      if(typeof form!=='string'||!ACCEPTED.has(form))continue;
      if(typeof filed!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(filed)||filed>(ctx.asOf??new Date().toISOString().slice(0,10)))continue;
      const url=typeof doc==='string'&&/^[a-zA-Z0-9_.-]+$/.test(doc)&&!doc.includes('..')
        ?`https://www.sec.gov/Archives/edgar/data/${Number(expectedCik)}/${accn.replaceAll('-','')}/${doc}`
        :`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${expectedCik}`;
      filings.push({
        accession:accn,form,filedAt:filed,
        periodEnd:/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)?periodEnd:'',
        url,
      });
    }
  }
  if(!filings.length)throw new Error('SEC: لا إفصاحات حديثة مقبولة.');
  filings.sort((a,b)=>b.filedAt.localeCompare(a.filedAt));
  return {value:{cik:expectedCik,filings},sourceTime:filings[0].filedAt};
};

export function secDispatch<T>(
  dataType:string,raw:string,source:SourceRef,ctx:ParserContext
):ParsedResult<T>{
  switch(dataType){
    case 'financials':return parseSecFinancials(raw,source,ctx) as unknown as ParsedResult<T>;
    case 'filings':return parseSecFilings(raw,source,ctx) as unknown as ParsedResult<T>;
    default:throw new Error(`SEC: نوع بيانات غير مدعوم ${dataType}.`);
  }
}
