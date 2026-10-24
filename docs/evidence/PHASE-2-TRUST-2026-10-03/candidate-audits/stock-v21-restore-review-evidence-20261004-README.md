# v2.1 local restore-rebaseline review evidence

**Status:** local atomic repair mechanics demonstrated on synthetic D1. Rollout remains **NOT_READY / HOLD**. This archive preserves test evidence; it is not an approved operational runbook, a production maintenance gate, or authorization to merge, deploy, or run a restore.

## What the evidence shows

- Wrangler export/import changed source hidden rowids from `[-5, -1, 1, 2]` to `[1, 2, 3, 4]` while rowid-history values stayed stale.
- A test-only loopback Worker used one D1 batch to rebuild only the two rowid ledgers. An injected failure rolled back rows, ledgers, and all 14 triggers; the successful local run restored rowid/ledger parity and preserved protected logical-row hashes. Six `rowid`, `_rowid_`, and `oid` REPLACE probes were rejected.
- Synthetic `recordAnalysis`, two evaluation revisions, and daily archive flows succeeded after rebaseline. The screener plan-insert path ran without network calls, but its synthetic projection was neutral/low-confidence; no eligible screener forecast was appended.

## Why rollout remains held

- The offline and resume gate exists only in the temporary Worker harness. Actual application and scheduled writers were not quiesced. Resume does not enforce the required pre/post logical-hash comparison. Durable owner-run quiescence plus explicit hash and integrity checks remain unimplemented.
- Eligible screener forecast append and archive sealing remain unverified.
- The work used local synthetic Wrangler 4.92.0 D1, with no remote flag, production data, or production access.

## Contents

- `INDEPENDENT-REVIEW.md` is included byte-for-byte; SHA-256 `8bcb4c6f39cffa79e82d1d762aac180a285ebe16face2d78091107755fcee1dd`. It confirms the bounded repair mechanics while retaining the rollout hold.
- `review-packet-v2.1.json` and `README.md` are preserved byte-for-byte from the frozen source.
- `reports/final/` contains final pre-fault, rollback, successful rebaseline, alias rejection, offline/resume and app-flow reports.
- `reports/superseded-attempts/` retains both earlier failed fixtures verbatim and a short explanation.
- `reproduction/` contains test-only scripts, synthetic SQL/config, the full-schema export and migration reference. Configs may contain original local path values; they are templates to adapt in a new local synthetic workspace, never to a remote target.
- `review-context/` contains the v2 restore audit, corrected canonical timing/source-verification artifacts and the independent synthetic small-D1 export.
- `EXCLUDED-SOURCE-METADATA.json` records hashes and sizes for excluded logs/runtime/database files without including their contents.

Only selected source artifacts were copied; their bytes are unchanged. The package excludes raw databases, `.wrangler` state, dependencies, raw logs, credential/session/PIN material and unrelated intermediate outputs. A known credential/token/session/PIN scan of included text found no hits. All database/export fixtures are synthetic.

`MANIFEST.json` lists SHA-256 and byte size for every payload file except itself; its own digest and the deterministic archive digest are in the external index.
