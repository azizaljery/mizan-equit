import { parseChart, parseFundamentals, FUNDAMENTALS } from '../../market-data';
import { parseLiveQuote } from '../../live-quote';
import { validateMarketIdentity } from '../../market-identity';
import type { Parser, ParsedResult, ParserContext } from '../fallback';
import type { SourceRef } from '../types';
import type { ParsedFinancials, ParsedFinancialLine, ParsedPeriod } from './types';

const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const isoDate=(v:unknown)=>typeof v==='string'&&DATE_RE.test(v)?v:null;
const isoCurrency=(v:unknown)=>typeof v==='string'&&/^[A-Z]{3}$/.test(v)?v:null;
function safeJson(raw:string,label:string):any{
  try{return JSON.parse(raw)}catch{throw new Error(`${label}: الاستجابة ليست JSON صالحاً.`)}
}

/** Adapt the existing parser; preserve its identity, currency and 3M checks. */
export function parseYahooFinancials(
  raw:string,_source:SourceRef,ctx:ParserContext
):ParsedResult<ParsedFinancials>{
  if(!ctx.expectedSymbol)throw new Error('Yahoo financials: expectedSymbol مفقود من سياق الطلب.');
  const data=safeJson(raw,'Yahoo financials');
  const results=data?.timeseries?.result;
  if(!Array.isArray(results)||!results.length)throw new Error('Yahoo financials: لا يوجد timeseries.result.');
  const known=new Set(Object.values(FUNDAMENTALS));
  const expanded=results.flatMap((row:any)=>Object.entries(row||{}).flatMap(([type,points])=>{
    if(!/^(annual|quarterly|trailing)/.test(type)||!known.has(type.replace(/^(annual|quarterly|trailing)/,''))||!Array.isArray(points))return [];
    return [{meta:{...row.meta,type:[type]},[type]:points}];
  }));
  const facts=parseFundamentals({timeseries:{result:expanded}},ctx.expectedSymbol,ctx.asOf??new Date().toISOString().slice(0,10));
  const lines:ParsedFinancialLine[]=facts.filter(f=>isoCurrency(f.currency)).map(f=>({
    key:f.key,value:f.value,unit:f.currency,period:f.period==='trailing'?'ttm':f.period,
    periodEnd:f.date,filedAt:null,form:f.period,accession:null,source:'yahoo-ts',
  }));
  if(!lines.length)throw new Error('Yahoo financials: لا بنود صالحة.');
  return {value:{symbol:ctx.expectedSymbol,currency:lines[0].unit,entityName:'',lines},sourceTime:null};
}

export type YahooHistoryValue={
  symbol:string;
  currency:string;
  prices:Array<{date:string;open:number;high:number;low:number;close:number;volume:number}>;
  corporateActions:Array<{kind:'split'|'dividend';date:string;detail:string}>;
};
export const parseYahooHistory:Parser<YahooHistoryValue>=(raw,_source,ctx)=>{
  const data=safeJson(raw,'Yahoo history');
  const meta=data?.chart?.result?.[0]?.meta;
  if(!meta?.symbol)throw new Error('Yahoo history: بنية الرد غير صالحة.');
  const symbol=String(meta.symbol);
  if(symbol!==ctx.expectedSymbol)throw new Error(`Yahoo history: meta.symbol=${symbol} لا يطابق المتوقع ${ctx.expectedSymbol}.`);
  const allowIndex=symbol.startsWith('^');
  validateMarketIdentity(meta,ctx.expectedSymbol,allowIndex);
  const parsed=parseChart(data,ctx.asOf??new Date().toISOString().slice(0,10),allowIndex);
  if(!parsed.prices?.length)throw new Error('Yahoo history: لا جلسات سعرية صالحة.');
  // Only timestamps belonging to accepted OHLCV bars may be called sourceTime.
  const result=data.chart.result[0],quote=result.indicators.quote[0];
  const accepted=new Map(parsed.prices.map(p=>[p.date,p]));
  const timestamps=(result.timestamp as number[]).filter((t,i)=>{
    if(!Number.isFinite(t)||t<=0)return false;
    const date=new Date((t+(meta.gmtoffset||0))*1000).toISOString().slice(0,10),p=accepted.get(date);
    return !!p&&p.open===quote.open?.[i]&&p.high===quote.high?.[i]&&p.low===quote.low?.[i]&&p.close===quote.close?.[i]&&p.volume===quote.volume?.[i];
  });
  const sourceTime=timestamps.length?new Date(Math.max(...timestamps)*1000).toISOString():null;
  return {
    value:{
      symbol,
      currency:String(parsed.meta?.currency??meta.currency??''),
      prices:parsed.prices,
      corporateActions:parsed.corporateActions??[],
    },
    sourceTime,
  };
};

export type YahooQuoteValue={symbol:string;price:number;currency:string;quoteTime:string};
export const parseYahooPrice:Parser<YahooQuoteValue>=(raw,_source,ctx)=>{
  const data=safeJson(raw,'Yahoo price');
  const meta=data?.chart?.result?.[0]?.meta;
  if(!meta?.symbol)throw new Error('Yahoo price: بنية الرد غير صالحة.');
  const symbol=String(meta.symbol);
  if(symbol!==ctx.expectedSymbol)throw new Error(`Yahoo price: meta.symbol=${symbol} لا يطابق المتوقع ${ctx.expectedSymbol}.`);
  validateMarketIdentity(meta,ctx.expectedSymbol);
  const q=parseLiveQuote(data,symbol);
  return {value:{symbol,price:q.price,currency:q.currency,quoteTime:q.quoteTime},sourceTime:q.quoteTime};
};

export type YahooNewsValue={items:Array<{title:string;url:string;date:string;publisher:string}>};
export const parseYahooNews:Parser<YahooNewsValue>=(raw)=>{
  const data=safeJson(raw,'Yahoo news');
  const news=Array.isArray(data?.news)?data.news:[];
  const items:YahooNewsValue['items']=[];
  for(const n of news as any[]){
    const title=typeof n?.title==='string'?n.title:null;
    const url=typeof n?.link==='string'?n.link:null;
    const t=typeof n?.providerPublishTime==='number'&&Number.isFinite(n.providerPublishTime)
      ?n.providerPublishTime:null;
    if(!title||!url||t===null)continue;
    items.push({
      title,url,date:new Date(t*1000).toISOString(),
      publisher:typeof n?.publisher==='string'&&n.publisher.trim()?n.publisher:'Yahoo Finance',
    });
  }
  const latest=items.reduce<string|null>((m,i)=>!m||i.date>m?i.date:m,null);
  return {value:{items},sourceTime:latest};
};

export type YahooDividendsValue={events:Array<{date:string;amount:number}>};
export const parseYahooDividends:Parser<YahooDividendsValue>=(raw,_source,ctx)=>{
  const data=safeJson(raw,'Yahoo dividends');
  validateMarketIdentity(data?.chart?.result?.[0]?.meta,ctx.expectedSymbol);
  const events=data?.chart?.result?.[0]?.events?.dividends??{};
  const out:YahooDividendsValue['events']=[];
  for(const v of Object.values(events) as any[]){
    const t=num(v?.date),amount=num(v?.amount);
    if(t===null||amount===null)continue;
    out.push({date:new Date(t*1000).toISOString().slice(0,10),amount});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  return {value:{events:out},sourceTime:null};
};

export type YahooCorporateActionsValue={
  actions:Array<{kind:'split'|'dividend';date:string;detail:string}>
};
export const parseYahooCorporateActions:Parser<YahooCorporateActionsValue>=(raw,_source,ctx)=>{
  const data=safeJson(raw,'Yahoo corporateActions');
  validateMarketIdentity(data?.chart?.result?.[0]?.meta,ctx.expectedSymbol);
  const result=data?.chart?.result?.[0];
  const actions:YahooCorporateActionsValue['actions']=[];
  for(const v of Object.values(result?.events?.splits??{}) as any[]){
    const t=num(v?.date); if(t===null)continue;
    actions.push({kind:'split',date:new Date(t*1000).toISOString().slice(0,10),detail:String(v?.splitRatio??v?.numerator??'')});
  }
  for(const v of Object.values(result?.events?.dividends??{}) as any[]){
    const t=num(v?.date),amount=num(v?.amount); if(t===null||amount===null)continue;
    actions.push({kind:'dividend',date:new Date(t*1000).toISOString().slice(0,10),detail:String(amount)});
  }
  actions.sort((a,b)=>a.date.localeCompare(b.date));
  return {value:{actions},sourceTime:null};
};

export function yahooDispatch<T>(
  dataType:string,raw:string,source:SourceRef,ctx:ParserContext
):ParsedResult<T>{
  switch(dataType){
    case 'financials':return parseYahooFinancials(raw,source,ctx) as unknown as ParsedResult<T>;
    case 'history':return parseYahooHistory(raw,source,ctx) as unknown as ParsedResult<T>;
    case 'price':return parseYahooPrice(raw,source,ctx) as unknown as ParsedResult<T>;
    case 'news':return parseYahooNews(raw,source,ctx) as unknown as ParsedResult<T>;
    case 'dividends':return parseYahooDividends(raw,source,ctx) as unknown as ParsedResult<T>;
    case 'corporateActions':return parseYahooCorporateActions(raw,source,ctx) as unknown as ParsedResult<T>;
    default:throw new Error(`Yahoo: نوع بيانات غير مدعوم ${dataType}.`);
  }
}
