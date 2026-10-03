#!/usr/bin/env python3
"""Read-only hashes/counts of the six synthetic E-002 domain tables."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import sqlite3
import sys

STATE = Path("/workspace/scratch/621fd6e6940e/e002-isolated-2026-10-03/.wrangler/state/v3/d1/miniflare-D1DatabaseObject")
OUT = Path("/workspace/shared/engineering-qa/mizan-e002-2026-10-03")
TABLE_KEYS = {
    "site_settings": "id",
    "paper_portfolios": "id",
    "paper_trades": "id",
    "paper_cash_entries": "id",
    "analysis_snapshots": "id",
    "forecast_records": "id",
}

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9-]{1,72}", sys.argv[1]):
    raise SystemExit("usage: snapshot_domains.py <stage-label>")
files = [p for p in STATE.glob("*.sqlite") if p.name != "metadata.sqlite"]
if len(files) != 1:
    raise SystemExit(f"expected exactly one local D1 database file, found {len(files)}")
db_path = files[0]
uri = f"file:{db_path.resolve()}?mode=ro"
con = sqlite3.connect(uri, uri=True)
con.row_factory = sqlite3.Row
con.execute("PRAGMA query_only=ON")
try:
    table_sql = con.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    app_schema = [dict(name=r["name"], sql=r["sql"]) for r in table_sql if r["name"] not in {"_cf_METADATA", "d1_migrations"}]
    app_schema.sort(key=lambda row: row["name"])
    table_results = {}
    for table, key_column in TABLE_KEYS.items():
        rows = [dict(r) for r in con.execute(f"SELECT * FROM {table} ORDER BY {key_column}").fetchall()]
        table_results[table] = {
            "rowCount": len(rows),
            "rowIds": [row[key_column] for row in rows],
            "rowsSha256": sha(canonical(rows)),
        }
    projection = {name: {"rowCount": values["rowCount"], "rowsSha256": values["rowsSha256"]} for name, values in sorted(table_results.items())}
    result = {
        "campaign": "E002-EVIDENCE-RECOVERY-2026-10-03",
        "stage": sys.argv[1],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "databasePath": str(db_path),
        "connectionMode": "sqlite read-only URI with PRAGMA query_only=ON",
        "syntheticLocalDatabase": True,
        "applicationSchema": {
            "tableCount": len(app_schema),
            "sha256": sha(canonical(app_schema)),
            "canonicalization": "JSON UTF-8 array of {name,sql}, sorted by name, compact separators, excluding d1_migrations, _cf_METADATA, sqlite_*.",
        },
        "tables": table_results,
        "combinedDomainDataSha256": sha(canonical(projection)),
        "note": "No row contents are emitted. rowIds are fixture identifiers or the migration-created legacy placeholder."
    }
finally:
    con.close()
out = OUT / f"snapshot-{sys.argv[1]}.json"
out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"path": str(out), "stage": result["stage"], "schemaSha256": result["applicationSchema"]["sha256"], "domainSha256": result["combinedDomainDataSha256"], "tableRowCounts": {k:v["rowCount"] for k,v in table_results.items()}}, ensure_ascii=False, indent=2))
