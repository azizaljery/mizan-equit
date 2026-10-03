#!/usr/bin/env python3
"""Run one read-only SQLite integrity_check on the isolated local Miniflare D1 file."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sqlite3
import sys

state=Path('/workspace/scratch/621fd6e6940e/e002-isolated-2026-10-03/.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
files=[p for p in state.glob('*.sqlite') if p.name!='metadata.sqlite']
if len(files)!=1: raise SystemExit(f'expected exactly one synthetic D1 database file, found {len(files)}')
db=files[0]
con=sqlite3.connect(f'file:{db.resolve()}?mode=ro',uri=True)
try:
    con.execute('PRAGMA query_only=ON')
    query_only=con.execute('PRAGMA query_only').fetchone()[0]
    rows=con.execute('PRAGMA integrity_check').fetchall()
finally:
    con.close()
status='PASSED' if query_only==1 and rows==[('ok',)] else 'FAILED'
record={
 'evidenceId':'EVD-RB-005',
 'campaign':'E002-EVIDENCE-RECOVERY-2026-10-03',
 'generatedAt':datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),
 'kind':'direct_sqlite_integrity_check_capability_alternative',
 'status':status,
 'databaseFile':db.name,
 'databaseDirectory':str(state),
 'databaseId':'00000000-0000-4000-8000-202610032032',
 'productionDatabase':False,
 'connectionMode':'read-only SQLite URI (mode=ro) with PRAGMA query_only=ON',
 'queryOnlyValue':query_only,
 'pragma':'PRAGMA integrity_check',
 'resultRows':rows,
 'interpretation':'This direct SQLite read-only check uses the same isolated Miniflare D1 persistence file; it does not change the earlier D1-interface SQLITE_AUTH result.',
}
out=Path('/workspace/shared/engineering-qa/mizan-e002-2026-10-03/pragma-integrity-check-sqlite-direct.json')
out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'path':str(out),'status':status,'resultRows':rows,'queryOnlyValue':query_only,'databaseFile':db.name},indent=2))
if status!='PASSED': sys.exit(1)
