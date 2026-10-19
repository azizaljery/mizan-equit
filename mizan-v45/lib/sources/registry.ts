/** Diagnostic source-pipeline registry. Production company analysis still enters through market-data.ts/configuredReader. */
/* Audit 2026-10-19: only `yahoo` and `sec` have ENDPOINT_BUILDERS and parsers. The keyed providers below (sahmk,
 * alpha-vantage, fmp, massive, tiingo, twelvedata, finnhub, eodhd) are inert candidates: no request is ever built for
 * them, with or without a key. `tadawul` has a parser for the company page but that page refuses automated requests
 * (HTTP 403 bot protection), see lib/source-blocking.ts. Twelve Data is used only by the Aziz research import route
 * (TWELVE_DATA_API_KEY) and the gold service; Alpaca by lib/alpaca-data.ts behind its server keys. */
import type { SourceCandidate, Market, DataType } from './types';

export const SOURCE_REGISTRY: readonly SourceCandidate[] = [
  {
    id: 'sec',
    name: 'SEC EDGAR',
    tier: 'regulator',
    market: 'us',
    dataTypes: ['financials', 'filings'],
    urlTemplate: 'https://data.sec.gov/',
    requiresKey: false,
    official: true,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'tadawul',
    name: 'تداول السعودية',
    tier: 'exchange',
    market: 'sa',
    dataTypes: ['price', 'history', 'financials', 'shares', 'dividends', 'news', 'sector'],
    urlTemplate: 'https://www.saudiexchange.sa/',
    requiresKey: false,
    official: true,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'sahmk',
    name: 'SAHMK (سهمك)',
    tier: 'provider',
    market: 'sa',
    dataTypes: ['price', 'history', 'financials', 'shares', 'dividends', 'corporateActions'],
    urlTemplate: 'https://api.sahmk.sa/',
    requiresKey: true,
    envKeyName: 'SAHMK_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'yahoo',
    name: 'Yahoo Finance',
    tier: 'provider',
    market: 'global',
    dataTypes: ['price', 'history', 'financials', 'dividends', 'corporateActions', 'news'],
    urlTemplate: 'https://query1.finance.yahoo.com/',
    requiresKey: false,
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'alpha-vantage',
    name: 'Alpha Vantage',
    tier: 'provider',
    market: 'global',
    // needs-verification: "global" هنا لا يثبت تغطية Tadawul أو صلاحية
    // symbol mapping السعودي. لا يدمج قبل التحقق من التوثيق والخطة.
    dataTypes: ['price', 'history', 'financials', 'dividends'],
    urlTemplate: 'https://www.alphavantage.co/',
    requiresKey: true,
    envKeyName: 'ALPHAVANTAGE_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'fmp',
    name: 'Financial Modeling Prep',
    tier: 'provider',
    market: 'global',
    dataTypes: ['financials', 'shares', 'dividends', 'sector', 'ownership'],
    urlTemplate: 'https://financialmodelingprep.com/',
    requiresKey: true,
    envKeyName: 'FMP_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'massive',
    name: 'Massive',
    tier: 'provider',
    market: 'us',
    dataTypes: ['price', 'history', 'corporateActions', 'news'],
    urlTemplate: 'https://massive.com/',
    requiresKey: true,
    envKeyName: 'POLYGON_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'tiingo',
    name: 'Tiingo',
    tier: 'provider',
    market: 'us',
    dataTypes: ['price', 'history', 'news', 'dividends'],
    urlTemplate: 'https://api.tiingo.com/',
    requiresKey: true,
    envKeyName: 'TIINGO_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'twelvedata',
    name: 'Twelve Data',
    tier: 'provider',
    market: 'global',
    dataTypes: ['price', 'history', 'corporateActions'],
    urlTemplate: 'https://api.twelvedata.com/',
    requiresKey: true,
    envKeyName: 'TWELVEDATA_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'finnhub',
    name: 'Finnhub',
    tier: 'provider',
    market: 'us',
    dataTypes: ['price', 'history', 'news', 'financials', 'ownership'],
    urlTemplate: 'https://finnhub.io/api/v1/',
    requiresKey: true,
    envKeyName: 'FINNHUB_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
  {
    id: 'eodhd',
    name: 'EODHD',
    tier: 'provider',
    market: 'global',
    dataTypes: ['price', 'history', 'financials', 'dividends', 'news'],
    urlTemplate: 'https://eodhd.com/api/',
    requiresKey: true,
    envKeyName: 'EODHD_API_KEY',
    official: false,
    derived: false,
    knownDelayMinutes: null,
  },
];

export const TIER_SCORE: Record<SourceCandidate['tier'], number> = {
  company: 100,
  exchange: 90,
  regulator: 85,
  ir: 80,
  gov: 75,
  provider: 60,
  news: 50,
  search: 10,
};

export function isSourceUsable(source: SourceCandidate, availableKeys: Set<string>): boolean {
  if (!source.requiresKey) return true;
  if (!source.envKeyName) return false;
  return availableKeys.has(source.envKeyName);
}

export function filterSources(
  registry: readonly SourceCandidate[],
  market: Market,
  dataType: DataType,
  availableKeys: Set<string>,
): SourceCandidate[] {
  return registry.filter((s) => {
    if (!isSourceUsable(s, availableKeys)) return false;
    if (s.market !== 'global' && s.market !== market) return false;
    return s.dataTypes.includes(dataType);
  });
}
