# Phase 2 Trust Baseline — Proposed Risk Register

**Status:** Owner-approved Trust Baseline; initial risks are OPEN until evidence changes them  
**Baseline:** Frozen canonical `mizan-v45/` source commit `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241`; Phase 1 closed and PR2 merged  
**Scope:** New Phase 2 Trust Baseline only; preserve historical deployment-independence roadmap separately  
**Last updated:** 2026-10-03

## Rating and closure rules

- Impact/severity is qualitative: CRITICAL, HIGH, MEDIUM, LOW. A CRITICAL impact means plausible loss/corruption of portfolio, ledger, forecast, or environment integrity, or an untraceable result that could be relied on as fact.
- Likelihood is HIGH, MEDIUM, LOW, or UNKNOWN. UNKNOWN is never treated as LOW; insufficient evidence keeps a risk open.
- Residual risk describes what remains after the proposed mitigation; no residual risk is asserted before evidence exists.
- Phase 2 cannot close with any open CRITICAL risk. Any HIGH residual risk, accepted limitation, or untested boundary must be explicitly visible to and accepted by the human reviewer.
- This is not a probability score and no numeric risk score is calculated.

| Risk ID | Category | Condition / consequence | Initial impact / likelihood | Planned mitigation and evidence | Initial state / residual |
|---|---|---|---|---|---|
| FIN-P2-R001 | DATA | Baseline SHA is frozen, but the current Sites binding metadata does not expose the provider DB name/UUID; test results could be attributed to an incompletely identified target. | HIGH / UNKNOWN | Use canonical baseline `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241`. The read-only overview confirmed Sites project `appgprj_6a9bd7353ed4819193fcd5363ed1d38f`, selected binding `DB`, and table names only. Record an authoritative provider-safe DB name/UUID/region or explicitly document access limits in `EVD-TRUST-P2-01-IDENTITY`. | OPEN / UNKNOWN |
| FIN-P2-R002 | DATA | Prior records do not define what D2 refers to; mapping D2 to D1 or the E-003 restore could misstate which independent target was verified. This is an identity/scope uncertainty, not evidence of corruption or a failed database. | HIGH / UNKNOWN | Keep D2 unresolved. Ask what D2 denotes and which authoritative source/identifier defines it; do not presume a database or request credentials. Records distinguish production D1 `mizan-equity-db` from deleted E-003 target `mizan-equity-e003-36779960771` (UUID `679bd26c-c70a-4d1d-89dc-487a61bfeb2d`, EEUR); neither defines D2. Record clarification and independent evidence in `EVD-TRUST-P2-01-IDENTITY`. | OPEN / UNKNOWN |
| FIN-P2-R003 | DATA | A test is accidentally pointed at production or persistent recovery data, changing real records. | CRITICAL / UNKNOWN | Use fresh local logical DB `P2-TRUST-LOCAL-DB-2026-10-03-V1`, new empty state and per-work-package local path; never use live binding `DB`, production data, E-002, or E-003. Add runtime preflight and evidence before any synthetic write. `EVD-TRUST-P2-02-PORTFOLIO` / `EVD-TRUST-P2-03-LEDGER` / `EVD-TRUST-P2-04-FORECAST`. | OPEN / UNKNOWN |
| FIN-P2-R004 | PORTFOLIO | Cash, units, average cost, realized P&L, or unrealized P&L is wrong because of partial-sale, rounding, currency, or replay behavior. | HIGH / UNKNOWN | Use fixed seed `P2-TRUST-SEED-V1` and independently compute each checkpoint; state zero-fee assumptions, compare reload/restore, and document rounding policy in `EVD-TRUST-P2-02-PORTFOLIO`. | OPEN / UNKNOWN |
| FIN-P2-R005 | PORTFOLIO | Duplicate/retried trade write or ordering race duplicates/loses a trade or changes balance. | CRITICAL / UNKNOWN | Test stable IDs, retry/idempotency, chronology and replay in the isolated fixture; reconcile counts and per-record hashes in `EVD-TRUST-P2-03-LEDGER`. | OPEN / UNKNOWN |
| FIN-P2-R006 | FORECAST | A saved forecast is overwritten or backfilled from a newer model/input/time, making history misleading. | HIGH / UNKNOWN | Freeze synthetic forecast `P2-TRUST-FORECAST-001`; retain before/after payloads/digests across newer fixture output and reload/restore. Any correction is a new record. `EVD-TRUST-P2-04-FORECAST`. | OPEN / UNKNOWN |
| FIN-P2-R007 | LEDGER | Missing, duplicated, unordered, or orphaned trade/forecast references prevent reconstructing what happened and why. | CRITICAL / UNKNOWN | Verify unique IDs, chronology, portfolio links, forecast links/null semantics, retry/replay and record counts in `EVD-TRUST-P2-03-LEDGER`. Document any unenforced relation. | OPEN / UNKNOWN |
| FIN-P2-R008 | SOURCE | Correct-looking price/company values are from the wrong ticker, market, currency, instrument, or stale period. | HIGH / UNKNOWN | Validate a Saudi and US sample against dated authoritative sources; retain URLs, publishers, publication/as-of dates, retrieval dates, raw fixture digests and discrepancies. `EVD-TRUST-P2-05-SA` / `EVD-TRUST-P2-05-US`; no recommendation text. | OPEN / UNKNOWN |
| FIN-P2-R009 | SOURCE | Missing, stale, failed, zero, or null data is coerced into a plausible default or treated as current. | HIGH / UNKNOWN | Use separate deterministic cases and report expected/actual behavior for each field/state in `EVD-TRUST-P2-06-FAILURE-MATRIX`. | OPEN / UNKNOWN |
| FIN-P2-R010 | SOURCE | Source data changes between replays, invalidating determinism comparisons or hiding data drift. | MEDIUM / UNKNOWN | Use frozen source snapshots and include source as-of/retrieval metadata, input hash and provider state. A live refresh is a different input. Cross-reference `EVD-TRUST-P2-05-SA`, `EVD-TRUST-P2-05-US`, `EVD-TRUST-P2-07-REPLAY`. | OPEN / UNKNOWN |
| FIN-P2-R011 | FORECAST | Clock, seed, model/config version, or broad canonicalization causes output drift or masks decision-bearing differences. | HIGH / UNKNOWN | Freeze time/seed/model/settings/raw inputs. Compare decision-bearing values and canonical digest; allowlist only documented volatile metadata in `EVD-TRUST-P2-07-REPLAY`. | OPEN / UNKNOWN |
| FIN-P2-R012 | PERFORMANCE | Environment omitted or cold/warm runs mixed; performance baseline is not reproducible. | MEDIUM / UNKNOWN | Record canonical build SHA, runtime, local test environment, workload fixture, repetitions, cold/warm conditions, raw samples, p50 and p95 only when supported; no thresholds/optimization. `EVD-TRUST-P2-08-PERFORMANCE`. | OPEN / UNKNOWN |
| FIN-P2-R013 | PERFORMANCE | Measurement expands into unapproved optimization or threshold setting. | MEDIUM / LOW | Keep P2-08 measurement-only; stop before code optimization or new threshold. Any change is a separate decision. `EVD-TRUST-P2-08-PERFORMANCE`. | OPEN / UNKNOWN |
| FIN-P2-R014 | GOVERNANCE / PHASE GATE | Historical deployment-independence Phase 2 is mixed with Trust Baseline, or Phase 3 begins early. | HIGH / LOW | Preserve the old roadmap as history; Trust requirements use IDs exactly `P2-01` through `P2-10`, evidence uses prefix `EVD-TRUST-`, and Phase 3 remains blocked until human-reviewed closure. | OPEN / UNKNOWN |
| FIN-P2-R015 | GOVERNANCE / EVIDENCE | An unrun or blocked step is represented as PASS without evidence/limits/review. | HIGH / MEDIUM | Each record includes baseline SHA, local environment, procedure, expected/actual, result, limits, artifact digest, reviewer/time. Keep PARTIAL/BLOCKED/UNKNOWN/NOT_RUN distinct from PASS; P2-10 requires links for all ten requirements. | OPEN / UNKNOWN |

## Current blockers and safe next action

1. Baseline is frozen at `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241`; root will archive the documents in PR3 before any application tests.
2. Ask Aziz what D2 refers to and which authoritative record/identifier defines it; until resolved, P2-01 remains PARTIAL.
3. The Sites overview verified project ID and binding `DB` but not provider DB name/UUID. Obtain this through an authoritative read-only provider/source or document the exact access limit; do not assume historical D1 identity is freshly verified.
4. After root GO, use the canonical baseline app and fresh, separate local synthetic states only. No production mutation or live trading is in scope.

## Evidence cross-reference

- P2-01: `EVD-TRUST-P2-01-IDENTITY`
- P2-02: `EVD-TRUST-P2-02-PORTFOLIO`
- P2-03: `EVD-TRUST-P2-03-LEDGER`
- P2-04: `EVD-TRUST-P2-04-FORECAST`
- P2-05: `EVD-TRUST-P2-05-SA` and `EVD-TRUST-P2-05-US`
- P2-06: `EVD-TRUST-P2-06-FAILURE-MATRIX`
- P2-07: `EVD-TRUST-P2-07-REPLAY`
- P2-08: `EVD-TRUST-P2-08-PERFORMANCE`
- P2-09: `EVD-TRUST-P2-09-RISKS`
- P2-10: `EVD-TRUST-P2-10-REVIEW`
