# Phase 2 Trust Baseline — Proposed Scope and Definition of Done

**Project:** MIZAN_FINANCIAL  
**Phase:** Phase 2 — Trust Baseline  
**Status:** OWNER-APPROVED SCOPE / BASELINE FROZEN / P2-01 PARTIAL; APPLICATION TESTS NOT STARTED  
**Scope source:** Aziz's explicit, owner-approved new 10-item Trust Baseline scope (2026-10-03)  
**Repository:** `azizaljery/mizan-equit`, application under `mizan-v45/`  
**Frozen Phase 2 baseline:** `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241` (PR2 merged to main; supplied and verified by root)  
**Production database identity:** Partial current metadata capture: Sites project `appgprj_6a9bd7353ed4819193fcd5363ed1d38f`, selected live binding `DB`; provider DB name/UUID not exposed by that read. Historical D1 identity is not a fresh identity assertion.  
**D2:** UNKNOWN; prior records do not define what D2 refers to; do not infer or alias it to D1/E-003.  

This plan supersedes the *future execution scope* of the older Phase 2 deployment-independence work package (historical P2-01 through P2-09). Preserve that older roadmap and its history as-is; do not combine its IDs, status, evidence, or acceptance criteria with this plan. The existing Phase 1 / E-002 evidence remains Phase 1 evidence and must not be relabeled as Phase 2 evidence.

The user approved the new Trust Baseline scope; Phase 1 is now closed and PR2 is merged. Root provided the exact frozen baseline SHA above and informed the user. The remaining P2-01 identity evidence is PARTIAL until the current provider DB identity and D2's authoritative independent identity/path are confirmed. This document records the approved plan and current state; it does not claim application tests or phase closure. Wait for root's GO before executing application tests; root will archive the new Phase 2 docs in PR3 first.

## Authority, safety, and exclusions

- Use only fresh, synthetic, isolated local test data for writes and portfolio trades. Do not reuse production data, the E-002 recovery state, or E-003 restore state. No real orders, production-record mutation, secrets, credential values, or irreversible production actions.
- Source/database identity capture is read-only. Record safe identifiers and environment names only; never include secret values or connection strings.
- Do not create AZIZ/Mizan Score/research/new-model/AI features or optimizations. Phase 3 intelligence begins only after Phase 2 is CLOSED through evidence and human review.
- Missing evidence, inaccessible targets, unavailable authoritative sources, and unrun checks are BLOCKED or NOT_RUN, never PASS.
- Do not invent performance thresholds, accounting conventions, source facts, or a D2 identity. Any unresolved assumption is stated in the evidence and risk records.
- Every work package gets its own new local synthetic database/worktree or otherwise demonstrably isolated local state; do not share a writable D1 across parallel packages.

## Requirements and acceptance criteria

| ID | Requirement / scope | Definition of Done | Planned evidence | Initial state |
|---|---|---|---|---|
| P2-01 | Freeze baseline commit, actual database identity, independently identified D2, and the Phase 2 DoD/evidence log | Baseline `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241` is frozen. Record canonical app source/runtime. Current Sites metadata confirms project ID and selected `DB` binding only; obtain provider-safe DB name/UUID/region from an authoritative read-only view. First clarify what D2 refers to and identify its authoritative definition, then capture it independently. Keep this requirement PARTIAL while D2 is undefined or the current DB provider identity remains incomplete. No DB writes. | EVD-TRUST-P2-01-IDENTITY | PARTIAL |
| P2-02 | Isolated synthetic paper-portfolio lifecycle: create, buy, add, partial sell, full sell, reload, restore | Run the fixed seed below in a fresh local synthetic database. Compare cash, units, average cost, realized P&L, and unrealized P&L at each checkpoint with independent manual arithmetic. For restore, create a consistent local synthetic DB backup after writes are quiesced, restore it into a separate fresh local store, and compare schema/rows/ledger IDs and arithmetic. Do not use an application restore endpoint. Do not use production, E-002, E-003, or live trade records. | EVD-TRUST-P2-02-PORTFOLIO | NOT_STARTED |
| P2-03 | Ledger integrity and traceability | Verify no loss or duplication across the synthetic lifecycle; stable unique IDs; chronology/order preserved; portfolio/trade/forecast references resolve or are explicitly null by contract; replay/reload produces the same ledger state. Include retry/duplicate-attempt and ordering cases. | EVD-TRUST-P2-03-LEDGER | NOT_STARTED |
| P2-04 | Forecast snapshot immutability | Save the fixed synthetic forecast snapshot and record its original values, symbol, currency, model/version, settings/version, anchor date, and creation time. After producing/loading a newer fixture output and after reload/restore, prove original fields/payload remain unchanged; a correction is a new record. | EVD-TRUST-P2-04-FORECAST | NOT_STARTED |
| P2-05 | Saudi and US market-data identity/period/source validation | For at least one Saudi and one US sample selected from the canonical baseline code/data surface, verify company name, ticker, exchange/market, currency, and period/date against dated authoritative published data. Save citations/URLs, publisher, publication/as-of date, retrieval date, raw fixture/response digest, and discrepancies. No unsupported equivalence, no investment advice. | EVD-TRUST-P2-05-SA; EVD-TRUST-P2-05-US | NOT_STARTED |
| P2-06 | Missing, stale, outage, zero, and null handling | With deterministic fixtures, cover each condition separately for required identity, price, currency, and period fields. Expect explicit unavailable/stale/error state or documented valid zero where appropriate; no silent defaults, stale-as-current substitution, fabrication, or null-to-plausible coercion. Record expected vs actual for every case. | EVD-TRUST-P2-06-FAILURE-MATRIX | NOT_STARTED |
| P2-07 | Deterministic outputs for identical input and version | Freeze identical input snapshots, baseline commit, model/version, settings, clock, and random seeds for repeat replays. Decision-bearing/numeric outputs must match. Define a narrow volatile-metadata allowlist; canonicalize only those fields and disclose them. Store canonical digest. | EVD-TRUST-P2-07-REPLAY | NOT_STARTED |
| P2-08 | Measure baseline performance, without optimization | Measure Saudi analysis, US analysis, portfolio update, and forecast save under a stated environment/runtime and representative fixed fixtures. Report sample count, cold/warm condition, p50, p95 when sample size supports it, maximum, and method. No latency threshold or optimization in this requirement. | EVD-TRUST-P2-08-PERFORMANCE | NOT_STARTED |
| P2-09 | Risk register | Maintain the linked register for DATA, PORTFOLIO, FORECAST, LEDGER, SOURCE, and PERFORMANCE risks. Record condition, consequence, likelihood/severity rationale, mitigation/evidence, residual risk, owner, state. No open CRITICAL risk at closure. | EVD-TRUST-P2-09-RISKS | NOT_STARTED |
| P2-10 | Human review and phase closure | Human reviewer verifies all 10 requirements linked to evidence and PASS; accounting matches independent arithmetic; no open CRITICAL risk; traceability and limitations complete. Record reviewer/date/evidence/decision. Only then set Phase 2 CLOSED. | EVD-TRUST-P2-10-REVIEW | NOT_STARTED |

### Synthetic accounting fixture proposal for P2-02

Use fresh local logical database `P2-TRUST-LOCAL-DB-2026-10-03-V1`, created from an empty state in a unique temporary local path for each work package. Do not point it at live binding `DB`; do not reuse E-002/E-003 state. Stable seed source ID `P2-TRUST-SEED-V1`, planned canonical fixture path `mizan-v45/tests/fixtures/phase2-trust-seed-v1.json`, SHA-256 of the seed object's sorted-key compact JSON `ffe716976c5582eff379c989d11eaf731da538d328b9c6f5963f105a01f3be6d`. Stable IDs: portfolio `P2-TRUST-PORTFOLIO-001`; trades `P2-TRUST-TRADE-001` through `004` in sequence; forecast snapshot `P2-TRUST-FORECAST-001`; instrument `SYNTH-SAR-001`. Seed: opening SAR 10,000; zero fees; buy 10 @100 at 00:00:01Z; buy 5 @120 at 00:00:02Z; sell 4 @130 at 00:00:03Z; mark SAR 110 at 00:00:05Z; sell remaining 11 @110 at 00:00:06Z. Proposed arithmetic: after the two buys, average cost = SAR 106.666666…; after partial sale remaining units = 11, realized P&L = SAR 93.333333…, cash = SAR 8,920; at the SAR 110 mark unrealized P&L = SAR 36.666666…; after final sale, units = 0, cash = SAR 10,130, cumulative realized P&L = SAR 130, unrealized P&L = 0. The same seed carries a synthetic forecast `low=100, point=110, high=120`, model/settings version `SYNTHETIC-1`, anchor date `2026-10-03`. Fixture is specified but not instantiated or executed. Any rounding policy must be recorded before comparison; round for display only, not in independent arithmetic.

## Gate and status policy

The phase is CLOSED only when all 10 requirements are PASS, their evidence is linked and reviewed, P2-10 is signed by the human reviewer, and the P2-09 register has no open CRITICAL risk. A numeric progress percentage cannot close the phase. Phase 3 remains blocked until that exact state is recorded.

## Parallel work packages after P2-01 baseline freeze

The canonical baseline SHA is frozen. P2-01 remains PARTIAL only for current provider DB-name/UUID metadata and the undefined independent D2 target; that gap must not block independent synthetic local work under P2-02 through P2-08. After root GO, verify each package's fresh local synthetic target independently. All writes stay synthetic and isolated; D2 work remains read-only and separate.

1. **Portfolio arithmetic + ledger (P2-02/P2-03):** create a new local synthetic DB/worktree; use the frozen seed; independently calculate each checkpoint; after writes are quiesced, create a consistent local DB backup and restore it into another newly created local store using the supported DB-level backup/restore method (not an app restore endpoint); compare schema, rows, IDs, hashes, and balances. Emit `EVD-TRUST-P2-02-PORTFOLIO` and `EVD-TRUST-P2-03-LEDGER`.
2. **Forecast immutability + deterministic replay (P2-04/P2-07):** separate local synthetic DB/worktree; preserve before snapshot and compare after replay; emit `EVD-TRUST-P2-04-FORECAST` and `EVD-TRUST-P2-07-REPLAY`.
3. **Market-data identity + failure states (P2-05/P2-06):** use frozen source snapshots/fixtures, not a shared writable DB; emit `EVD-TRUST-P2-05-SA`, `EVD-TRUST-P2-05-US`, and `EVD-TRUST-P2-06-FAILURE-MATRIX`.
4. **Performance baseline (P2-08):** use a dedicated local synthetic state on the canonical baseline app; document environment/raw measurements; do not optimize; emit `EVD-TRUST-P2-08-PERFORMANCE`.
5. **Risk/governance review (P2-09/P2-10):** maintain the risk register while evidence is produced, then assemble the human-review packet after substantive evidence; emit `EVD-TRUST-P2-09-RISKS` and `EVD-TRUST-P2-10-REVIEW`.

## Repo/context references examined

- `docs/MIZAN-FINANCIAL-RECOVERY-STABILIZATION.md` and `docs/PHASE-1-CLOSURE-CHECKLIST.md` describe the historical Phase 2 as deployment independence. That older roadmap is historical context only for this scope.
- Read-only Sites database overview for project `appgprj_6a9bd7353ed4819193fcd5363ed1d38f` returned selected binding `DB` and table names only; it did not expose the provider database name/UUID. This does not complete P2-01 identity capture.
- `docs/evidence/FIN-P1-E003-PRODUCTION-RESTORE-2026-09-30/isolated-db-identity.json` records temporary restore target `mizan-equity-e003-36779960771` (UUID `679bd26c-c70a-4d1d-89dc-487a61bfeb2d`, region EEUR), deleted after validation. It is neither current DB identity nor evidence of D2.
- `docs/phase1/e003-production-restore-validation.md` identifies the then-observed production D1 as `mizan-equity-db`, UUID `e95b74e8-81d6-4beb-8ea2-ad59c863d21d`. This is historical Phase 1 evidence, not a substitute for fresh P2-01 identity capture.
- Prior records do not define what D2 refers to. They identify production D1 as `mizan-equity-db` (`e95b74e8-81d6-4beb-8ea2-ad59c863d21d`) and the distinct, deleted E-003 restore target as `mizan-equity-e003-36779960771` (`679bd26c-c70a-4d1d-89dc-487a61bfeb2d`, EEUR). Neither establishes D2. Keep D2 UNKNOWN and ask what it denotes and which authoritative source/identifier defines it.
- Canonical Phase 2 source is commit `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241`, not the older local Sites snapshot commit `93808ca6b93188581adda966a3caf019d741898c`. When testing is authorized, use a fresh checkout of canonical `mizan-v45/` at the frozen commit, not a Site source tree/commit.

### Open owner question for P2-01

What does D2 refer to in the new Phase 2 scope, and what authoritative source or identifier should we use to verify it independently? Please distinguish it from production D1 and the deleted E-003 restore target; no credentials or secrets are needed.
