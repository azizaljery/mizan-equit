# Phase 1 Evidence Reconciliation — 2026-10-03

This record reconciles the durable Oct 3 E-002 evidence with the previously accepted E-001, E-003, P1-05, and P1-08 evidence. It records the human approval separately in [E-004](e004-human-review-signoff.md). No production action was performed by the E-002 campaign.

## E-001 — source and deployment identity

The existing Sites metadata links v52 source `93808ca6b93188581adda966a3caf019d741898c` to successful deployment `appgdep_6abbb00642b4819197824191355626ab`. This remains `PASS` as previously accepted. Direct HTTP access to `/mizan-deployment.json` was blocked in the cloud browser; this record does not claim a live HTTP response. See [the original E-001 reconciliation](evidence-reconciliation-2026-09-30.md).

## E-002 — isolated source-built rollback rehearsal

The new records are archived under [`docs/evidence/FIN-P1-E002-RECOVERY-2026-10-03/`](../evidence/FIN-P1-E002-RECOVERY-2026-10-03/EVD-RB-CAMPAIGN-CHRONOLOGY-AND-INDEX.md) and map to EVD-RB-001 through EVD-RB-006.

- **EVD-RB-001:** provider metadata identifies v51 source `65b623639588f40eb73c5d76616308737ab33f33` and v52 source `93808ca6b93188581adda966a3caf019d741898c`. Locked installs and exact-source local builds passed for both; 34 referenced client assets were verified in each build. Provider archive hashes are metadata; archive bytes were not executed.
- **EVD-RB-002:** local Miniflare Worker matrices passed 20 asserted GETs at each stage: v52, v51, v52. This is 60 asserted GETs total (14×200, 4×401, 2×403 per stage); readiness probes are excluded. Runtime identity matched the pinned source SHA at each stage.
- **EVD-RB-003:** all 16 source migrations applied to a fresh synthetic local D1; no migrations remained pending; 42 application tables were inventoried. Migration SQL was byte-identical between the pinned sources.
- **EVD-RB-004:** the same persisted synthetic D1 was preserved across all three stages. Schema hash and six synthetic domain-table row counts/hashes remained stable. The migration-created `legacy` portfolio placeholder is not user or production data; the settings fixture demonstrates row preservation only, not settings API semantics.
- **EVD-RB-005:** D1 `quick_check=ok`, `foreign_key_check` returned zero violations, and `foreign_keys=1`. D1 `integrity_check` returned `SQLITE_AUTH`. A separate read-only SQLite check on the same local file returned `ok`; this is not relabeled as a D1 API pass.
- **EVD-RB-006:** summarizes the passing source-built v52 → v51 → v52 sequence and stable synthetic schema/data state.

At current PR #2 head `a51050c6da0ae5c95dd48d141565bbb04906b57e`, the repository owner verified all 65 SHA-256 manifest entries against their remote content and GitHub blob identities with zero mismatches. The older `repository-archive-verification.json` records a 62-entry checkpoint at commit `77dafe7c9cf77ef084969dbbb7592153b5f0ad56`; it is a prior snapshot, not the current count.

The original Oct 1 raw evidence was not recovered; Oct 3 is a newly generated evidence set. The isolated campaign used locally built Worker bundles from the exact pinned SHAs, not the provider-saved archives or Sites control plane. No production Site, Cloudflare, D1, Cron, or deployment was touched. The user expressly accepted this source-built isolated rehearsal as an equivalent within Phase 1, with these limits carried into E-004.

## E-003 — production restore

Com workflow run `36779960771`, commit `e36cf43012cb9c4e722b341cf2e3ecd08c0d723f`, completed the isolated restore and documented checks without production mutation. The critical-table sample contained one paper portfolio, 732 forecast records, and 12 forecast outcomes; four of seven compared tables were empty. The user had previously accepted the documented sample and empty-table limits, and the current E-004 carries them forward. The restore proves restoration of the observed snapshot, not business behavior for absent rows, a retention policy, or guaranteed future RPO/RTO.

## P1-05 — source parity

The prior read-only source comparison reported 697 tracked files on each side, 692 identical, and five differing blobs, all classified as generated release-identity/build-verification material or focused verification tests. It reported no unexplained application, UI, data, schema, deployment-configuration, or documentation delta. P1-05 is `VERIFIED`; no separate live HTTP check is added to its DoD.

## P1-08 — legacy preservation

Canonical `docs/evidence/legacy-migrations.json` records six populated synthetic tables with row counts and hashes stable before migration, after migration, and after read-only reopen. `docs/evidence/legacy-tests.tap` records seven passing focused tests across portfolio, forecast, and admin history preservation. `mizan-v45/tests/calculations.test.mjs` lines 789–812 verifies malformed historical admin audit rows and credential hashes remain unchanged through synthetic admin login/load/save. E-003 supplements this with the observed production restore sample. Together these cover the approved portfolio, forecast, and administration criterion without fabricating production rows. P1-08 is `VERIFIED_WITH_DOCUMENTED_LIMITS`.

## Reconciled status

E1 `PASS`; E2 `PASS`; E3 `PASS`; E4 `PASS`; Phase 1 `CLOSED`; decision `APPROVED_WITH_DOCUMENTED_LIMITATIONS`, per the user-authored approval at `2026-10-03T22:01:25Z`, message `Sentinel_0df0ca8a9d0081918f06181b42d7488c`. The approval record and preserved limits are in [E-004](e004-human-review-signoff.md). D2 remains an independent path.
