/** Verified listing exceptions, not a complete live listing-status service.
 * Never rewrite historical universes or alias a cancelled security to its successor.
 */
export type ListingRestriction = {
  symbol: string; status: 'suspended' | 'delisted'; effectiveDate: string;
  publishedDate: string; source: string; reason: string;
};
export const LISTING_POLICY = 'mizan-known-listing-events-1';
export const KNOWN_LISTING_EVENTS: readonly Readonly<ListingRestriction>[] = Object.freeze([
  Object.freeze({
    symbol: '1090.SR', status: 'suspended' as const,
    effectiveDate: '2021-04-01', publishedDate: '2021-04-01',
    source: 'https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/news-details/%21ut/p/z0/fczNCoJQEIbhq2kpM0fKbOnKCiEkMTsbGXSIkzb-nbLLT7RFq3bvM3wMaMhAC73MjaxphOrJV-3lm8BDd-_jKUwihXG6jfw0ThQe1nBmgSPo_6Ppi7l3nQ5AF41YflvILJU0PuucZYUDOV_O3fam4IGkNFLyVPNReFziQX3FdmFhf-i46Cpco8oV7hDaKrx8AOvcy3o%21/',
    reason: 'عُلّق تداول سامبا (1090) ابتداءً من 1 أبريل 2021 لإجراءات إلغاء الإدراج؛ لا يُنشأ له توقع حالي.',
  }),
  Object.freeze({
    symbol: '1090.SR', status: 'delisted' as const,
    effectiveDate: '2021-04-04', publishedDate: '2021-04-05',
    source: 'https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/news-details/%21ut/p/z0/fczNCoJQEIbhq2kpMx7S3LqyQghJzM5GBh3ipI1_p-zyE23Rqt37DB8DGnLQQi9zI2taoWb2VfuFF_qo9gGeojR2Mcl2cZAlqYuHLZxZ4Aj6_2j-Yu59r0PQZSuW3xZySxVNz6Zg2eBIzpdLd4MpeSSpjFQ813IUntZ40FCzXVnaHzoKlYtb9BwSUdDV0eUDfCzqoQ%21%21/',
    reason: 'أُلغِي إدراج أسهم سامبا (1090) بنهاية 4 أبريل 2021. الرمز محفوظ للأرشيف، وليس سهمًا نشطًا للتحليل الحالي. لا يُستبدل تلقائيًا برمز آخر.',
  }),
]);
function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function listingRestriction(symbol: string, asOf = new Date().toISOString().slice(0, 10)): Readonly<ListingRestriction> | null {
  if (!validDay(asOf)) throw new Error('invalid-listing-date');
  const matches = KNOWN_LISTING_EVENTS.filter(e => e.symbol === symbol && e.effectiveDate <= asOf && e.publishedDate <= asOf);
  return matches.at(-1) ?? null; // null is unknown, NOT verified active.
}
export function selectCurrentCandidates<T extends {symbol:string}>(rows: readonly T[], asOf?: string): T[] {
  return rows.filter(row => listingRestriction(row.symbol, asOf) === null);
}
export class InactiveInstrumentError extends Error {
  readonly code = 'instrument_not_active';
  readonly listing: Readonly<ListingRestriction>;
  constructor(listing: Readonly<ListingRestriction>) {
    super(listing.reason); this.name = 'InactiveInstrumentError'; this.listing = listing;
  }
}
export function assertCurrentInstrument(symbol: string): void {
  const listing = listingRestriction(symbol);
  if (listing) throw new InactiveInstrumentError(listing);
}
