/** Resolve SEC identity through the existing reader/cache, without a second fetch or cache. */
import type { DataType } from './types';

export type TickerReader = (url:string,json?:boolean,ttl?:number)=>Promise<unknown>;
export type CikResolution=
  |{ok:true;cik:string;source:'sec-tickers'}
  |{ok:false;reason:string};
const TICKER_URL='https://www.sec.gov/files/company_tickers.json';
const TICKER_TTL_MS=86400000;

export function normalizeSecTicker(symbol:string):string {
  return symbol.trim().replace(/\./g,'-').toUpperCase();
}

export async function resolveCikDetailed(symbol:string,read:TickerReader):Promise<CikResolution> {
  if(typeof symbol!=='string')return {ok:false,reason:'رمز الشركة غير صالح لتحديد CIK.'};
  const normalized=normalizeSecTicker(symbol);
  if(!/^[A-Z][A-Z0-9-]{0,15}$/.test(normalized))return {ok:false,reason:'رمز الشركة غير صالح لتحديد CIK.'};
  try {
    const map=await read(TICKER_URL,true,TICKER_TTL_MS);
    if(!map||typeof map!=='object'||Array.isArray(map))return {ok:false,reason:'استجابة خريطة SEC غير صالحة.'};
    for(const value of Object.values(map)) {
      if(!value||typeof value!=='object')continue;
      const row=value as {ticker?:unknown;cik_str?:unknown};
      if(typeof row.ticker!=='string'||normalizeSecTicker(row.ticker)!==normalized)continue;
      if(typeof row.cik_str!=='number'&&typeof row.cik_str!=='string')return {ok:false,reason:`قيمة CIK للرمز ${normalized} غير صالحة.`};
      const cik=String(row.cik_str);
      return /^\d{1,10}$/.test(cik)&&Number(cik)>0
        ?{ok:true,cik:cik.padStart(10,'0'),source:'sec-tickers'}
        :{ok:false,reason:`قيمة CIK للرمز ${normalized} غير صالحة.`};
    }
    return {ok:false,reason:`الرمز ${normalized} غير مدرج في خريطة SEC الرسمية.`};
  } catch(e) {
    return {ok:false,reason:'تعذر جلب خريطة SEC: '+(e instanceof Error?e.message.slice(0,180):'سبب غير معروف.')};
  }
}

/** Backwards-compatible nullable helper for the source resolver. */
export async function resolveCik(symbol:string,read:TickerReader):Promise<string|null> {
  const result=await resolveCikDetailed(symbol,read);
  return result.ok?result.cik:null;
}

export function needsCik(dataType:DataType,market:string):boolean {
  return market==='us'&&(dataType==='financials'||dataType==='filings');
}
