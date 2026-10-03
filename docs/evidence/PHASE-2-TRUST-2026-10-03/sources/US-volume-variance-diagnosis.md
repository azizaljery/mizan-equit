# P2-05 US volume variance diagnosis

Captured 2026-10-03 UTC; scope limited to the two already-selected session rows, 2026-09-10, for AAPL and MSFT. Read-only; no value was corrected or substituted.

## Observations

| Symbol | Canonical app/Yahoo chart and Yahoo Finance history | Nasdaq Historical Quotes | App minus Nasdaq |
|---|---:|---:|---:|
| AAPL | 70,011,900 shares | 70,011,910 shares | -10 shares |
| MSFT | 16,038,800 shares | 16,038,810 shares | -10 shares |

For both rows, date, open, high, low, and close agree at the published price precision. The Yahoo Finance public history page reproduces the same Yahoo chart volume consumed by the canonical parser. Thus the discrepancy is cross-source, not a parser rounding or field-mapping change within the app.

## What the sources establish

- Nasdaq defines volume as the daily number of shares that change hands between buyer and seller ([Nasdaq glossary](https://www.nasdaq.com/glossary/b/volume)). Its historical table labels a Volume column; displayed values are whole-share integers.
- Yahoo Finance public history displays the same volume as the captured chart response for both symbols: [AAPL Yahoo history](https://finance.yahoo.com/quote/AAPL/history/) and [MSFT Yahoo history](https://finance.yahoo.com/quote/MSFT/history/). Yahoo Help says its exchange/data-provider mapping varies by exchange and notes that international historical chart data is provided by Morningstar ([Yahoo Finance data-provider help](https://help.yahoo.com/kb/SLN2352.html)); the retrieved documentation does not identify the exact US provider/feed or a correction policy for these two bars.
- The Nasdaq page’s historical rows have a distinct 10-share higher volume for both securities. No source reviewed documents an exact 10-share rounding, scope, or revision rule that explains the difference.

## Conclusion and handling

Cause remains **UNRESOLVED**. The shared -10 difference is an observation, not evidence that either provider is correct or that the data was rounded, revised, or filtered. Preserve each source value and provenance; keep US volume marked `UNRESOLVED_SOURCE_VARIANCE` and do not substitute one value for the other. Price/identity/date checks remain separately reportable as matches. Resolve volume only after a documented field-definition/source-selection decision or an independently authoritative, same-session trade-volume record is available.

This note does not expand to additional dates or a five-year audit.
