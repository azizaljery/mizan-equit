import { getParser } from './parsers';
import { SOURCE_REGISTRY } from './registry';
import { hasEndpoint } from './endpoints';
import {supportedTypes} from './resolver';
import { gradeFromFetchResult } from './quality';
import type { SourcedResult } from './integration';
import type { ParserContext } from './fallback';
import type { DataType, Market, FetchAttempt, Provenance, DataQuality, FetchResult } from './types';

export type SourceObservation = {
  dataType: DataType; state: FetchResult<unknown>['state'];
  provenance: Provenance | null; quality: DataQuality; reason?: string;
  fallbackUsed: boolean;
};
export type CompanySourceTrace = { observations: SourceObservation[]; attempts: FetchAttempt[] };

/** Parse bytes already obtained by configuredReader. No second network or CIK path. */
export function parseExistingResponse<T>(sourceId:string,dataType:DataType,data:unknown,url:string,ctx:ParserContext):SourcedResult<T>{
  const candidate=SOURCE_REGISTRY.find(s=>s.id===sourceId);
  let result:FetchResult<T>;
  if(!candidate||!candidate.dataTypes.includes(dataType)||!hasEndpoint(sourceId,dataType)){
    result={state:'unavailable',reason:'لا يوجد موصل متكامل لهذا المصدر ونوع البيانات.',attempts:[]};
  }else try{
    const parsed=getParser<T>(dataType)(typeof data==='string'?data:JSON.stringify(data),{...candidate,resolvedUrl:url},ctx);
    result={state:'ok',value:parsed.value,provenance:{source:sourceId,url,sourceTime:parsed.sourceTime??null,
      retrievedAt:new Date().toISOString(),official:candidate.official,derived:candidate.derived,delayMinutes:candidate.knownDelayMinutes},attempts:[]};
  }catch(e){result={state:'failed',reason:e instanceof Error?e.message:'تعذرت قراءة البيانات.',attempts:[]};}
  const quality=result.state==='failed'?{grade:'invalid' as const,score:0,reasons:[result.reason]}:gradeFromFetchResult(result,{dataType});
  return {result,quality,summary:`${result.state} · ${quality.grade} (${quality.score}/100)`};
}

export function observeResult<T>(dataType:DataType,sourced:SourcedResult<T>,fallbackUsed=false):SourceObservation{
  return {dataType,state:sourced.result.state,provenance:sourced.result.state==='ok'?sourced.result.provenance:null,
    quality:sourced.quality,...(sourced.result.state==='ok'?{}:{reason:sourced.result.reason}),fallbackUsed};
}

export function availableDataTypesFor(market:Market,availableKeys:Set<string>=new Set(),context:{cik?:string}={}):DataType[]{
  return supportedTypes(market,availableKeys,context);
}
