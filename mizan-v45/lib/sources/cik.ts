/** Resolve SEC identity through the existing reader/cache, without a second fetch or cache. */
import type { DataType } from './types';

export type TickerReader = (url:string,json?:boolean,ttl?:number)=>Promise<unknown>;
const TICKER_URL='https://www.sec.gov/files/company_tickers.json';
const TICKER_TTL_MS=86400000;

export function normalizeSecTicker(symbol:string):string {
  return symbol.trim().replace(/\./g,'-').toUpperCase();
}

export async function resolveCik(symbol:string,read:TickerReader):Promise<string|null> {
  if(typeof symbol!=='string')return null;
  const normalized=normalizeSecTicker(symbol);
  if(!/^[A-Z][A-Z0-9-]{0,15}$/.test(normalized))return null;
  try {
    const map=await read(TICKER_URL,true,TICKER_TTL_MS);
    if(!map||typeof map!=='object'||Array.isArray(map))return null;
    for(const value of Object.values(map)) {
      if(!value||typeof value!=='object')continue;
      const row=value as {ticker?:unknown;cik_str?:unknown};
      if(typeof row.ticker!=='string'||normalizeSecTicker(row.ticker)!==normalized)continue;
      if(typeof row.cik_str!=='number'&&typeof row.cik_str!=='string')return null;
      const cik=String(row.cik_str);
      return /^\d{1,10}$/.test(cik)&&Number(cik)>0?cik.padStart(10,'0'):null;
    }
    return null;
  } catch {
    return null;
  }
}

export function needsCik(dataType:DataType,market:string):boolean {
  return market==='us'&&(dataType==='financials'||dataType==='filings');
}
