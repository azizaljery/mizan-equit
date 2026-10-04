# Stock candidate evidence archive (2026-10-04)

This is a byte-preserving, read-only staging snapshot of selected evidence for the local forecast immutability candidates. It is evidence for review and reproduction, not a deployment package.

## Decision status

- Baseline upstream source: `18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241`; the baseline is unchanged. Supported application-flow immutability tests pass only within their tested scope.
- v1: **NOT_READY**. The v1 triggers can be bypassed by a hidden-rowid `INSERT OR REPLACE` case.
- v2: **NOT_READY / HOLD**. Standard Wrangler SQL export/import changes source hidden rowids while rowid ledgers keep old rowids. Rerunning migration 0016 adds current rowids but does not remove stale ledger entries, so ordinary append may fail.
- Both candidate patches are local proposals only: no PR merge, production migration, or deployment is represented here. Root’s separate v2.1 offline restore-ledger rebaseline prototype was still in progress and is intentionally excluded.
- v1 and v2 typecheck remain failures with 9 diagnostics matching baseline. Lint remains a failure: 635 errors; the v1 summary preserves candidate/baseline warning counts and all raw-log hashes.

## Build identity clarification

- v1’s build-only validation is a genuine local build for local review commit `77ece3721d9b99e58d51e6e8c53168d6847ecfff`, tree `564cb65e600bb4a706f08cb0fedad2882f71844f`. It is not a remote PR commit.
- v2’s local build commit is `7f03cb6fa23c2b50f1d2870782bf6f8741f744fa`. `819e2cc25305e3a529774b5bdf777d4803738b33` is the corresponding tree ID, not another commit; patch reconstruction and the local build produced the same tree. It is not a remote PR commit.

## Timing correction

`canonical-timing-correction/methodology-correction-addendum.json` is frozen with SHA-256 `ce2c6c365dc82360f962d1a3864afbc20ac7624cd1a3ddc26515302827f09c77`. Its six horizon rows mean five named session periods (5, 21, 63, 126, 252) plus a separate daily 1-session horizon. This is a correction of wording and measurement boundaries, not a requirements mismatch. The earlier measurement snapshot is preserved byte-for-byte as `p2-08-v2-measurement-superseded.json`; use the corrected canonical capture for interpretation.

## Layout and reproduction

- `v1/` contains the v1 patch, manifests, bounded path audit, sanitized TAP, typecheck/build/retry evidence and synthetic local D1 JSON/SQL/config/reproduction script.
- `v1-build/` contains the later real local build proof for the v1 patch plus its parity manifest and tracked-path list; it does not claim any remote commit.
- `v2/` contains the v2 patch, changed/source manifests, local regression/build evidence, sanitized TAP, local D1 probes, synthetic restore audit and the independent synthetic Wrangler SQL export.
- `canonical-timing-correction/` contains the corrected canonical timing method and output; it also retains the earlier measurement snapshot under an explicit superseded filename without changing its bytes.
- `references/18ba8f39-source-parity.ndjson` is the canonical baseline file/mode manifest (SHA-256 `5fdf6dd6273c7765252495f6f960f74ad82592e619f583a24bd4d5bec03923bb`). The full repository and package dependencies are intentionally not bundled. To recreate tests, start from the stated upstream baseline in an authorized checkout, apply the included candidate patch, and follow the preserved reproduction scripts/config as path templates. D1 inputs are synthetic and local; no `--remote` run is documented.

## Sanitization and integrity

Selected source artifact bytes were copied without editing. The archive excludes `.git`, dependencies, raw databases, raw npm test traces, credentials, and large raw lint logs. Sanitized test summaries remain; excluded raw artifact hashes and sizes are in `verification-summary.json`. D1 export data is synthetic only. No credentials/plaintext authentication values are included.

`MANIFEST.json` records SHA-256, size, and source path for each payload file; its own SHA is recorded in the separate index. The outer index also records the deterministic tarball hash.
