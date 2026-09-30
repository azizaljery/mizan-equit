# E-003 — Production Restore Validation

**Technical result: `PASS_PENDING_HUMAN_REVIEW`.** A real production D1 export was restored to a separate isolated D1 and passed the database, critical-record and application checks below. The run is evidence of this tested recovery point; it is not a claim of a provider-retained backup or a guaranteed future RPO/RTO. E-004 human review and final Phase 1 closure remain pending.

## Verified run

- GitHub Actions run: [36779960771](https://github.com/azizaljery/Com/actions/runs/36779960771), branch `phase1/e003-production-restore`, commit `e36cf43012cb9c4e722b341cf2e3ecd08c0d723f`, completed successfully at 2026-09-30T21:34:46Z.
- Source: Cloudflare D1 `mizan-equity-db`, UUID `e95b74e8-81d6-4beb-8ea2-ad59c863d21d`, 42 tables; source identity captured at 2026-09-30T21:32:31Z.
- Recovery-point reference: the per-run production export in Actions run `36779960771`; exported 2026-09-30T21:32:54Z–21:33:07Z; SHA-256 `d1a75c8877647658b66e7e4f608b828f2b446567fd2e3f3e7b526bc69dd41393`; 68,809,956 bytes. The provider did not supply a prior-backup ID or retention period; this is a one-run live export, not a retained backup service.
- Target: isolated D1 `mizan-equity-e003-36779960771`, UUID `679bd26c-c70a-4d1d-89dc-487a61bfeb2d`, region EEUR. Its UUID differs from the production UUID. The target was deleted at 2026-09-30T21:34:41Z after validation.
- Isolation: the application ran under local Workerd at `127.0.0.1:8787`, bound to the isolated remote D1 only; the build identity was commit `e36cf43012cb9c4e722b341cf2e3ecd08c0d723f`. Cron was disabled; no public Worker was deployed.
- Export normalization: 2,757 source statements became 5,271 staged statements; 144 oversized rows were staged into 2,512 pieces; largest emitted statement 82,166 bytes; zero unsupported oversized statements.
- Restore: Cloudflare D1 Import API reported `complete`; 5,271 queries, 42 tables, 11,517 rows written; operation ran 21:33:28Z–21:33:46Z.
- Integrity: `PRAGMA quick_check` returned `ok`; `PRAGMA foreign_key_check` returned no violations; `PRAGMA foreign_keys` was `1`.
- Schema: canonical production and restored schema SHA-256 both `9131fd3a8f5e22f77945bf9893ae8c77da68a7f66b8e37ae9d3132332942eb92`.
- Critical records: counts and canonical hashes matched for `site_settings`, `settings_history`, `paper_portfolios`, `paper_cash_entries`, `paper_trades`, `forecast_records` and `forecast_outcomes` (42 total tables were restored; these seven were the comparison set). Counts were 0, 0, 1, 0, 0, 732 and 12, respectively.
- Application smoke: `/`, `/mizan-deployment.json`, `/api/site-settings`, US `AAPL` search and Saudi search all returned HTTP 200.
- No silent mutation: critical counts/hashes after smoke matched the restored database. Source interactions in the workflow were identity/read queries and export; restore/import, runtime binding and cleanup targeted the isolated D1. Raw export was not stored in Git or uploaded.
- Evidence files: [`sanitized run evidence`](../evidence/FIN-P1-E003-PRODUCTION-RESTORE-2026-09-30/E-003-SUMMARY.md) (full bundle in the adjacent directory); original artifact ID `11127004356`, SHA-256 `c3fa64bbf802d378c93199e27dfd5f73b80c3ece0c5865bd64d3b21a6db4bdcd`.

## Measured interval and limitations for review

- The export began at 21:32:54Z; the five smoke checks were complete before post-smoke fingerprint verification began at 21:34:19Z. This bounds the tested export-to-smoke interval at about 85 seconds. It is an observed test interval, not a service RTO commitment.
- The export recovery-point window is 21:32:54Z–21:33:07Z. No outage/failure timestamp, prior-backup age, provider backup ID or retention policy was recorded, so a numeric RPO and long-term retention claim cannot be made from this run.
- A human reviewer must decide whether this one-run production export is an acceptable recovery point for E-003 and whether the stated RPO/retention limitation is acceptable. If not, E-003 remains pending the specific additional evidence requested by that reviewer.

## Gate disposition

`E-003 = PASS_PENDING_HUMAN_REVIEW` for the technical restore tests above. This is not E-004 approval and does not close Phase 1. The reviewer’s explicit decision, date, authority and evidence references belong in [`e004-human-review-signoff.md`](e004-human-review-signoff.md).
