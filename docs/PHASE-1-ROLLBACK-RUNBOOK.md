# Phase 1 Rollback Runbook

Project: MIZAN_FINANCIAL
Status: DRAFT — IN_PROGRESS; human review PENDING
Scope: equity application only. No engineering resources.

## Known references
- Site project: appgprj_6a9bd7353ed4819193fcd5363ed1d38f
- Current recorded release: 51
- Saved version: appgprj_6a9bd7353ed4819193fcd5363ed1d38f~appgver_92ee4c220a748191801077c74c5adad1
- Source: 65b623639588f40eb73c5d76616308737ab33f33
- Deployment: appgdep_6abac9f3b5b48191a3fb1defaa6b252d
- URL: https://mizan-equity.aljeryabod.chatgpt.site

Release 51 is a candidate future rollback baseline, not a fully accepted known-good release: build/tests, saved archive digest, and owner-reported legacy compatibility are verified. Live runtime identity and runtime rollback rehearsal remain incomplete. Release 50 is unsuitable as an automatic fallback because it had the known legacy-settings regression. Release 49 has not been accepted as a safe runtime fallback.

## Application rollback procedure
1. Record incident, current live deployment/version/source, timestamp and operator. Confirm project ID and preserve current audience and bindings.
2. Identify the actual deployment writers and scheduled jobs; prevent concurrent deployment changes through their supported controls. Their complete inventory remains a prerequisite, not an assumed capability.
3. Select an existing saved version with verified source/archive identity and acceptance evidence. Record target version and why its runtime supports the current database schema. STOP if no qualifying version exists; currently this gate is OPEN.
4. Preserve the current saved version as the recovery reference. Capture a consistent database recovery point through the actual database provider before any operation with possible data effects. Never print secrets.
5. Redeploy the selected saved version using Sites' supported deploy-version operation for the existing project and audience. Do not create a new Site, use a different repository, or run schema down-migrations.
6. Poll that deployment to a terminal successful state. A successful deployment alone is not acceptance.
7. Verify runtime build identity, page loading, legacy settings read, authorized portfolio/trade/history reads, and before/after data invariants. Use read-only acceptance; do not create production trades or regenerate old forecasts.
8. Record checks and failures. If acceptance fails, restore the captured pre-change saved application version only if its database compatibility is established. Otherwise stop automated recovery and retain the data for diagnosis.
9. Resume deployment activity only after documented acceptance. Record operator, elapsed time, evidence and human decision.

## Database recovery is a separate operation
Code rollback does not authorize overwriting newer database records. Do not restore an old backup over production as a test.
Required evidence before declaring database rollback safe:
- Actual provider/database identity and bindings.
- Backup/recovery-point identifier, timestamp, retention and scope.
- Restore into an isolated database; integrity checks and reconciliation of settings, portfolios, trades, cash and forecast history.
- Explicit treatment of writes after the backup, credentials/session data, scheduled writers and immutable forecast records.
- Application acceptance against the restored isolated database and documented cutover/reversal procedure.
These production-specific items have not been verified. RPO/RTO have not been measured.

## Verification performed
[Migration preservation result](evidence/legacy-migrations.json) and [reproducible script](evidence/verify-legacy-migrations.py):
four appended migrations preserve six seeded legacy table snapshots and survive file close/reopen. Earlier migration SQL is unchanged between the two recorded source commits.
This is NOT an application rollback rehearsal or a production backup restoration. The old runtime was not executed. No production deployment or database was changed.
[Focused regression output](evidence/legacy-tests.tap): 7 local tests passed, 0 failed.

## Open closure gates
- Accepted runtime rollback target; saved archive digest is verified (see FIN-P1-INDEPENDENT-ARCHIVE-VERIFICATION.json).
- Actual application rollback rehearsal.
- Isolated production-backup restore and reconciliation.
- Human review.
No rollback readiness PASS is asserted.

## Delegated investigation update — 2026-09-29

[Technical investigation](evidence/TECHNICAL-INVESTIGATION-2026-09-29.md). Archive extraction is verified; local Worker rehearsal could not start due host network-interface failure. Local synthetic database backup/restore passed structural, row-hash and immutability checks, but no production recovery point was restored. Same-database historical checkpoints, CSV exports and settings restore do not constitute complete disaster recovery. Owner acceptance of legacy UI persistence is recorded separately; final phase sign-off remains pending.
