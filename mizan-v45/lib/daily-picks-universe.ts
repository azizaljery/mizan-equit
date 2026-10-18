/**
 * FROZEN universe and constants of PROTOCOL-DIR-0002 (research/PROTOCOL-DIR-0002.md @ c831eb62).
 * Do not edit: any change (symbols, horizons, cut, feature) is a NEW model version with its own frozen protocol (§8),
 * recorded in parallel from its freeze date only. Delisted/suspended symbols stay here and count as «لم يصعد».
 */
export const MODEL_VERSION='mom126_5-top20-v1' as const;
export const PROTOCOL_COMMIT='c831eb62ae8e1058803e20be089498306d45ba62' as const;
export const HORIZONS=[5,21] as const;
export type LedgerHorizon=typeof HORIZONS[number];
export const TOP_FRACTION=0.2;
export const DISPLAY_TOP=3;
export type LedgerMarket='sa'|'us';
export const MARKETS:readonly LedgerMarket[]=['sa','us'];

export const SA_UNIVERSE=Object.freeze(['1010','1020','1030','1050','1060','1120','1140','1150','1180','1211','1303','1304','2010','2020','2050','2060','2082','2222','2280','2290',
 '2310','2350','2380','3030','4001','4002','4003','4005','4013','4030','4061','4190','4200','4260','4263','4300','5110','6010','7010','7020'].map(s=>s+'.SR'));
export const US_UNIVERSE=Object.freeze(['AAPL','ABBV','ACN','AMGN','AMZN','BA','CAT','COST','CRM','CSCO','CVX','DHR','GE','GOOGL','HD','HON','IBM','INTC','JNJ','JPM',
 'KO','LIN','LOW','MCD','META','MMM','MRK','MSFT','NKE','NVDA','ORCL','PEP','PG','TMO','TXN','UNP','UPS','V','WMT','XOM']);
export const UNIVERSE:Readonly<Record<LedgerMarket,readonly string[]>>=Object.freeze({sa:SA_UNIVERSE,us:US_UNIVERSE});
export const CURRENCY:Readonly<Record<LedgerMarket,string>>={sa:'SAR',us:'USD'};
/** Session calendars for target-date resolution (§4): Tadawul proxy calendar (union of liquid large caps, same as
 *  saudiSessionCalendar in lib/market-data.ts; all three are universe members) and SPY for the US. */
export const US_CALENDAR_SYMBOL='SPY';
