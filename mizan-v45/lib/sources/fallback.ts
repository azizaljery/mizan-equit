/** Diagnostic fallback executor. Production requests remain governed by configuredReader and market-data.ts. */
import { resolveSource } from './resolver';
import { readExternalSource } from '../source-probe';
import { USER_AGENT } from '../market-data';
import type {
  DataType, Market, SourceRef, Provenance, FetchAttempt, FetchResult,
} from './types';

export type ParsedResult<T>={
  value:T;
  sourceTime?:string|null;
};

export type ParserContext={
  expectedSymbol:string;
  expectedCik?:string;
  asOf?:string;
};

export type Parser<T>=(
  raw:string,
  source:SourceRef,
  ctx:ParserContext,
)=>ParsedResult<T>;

export type FallbackOptions={
  /** Reuse configuredReader in application calls (settings, SEC throttling, source_status). */
  reader?:typeof import('../market-data').upstream;
  timeoutMs?:number;
  fetcher?:typeof fetch;
  cik?:string;
  userAgent?:string;
  /**
   * إحصاءات القراءة تسجلها configuredReader مرة واحدة في source_health.
   * source_status ومخرجات parser تبقى مرجع الاعتماد؛ لا نكرر العد هنا.
   */
};

function buildProvenance(
  source:SourceRef,
  sourceTime:string|null|undefined,
):Provenance{
  return {
    source:source.id,
    url:source.resolvedUrl,
    sourceTime:sourceTime??null,
    retrievedAt:new Date().toISOString(),
    official:source.official,
    derived:source.derived,
    delayMinutes:source.knownDelayMinutes,
  };
}

export async function fetchWithFallback<T>(
  symbol:string,
  dataType:DataType,
  market:Market,
  availableKeys:Set<string>,
  parser:Parser<T>,
  options:FallbackOptions={},
):Promise<FetchResult<T>>{
  const resolved=await resolveSource(
    symbol,dataType,market,availableKeys,{cik:options.cik}
  );
  if(resolved.state==='unavailable'){
    return {state:'unavailable',reason:resolved.reason,attempts:[]};
  }

  const attempts:FetchAttempt[]=[];
  const chain:SourceRef[]=[resolved.primary,...resolved.fallbacks];
  const ctx:ParserContext={expectedSymbol:symbol,expectedCik:options.cik};

  for(const source of chain){
    const startedAt=Date.now();
    try{
      const response=options.reader?{raw:JSON.stringify(await options.reader(source.resolvedUrl,true,300000))}:await readExternalSource(
        source.resolvedUrl,
        options.fetcher??fetch,
        options.timeoutMs??12000,
        {userAgent:options.userAgent||USER_AGENT},
      );
      const latencyMs=Date.now()-startedAt;
      const parsed=parser(response.raw,source,ctx);
      attempts.push({source:source.id,url:source.resolvedUrl,status:'ok',latencyMs});
      return {
        state:'ok',
        value:parsed.value,
        provenance:buildProvenance(source,parsed.sourceTime),
        attempts,
      };
    }catch(e){
      const latencyMs=Date.now()-startedAt;
      attempts.push({
        source:source.id,
        url:source.resolvedUrl,
        status:'failed',
        latencyMs,
        error:e instanceof Error?e.message.slice(0,200):'unknown',
      });
    }
  }

  return {
    state:'failed',
    reason:'كل المصادر المتاحة لهذا النوع فشلت.',
    attempts,
  };
}

export function summarizeAttempts(attempts:FetchAttempt[]):string{
  if(!attempts.length)return 'لا محاولات.';
  return attempts.map(a=>{
    const status=a.status==='ok'
      ?`✓ ${a.latencyMs}ms`
      :a.status==='failed'
        ?`✗ ${a.error??'خطأ'}`
        :`⊘ ${a.reason??'تم تخطيه'}`;
    return `${a.source}: ${status}`;
  }).join(' | ');
}
