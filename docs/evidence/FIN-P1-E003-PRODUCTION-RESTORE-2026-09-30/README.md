# E-003 sanitized run evidence

Source: GitHub Actions run [36779960771](https://github.com/azizaljery/Com/actions/runs/36779960771), branch `phase1/e003-production-restore`, commit `e36cf43012cb9c4e722b341cf2e3ecd08c0d723f`.

Original Actions artifact: ID `11127004356`, SHA-256 `c3fa64bbf802d378c93199e27dfd5f73b80c3ece0c5865bd64d3b21a6db4bdcd`, retention expires 2026-10-07. This directory preserves its sanitized files for the repository record. The original 68,809,956-byte SQL export is not present here, in Git or in the Actions artifact.

The bundle includes production/isolated D1 identity metadata, schema and critical-table hashes/counts, import result, integrity checks, app smoke statuses, post-smoke fingerprints, no-silent-mutation proof and target cleanup result. It contains no production row contents.

Technical checks passed. Human acceptance of the live export as a recovery point and of the RPO/retention limitations remains pending in E-004.
