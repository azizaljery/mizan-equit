# D2 Discovery

**Status:** DISCOVERY  
**Decision:** DESIGN/DOCUMENTATION APPROVED; D2 implementation, provisioning and data transfer NOT APPROVED  
**Conceptual role:** Historical/analytical complement, ACCEPTED_IN_PRINCIPLE
**Selected provider/implementation:** UNKNOWN / NOT_STARTED  
**Goal:** Understand why D2 is needed, what problem it would solve, and what—if anything—belongs there  
**Phase:** Phase 2 — Trust  
**Decision reference:** Owner message `Sentinel_69aaeee0fbf881918a5b3a3a06dc50a3`, 2026-10-03 23:16:54 UTC  
**Documentation approval:** Owner message `Sentinel_044d17e6fc408191b486b16e4be652d1`, 2026-10-03 23:36:12 UTC (“اعتمد ذلك”)  

## Current disposition

- **D1 is ACTIVE:** it remains Mizan's current operational Source of Truth and the site's permanent memory.
- **D2 is a new initiative under discovery:** it is not an approved replacement for D1 and is not a selected database, provider, service, or physical resource.
- The idea of a complementary analytical/historical path is being explored; **implementation/provisioning is NOT APPROVED**. This is not a blanket rejection of the D2 concept.
- The owner has now adopted this discovery/architecture documentation. That approval covers documenting the proposed concept only; D2 creation and data transfer remain subject to the explicit implementation gates below.
- **No D1-to-D2 migration or production D2 implementation is approved now.** Do not create a database, choose a provider, copy production data, change app bindings, deploy a migration, or change D1 based on this discovery record.
- **Trust work comes first.** D2 architecture or implementation decisions are deferred until the Trust work has adequate evidence and the owner reviews a concrete proposal.
- P2-01 records this approved discovery disposition. Future D2 provider selection, detailed design and implementation are not additional prerequisites for completing the current Trust validation; their separate implementation gates remain closed.

The owner's current message says: “اعتمد الان خطة دي ١ ودي٢ واضف كل ماهنا لدييك”. The decision recorded here is to preserve D1 as active Source of Truth and capture the D2 initiative as discovery, not to approve D2 implementation, provisioning or a D1 replacement. The user supplied a separate plaintext project note with D2 alternatives; that note is preserved unchanged in the owner's Library.

## D1 baseline

Current owner-controlled provider UI metadata identifies D1 as Cloudflare D1 `mizan-equity-db`, UUID `e95b74e8-81d6-4beb-8ea2-ad59c863d21d`, region EEUR, displayed size 86.63 MB and 42 tables. This current observation matches the earlier documented D1 identity. The live Sites binding is separately named `DB`; a fresh direct binding-to-UUID correlation was not captured. Safe metadata only is recorded in [EVD-TRUST-P2-01-CURRENT-D1-IDENTITY.json](../evidence/PHASE-2-TRUST-2026-10-03/identity/EVD-TRUST-P2-01-CURRENT-D1-IDENTITY.json).

D1 remains authoritative for live operational state, including current portfolios, cash, positions, trades, settings, administrative controls, active forecasts and active site state. No D1 rows were changed for this discovery.

## Candidate D2 roles from the supplied note

These are hypotheses to evaluate, not selected scope or approved data destinations:

1. **Long-term archive:** older forecasts, mature evaluations, source snapshots and research records.
2. **Analytics/history store:** long-range forecast history and evaluation, backtests, performance measurements and model/research datasets.
3. **Future intelligence data:** if separately approved in Phase 3/4, datasets and results for AZIZ, Mizan Score, a Research Engine or model features.

The conceptual complementary historical/analytical role is accepted in principle; concrete provider and implementation decisions remain unselected. The supplied note contains an ADR marked `ACCEPTED_IN_PRINCIPLE`, but it also explicitly says implementation is `NOT_STARTED`, provider is `NOT_SELECTED`, the effective phase is discovery/baseline only, and `Implementation Authorization` is `NOT_GRANTED`. The current owner disposition preserves the complementary-D2 concept for discovery while withholding implementation/provisioning approval. The source's capacity rationale and provider-specific limits are unverified here and must not be used as a decision basis without fresh authoritative validation.

## Candidate architecture preserved from the source (not approved)

The source proposes the following possible separation: D1 continues to own live operational state; D2 could hold longer-lived source snapshots, research datasets, forecast history and evaluations, backtests, and future model/AZIZ/Mizan Score artifacts if separately approved. It recommends not starting with portfolios or trades. These are options for discovery, not finalized D2 data classes.

An illustrative transfer path in the source is D1 record → export contract → transfer batch → source hash → D2 write → read-back → destination hash → verified receipt or quarantine. It proposes provenance such as source system/table/record ID/version, source timestamps, export time, batch/schema version, content hash, provenance, and classification; reconciliation compares counts and hashes and records failures. The preferred conceptual safety pattern is COPY → VERIFY → RETAIN → REVIEW → optional archive, rather than MOVE → DELETE. None of this authorizes a transfer now.

The plaintext includes a draft ten-table SQL schema: `source_snapshots`, `source_files`, `forecasts_history`, `forecast_evaluations`, `backtest_runs`, `backtest_results`, `research_datasets`, `model_evaluations`, `transfer_batches`, and `transfer_receipts`. Its staged activation suggestion starts with only five tables (`source_snapshots`, `source_files`, `forecasts_history`, `forecast_evaluations`, `transfer_batches`) and defers backtest/research tables until those paths open. The owner note's final proposed artifacts have been extracted locally under `docs/architecture/` as `ADR-P2-001-D2-DATA-PLATFORM.md`, `D2-DATAFLOW.mmd`, `D2-DATAFLOW-DETAILED.mmd`, and `D2-SCHEMA-V1.sql`. They remain documentation-only proposals: no table, schema, migration, provider, or D2 platform has been approved or created, and none has been placed in runtime migration directories.

### Open design concerns before any later implementation decision

- Provider/technology and actual storage identity are not selected.
- Hash algorithm, canonical serialization/canonicalization, and transfer identity semantics are not specified.
- The schema is a broad draft; it lacks an approved data-classification enforcement model and detailed constraints/index/retention policy.
- Access control, encryption, backup/restore, retention/deletion, cost, failure/retry behavior, ownership, RPO/RTO, and production read/write needs remain open.
- Any first dataset, transfer cadence, and reconciliation contract require an owner-reviewed proposal and human approval.

No schema validation or database migration was run for these proposal artifacts.

## Discovery questions

- What concrete problem should D2 solve that D1 cannot adequately solve?
- Which exact data classes, if any, would be copied to D2, and why?
- Which records and workflows must remain exclusively authoritative in D1?
- Why not keep the proposed data in D1, at least until a measured need exists?
- What trigger, volume, retention period, query pattern or cost constraint would justify a second system?
- Is the eventual need relational SQL, object/file storage, both, or something else?
- Who would own its schema, access policy, backups, retention, deletion, retry/failure behavior and ongoing cost?
- Would D2 be read-only for analysis, or would any result be proposed back to D1 through a separately approved review/promotion gate?

## Guardrails while in discovery

- Do not move or delete D1 records. Any future transfer must be explicitly approved and start as copy, then verify counts, content hashes, schema/version and provenance, retain D1, and review exceptions before any optional archival action.
- No D2 write may modify D1 directly. Any later D2 result considered for an operational D1 decision requires a separate, documented contract and approval gate.
- Do not move credentials, session tokens, API keys, secrets, `.env` values or unclassified sensitive data.
- Do not claim data is “migrated” until an approved transfer is reconciled; no transfer is in scope now.
- No provider, product, database UUID, deployment binding, retention rule, RPO/RTO, access model, cost model or production schema is selected by this document.

## Decision gates before any D2 implementation proposal

A later proposal must define and obtain human approval for: the problem and measured need; D1/D2 ownership boundaries; first dataset and classification; provider/technology; schema and lineage; copy/reconciliation and idempotent retry; access/security; retention/deletion; backup/restore and failure recovery; cost; and any promotion of analysis into operations. Approval of discovery does not approve these implementation steps.

## Source record

Owner-supplied plaintext file `Pasted text(1).txt`, created 2026-10-03 23:16:51 UTC, 29,404 bytes, 1,353 lines; the full file was reviewed. It remains unchanged in the owner's Library. This discovery note summarizes its candidate roles while preserving its proposals as unapproved source material.

## Preserved full owner source

[Original 1,353-line package](source/D2-owner-package-2026-10-03.txt), 29,404 UTF-8 bytes, SHA-256 `304698c744e3cbae575c9b14b87a1f2f7f011eca71f0be0d4eea2c83a47943a7`. Preserved unchanged; earlier draft ADR/SQL variants remain historical source, while the final extracted proposals are separately labeled.
