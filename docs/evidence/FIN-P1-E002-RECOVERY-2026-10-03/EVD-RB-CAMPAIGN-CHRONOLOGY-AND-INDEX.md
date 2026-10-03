# E-002 evidence recovery: campaign chronology and index

Campaign: `E002-EVIDENCE-RECOVERY-2026-10-03`  
Repository: [azizaljery/mizan-equit](https://github.com/azizaljery/mizan-equit)  
Evidence branch: `evidence/e002-recovery-20261003`  
Pull request: [#2](https://github.com/azizaljery/mizan-equit/pull/2)  
Scope: one isolated source-level v52 → v51 → v52 retest.

## Campaign chronology

| Time (UTC) | Confirmed milestone | Evidence |
|---|---|---|
| 2026-10-03 20:21:02 | Saved Site version metadata for v51 and v52 read; provider archive SHA metadata captured | [EVD-RB-001-source-version-identity.json](EVD-RB-001-source-version-identity.json) |
| 2026-10-03 20:22:58 | Local source identity and source-diff record generated | [EVD-RB-001-source-version-identity.json](EVD-RB-001-source-version-identity.json) |
| 2026-10-03 20:28:08–20:28:25 | Locked install and builds passed for exact v51 and v52 source SHAs; 34 server-referenced client assets each | [EVD-RB-001-build-results.json](EVD-RB-001-build-results.json) |
| 2026-10-03 20:36:22 | Successful fresh synthetic local D1 migration-apply log last-write time; exact apply start time was not emitted | [EVD-RB-003-migration-schema-results.json](EVD-RB-003-migration-schema-results.json) |
| 2026-10-03 20:41:56 | Migration/schema result recorded: 16 migrations applied, 0 pending, 42 app tables | [EVD-RB-003-migration-schema-results.json](EVD-RB-003-migration-schema-results.json) |
| 2026-10-03 20:43:19 | Synthetic fixture definition recorded; fixture insertion and its baseline snapshot completed before the first v52 stage, but exact seed time was not emitted | [EVD-RB-004-fixture-definition.json](EVD-RB-004-fixture-definition.json) · [EVD-RB-004-data-integrity-compatibility-results.json](EVD-RB-004-data-integrity-compatibility-results.json) |
| 2026-10-03 21:18:39.591 | v52-before local HTTP matrix passed, 20/20 asserted GETs | [EVD-RB-002-http-matrix-summary.json](EVD-RB-002-http-matrix-summary.json) |
| 2026-10-03 21:19:55.154 | v51 rollback local HTTP matrix passed, 20/20 asserted GETs | [EVD-RB-002-http-matrix-summary.json](EVD-RB-002-http-matrix-summary.json) |
| 2026-10-03 21:20:58.974 | v52-return local HTTP matrix passed, 20/20 asserted GETs | [EVD-RB-002-http-matrix-summary.json](EVD-RB-002-http-matrix-summary.json) |
| 2026-10-03 21:23:05 | Synthetic fixture compatibility result recorded after all three stages; six table hashes and schema/data hashes stable | [EVD-RB-004-data-integrity-compatibility-results.json](EVD-RB-004-data-integrity-compatibility-results.json) |
| 2026-10-03 21:26:06 | D1 PRAGMA capability record: quick_check ok, FK check 0 rows, foreign_keys 1; D1 integrity_check returned SQLITE_AUTH; same isolated file read-only SQLite alternative returned ok | [EVD-RB-005-pragma-capability-results.json](EVD-RB-005-pragma-capability-results.json) |
| 2026-10-03 21:28:30 | Round-trip summary generated; disposition remains PASS_PENDING_HUMAN_REVIEW | [EVD-RB-006-roundtrip-sequence-results.json](EVD-RB-006-roundtrip-sequence-results.json) |
| 2026-10-03 21:31:45 | Repository archive verification recorded 62/62 manifest entries with exact content and Git blob identity matches | [repository-archive-verification.json](repository-archive-verification.json) |

The three HTTP matrices contain 60 asserted route GETs total. Readiness probe(s) are excluded from that matrix count; no overall network request count is claimed. Full per-route expected and actual statuses, source identities, and stage file hashes are in the EVD-RB-002 summary. Harness failures remain preserved as diagnostics.

## Evidence index

| Evidence ID | Main record | Outcome |
|---|---|---|
| EVD-RB-001 | [source/version identity](EVD-RB-001-source-version-identity.json) · [build results](EVD-RB-001-build-results.json) | Source metadata verified; both exact-source builds passed locally. Saved provider archives are represented by metadata hashes only and were not run. |
| EVD-RB-002 | [HTTP matrix summary](EVD-RB-002-http-matrix-summary.json) | 20/20 asserted GETs passed at each of three local stages. This is source-built Miniflare evidence, not provider-archive execution. |
| EVD-RB-003 | [migration/schema result](EVD-RB-003-migration-schema-results.json) · [migration source manifest](EVD-RB-003-migration-source-manifest.json) | Fresh synthetic local D1: 16 applied, zero pending, 42 application tables. |
| EVD-RB-004 | [data-integrity result](EVD-RB-004-data-integrity-compatibility-results.json) · [fixture definition](EVD-RB-004-fixture-definition.json) | Synthetic fixture/schema hashes stable across all three stages. The migration-created `legacy` row is not user or production data; the synthetic settings row demonstrates row preservation, not settings API semantics. |
| EVD-RB-005 | [PRAGMA capability result](EVD-RB-005-pragma-capability-results.json) | D1 `quick_check` and FK checks passed; D1 `integrity_check` was blocked by `SQLITE_AUTH`; a separate read-only SQLite check of the same isolated file returned `ok`. |
| EVD-RB-006 | [round-trip sequence summary](EVD-RB-006-roundtrip-sequence-results.json) | v52 → v51 → v52 sequence and unchanged synthetic data/schema recorded. Does not make the closure decision. |

All companion logs, scripts, configs, SQL, snapshots, and diagnostics are enumerated by the repository checksum manifest [`SHA256SUMS.txt`](SHA256SUMS.txt). The archive verification record reports 62/62 entries verified at commit `77dafe7c9cf77ef084969dbbb7592153b5f0ad56`; the canonical manifest and archive verification should be refreshed after these two records are archived.

## Limits and disposition

- The original three 2026-10-01 E-002 JSON artifacts were not recovered. These are newly generated 2026-10-03 records.
- Saved provider archives were not downloaded or executed; runtime coverage used built Worker bundles from the exact recorded source SHAs.
- The D1 synthetic fixture does not establish behavior on production data. EVD-RB-005 records the D1 `integrity_check` capability limit explicitly.
- No production Site/D1, Cloudflare, Cron, or external provider was changed or invoked.
- Historical E-002 status is preserved as `PASS_PENDING_HUMAN_REVIEW`. This index does not accept E-002, close E-004, or close Phase 1.
