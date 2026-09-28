import { SOURCE_REGISTRY, TIER_SCORE, filterSources } from './registry';
import { hasEndpoint, buildEndpoint, type BuildContext } from './endpoints';
import type { SourceCandidate, DataType, Market, SourceRef } from './types';

export type ResolvedSource = {
  state: 'resolved';
  primary: SourceRef;
  fallbacks: SourceRef[];
  rejected: Array<{ source: string; reason: string }>;
};
export type UnresolvedSource = {
  state: 'unavailable';
  reason: string;
  rejected: Array<{ source: string; reason: string }>;
};
export type ResolutionResult = ResolvedSource | UnresolvedSource;

function rankSources(candidates: SourceCandidate[]): SourceCandidate[] {
  return [...candidates].sort((a, b) => {
    const at = TIER_SCORE[a.tier] ?? 0;
    const bt = TIER_SCORE[b.tier] ?? 0;
    if (at !== bt) return bt - at;
    const ad = a.dataTypes.length, bd = b.dataTypes.length;
    if (ad !== bd) return bd - ad;
    return a.id.localeCompare(b.id);
  });
}

export async function resolveSource(
  symbol: string,
  dataType: DataType,
  market: Market,
  availableKeys: Set<string> = new Set(),
  context: { cik?: string } = {},
): Promise<ResolutionResult> {
  const rejected: Array<{ source: string; reason: string }> = [];

  for (const source of SOURCE_REGISTRY) {
    if (!source.dataTypes.includes(dataType)) {
      rejected.push({ source: source.id, reason: `لا يغطي ${dataType}.` });
      continue;
    }
    if (source.market !== 'global' && source.market !== market) {
      rejected.push({ source: source.id, reason: `لا يخدم سوق ${market}.` });
      continue;
    }
    if (source.requiresKey && source.envKeyName && !availableKeys.has(source.envKeyName)) {
      rejected.push({ source: source.id, reason: `مفتاح ${source.envKeyName} غير متوفر.` });
      continue;
    }
    if (!hasEndpoint(source.id, dataType)) {
      rejected.push({ source: source.id, reason: `لا يوجد endpoint موثق لـ${dataType}.` });
    }
  }

  const candidates = filterSources(SOURCE_REGISTRY, market, dataType, availableKeys)
    .filter((s) => hasEndpoint(s.id, dataType));

  if (!candidates.length) {
    return {
      state: 'unavailable',
      reason: `لا يوجد مصدر جاهز لـ${dataType} في سوق ${market}.`,
      rejected,
    };
  }

  const buildCtx: BuildContext = { symbol, cik: context.cik };
  const refs: SourceRef[] = [];
  for (const c of rankSources(candidates)) {
    try {
      refs.push({ ...c, resolvedUrl: buildEndpoint(c.id, dataType, buildCtx) });
    } catch (e) {
      rejected.push({
        source: c.id,
        reason: e instanceof Error ? e.message : 'فشل بناء الرابط.',
      });
    }
  }

  if (!refs.length) {
    return {
      state: 'unavailable',
      reason: `كل المصادر المرشحة لـ${dataType} فشلت في بناء رابط.`,
      rejected,
    };
  }

  return { state: 'resolved', primary: refs[0], fallbacks: refs.slice(1), rejected };
}

export function collectAvailableKeys(env: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const source of SOURCE_REGISTRY) {
    if (source.envKeyName && typeof env[source.envKeyName] === 'string' && String(env[source.envKeyName]).length) {
      keys.add(source.envKeyName);
    }
  }
  return keys;
}


export function describeResolution(result:ResolutionResult):string{
  if(result.state==='unavailable')return `غير متاح: ${result.reason}`;
  return `المصدر الأساسي: ${result.primary.name} (${result.primary.tier}). بدائل: ${result.fallbacks.length}.`;
}

/** Report executable contracts only; candidate names do not prove connectivity. */
export function supportedTypes(market:Market,availableKeys:Set<string>=new Set(),context:{cik?:string}={}):DataType[]{
  const types=new Set<DataType>();
  for(const type of new Set(SOURCE_REGISTRY.flatMap(s=>s.dataTypes))){
    if(filterSources(SOURCE_REGISTRY,market,type,availableKeys).some(s=>hasEndpoint(s.id,type)&&(s.id!=='sec'||!!context.cik)))types.add(type);
  }
  return [...types];
}
