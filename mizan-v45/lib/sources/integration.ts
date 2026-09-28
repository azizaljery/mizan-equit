import { fetchWithFallback, summarizeAttempts } from './fallback';
import { getParser } from './parsers';
import { gradeFromFetchResult } from './quality';
import { collectAvailableKeys } from './resolver';
import { resolveCik, needsCik } from './cik';
import { upstream } from '../market-data';
import type {
  DataType, Market, FetchResult, DataQuality, Provenance, FetchAttempt,
} from './types';

export type SourceFetchOptions={
  /** Prefer the caller's existing CIK; otherwise resolve through its reader. */
  cik?:string;
  reader?:typeof import('../market-data').upstream;
  availableKeys?:Set<string>;
  env?:Record<string,unknown>;
  fetcher?:typeof fetch;
  timeoutMs?:number;
  userAgent?:string;
};

export type SourcedResult<T>={
  result:FetchResult<T>;
  quality:DataQuality;
  summary:string;
};

export async function fetchViaSources<T>(
  symbol:string,
  dataType:DataType,
  market:Market,
  options:SourceFetchOptions={},
):Promise<SourcedResult<T>>{
  const availableKeys=options.availableKeys??collectAvailableKeys(options.env??{});
  const parser=getParser<T>(dataType);
  let cik=options.cik;
  if(!cik&&needsCik(dataType,market)) {
    // A configured reader remains authoritative: never bypass its failure.
    const reader=options.reader??((url:string,json?:boolean,ttl?:number)=>
      upstream(url,json,ttl,undefined,{fetcher:options.fetcher,userAgent:options.userAgent}));
    cik=(await resolveCik(symbol,reader))??undefined;
  }
  const result=await fetchWithFallback<T>(
    symbol,dataType,market,availableKeys,parser,
    {
      cik,
      reader:options.reader,
      fetcher:options.fetcher,
      timeoutMs:options.timeoutMs,
      userAgent:options.userAgent,
    },
  );
  const quality=gradeFromFetchResult(result,{dataType});
  return {result,quality,summary:describeSourcedResult(result,quality)};
}

export function describeSourcedResult<T>(result:FetchResult<T>,quality:DataQuality):string{
  if(result.state==='ok'){
    return `ok · ${result.provenance.source} · ${quality.grade} (${quality.score}/100) · ${summarizeAttempts(result.attempts)}`;
  }
  if(result.state==='unavailable')return `unavailable · ${result.reason}`;
  return `failed · ${result.reason} · ${summarizeAttempts(result.attempts)}`;
}
export function pickProvenance<T>(r:FetchResult<T>):Provenance|null{
  return r.state==='ok'?r.provenance:null;
}
export function pickAttempts<T>(r:FetchResult<T>):FetchAttempt[]{return r.attempts;}

/**
 * المرحلة الأولى: المسار القديم في ميزان يفوز إذا أعاد قيمة.
 * لا نخترع Quality للمسار القديم.
 */
export function preferLegacy<T>(
  legacy:T|null|undefined,
  sourced:SourcedResult<T>|null|undefined,
):{value:T|null;from:'legacy'|'sources'|'none'}{
  if(legacy!==null&&legacy!==undefined)return {value:legacy,from:'legacy'};
  if(sourced?.result.state==='ok')return {value:sourced.result.value,from:'sources'};
  return {value:null,from:'none'};
}
