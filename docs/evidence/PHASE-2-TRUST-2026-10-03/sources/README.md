# P2-05 source-data validation — 2026-10-03

Scope: read-only canonical app market-data identity/period comparison for Saudi and US equities. No investment advice. The canonical app normalizer was run from exact baseline `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241`, validated against the 697-file parity manifest SHA-256 recorded in each evidence file.

Official primary comparisons: Saudi Exchange Detailed Daily Report for 2026-09-10 (official search-result excerpt; direct report page access returned 403, so this access limit is explicit), and directly inspected Nasdaq AAPL/MSFT Historical Quotes pages for 2026-09-10. Four ticker/date price series were retrieved through the canonical app `upstream()` plus `parseChart()` path; no configured database reader, production app API, source telemetry, analysis write, deployment, or secrets were used. The response-body bundle stores exact HTTP bodies cloned from the same reads that the canonical parser consumed.

Results at published two-decimal precision: 2222.SR and 1120.SR OHLCV matched the Saudi Exchange report; Saudi name labels are variants, not evidence of wrong entity. AAPL and MSFT OHLC matched Nasdaq, but app/Yahoo volume was 10 shares lower than Nasdaq for each; this remains an unresolved source variance. Do not mark P2-05 wholly PASS while that discrepancy is open. Full five-year coverage and corporate-action-adjusted-series equivalence were not proven by the single-date comparison.

Files:
- `EVD-TRUST-P2-05-SA.json` — Saudi evidence (P2-05 sample-date field comparisons, source metadata, coverage/corporate-action caveats)
- `EVD-TRUST-P2-05-US.json` — US evidence (AAPL + MSFT; includes the unresolved 10-share volume deltas)
- `normalized-app-results.json` — canonical parsed OHLCV and metadata for four symbols
- `yahoo-chart-responses.json` — exact Yahoo chart HTTP response bodies consumed by the canonical parser, raw-body SHA-256 values and URLs
- `collect.mjs` — read-only collector used; code belongs to deliverable directory, not repository

No canonical repository files were changed.
