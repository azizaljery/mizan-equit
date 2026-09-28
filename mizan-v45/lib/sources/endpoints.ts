import type { DataType } from './types';
import { fundamentalsURL } from '../market-data';

export type BuildContext = {
  symbol: string;
  cik?: string;
};

export type UrlBuilder = (ctx: BuildContext) => string;

export const ENDPOINT_BUILDERS: Record<string, Partial<Record<DataType, UrlBuilder>>> = {
  yahoo: {
    price: (ctx) =>
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ctx.symbol)}?interval=1m&range=1d&includePrePost=false`,
    history: (ctx) =>
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ctx.symbol)}?interval=1d&range=5y&events=splits%2Cdiv`,
    financials: (ctx) => fundamentalsURL(ctx.symbol,new Date().toISOString().slice(0,10)),
    news: (ctx) =>
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ctx.symbol)}&newsCount=6&quotesCount=0`,
    dividends: (ctx) =>
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ctx.symbol)}?interval=1d&range=5y&events=div`,
    corporateActions: (ctx) =>
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ctx.symbol)}?interval=1d&range=5y&events=splits%2Cdiv`,
  },
  sec: {
    financials: (ctx) => {
      if (!ctx.cik) throw new Error('SEC يتطلب CIK من طبقة ميزان الحالية.');
      return `https://data.sec.gov/api/xbrl/companyfacts/CIK${ctx.cik}.json`;
    },
    filings: (ctx) => {
      if (!ctx.cik) throw new Error('SEC يتطلب CIK من طبقة ميزان الحالية.');
      return `https://data.sec.gov/submissions/CIK${ctx.cik}.json`;
    },
  },
};

export function hasEndpoint(sourceId: string, dataType: DataType): boolean {
  return !!ENDPOINT_BUILDERS[sourceId]?.[dataType];
}

export function buildEndpoint(sourceId: string, dataType: DataType, ctx: BuildContext): string {
  const builders = ENDPOINT_BUILDERS[sourceId];
  if (!builders) throw new Error(`لا توجد endpoints موثقة للمصدر ${sourceId}.`);
  const builder = builders[dataType];
  if (!builder) throw new Error(`المصدر ${sourceId} لا يوفر ${dataType} حالياً.`);
  return builder(ctx);
}
