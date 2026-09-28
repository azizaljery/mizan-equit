"""Isolated synthetic-row preservation check; never connects to production.
Usage: python verify-legacy-migrations.py /path/to/site-git-checkout
Requires the baseline and target commits in that checkout.
"""
import hashlib, json, pathlib, sqlite3, subprocess, sys, tempfile

repo = pathlib.Path(sys.argv[1])
baseline = 'f0e9d449136a93aefcad2063411b7fe858a38630'
target = '65b623639588f40eb73c5d76616308737ab33f33'
def source(ref, path):
    return subprocess.check_output(['git', '-C', str(repo), 'show', f'{ref}:{path}'], text=True)
def migrations(ref):
    return [e['tag'] for e in json.loads(source(ref, 'drizzle/meta/_journal.json'))['entries']]
old, new = migrations(baseline), migrations(target)
assert new[:len(old)] == old, 'Migration history is not an append-only prefix'
for tag in old:
    assert source(baseline, f'drizzle/{tag}.sql') == source(target, f'drizzle/{tag}.sql'), tag
tables = ['site_settings', 'paper_portfolios', 'paper_trades', 'paper_cash_entries', 'analysis_snapshots', 'forecast_records']
def snapshot(db):
    result = {}
    for table in tables:
        rows = [list(r) for r in db.execute(f'SELECT * FROM "{table}" ORDER BY id')]
        raw = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
        result[table] = {'rows': len(rows), 'sha256': hashlib.sha256(raw).hexdigest()}
    return result
with tempfile.TemporaryDirectory(prefix='mizan-legacy-') as tmp:
    path = pathlib.Path(tmp) / 'synthetic.sqlite'
    db = sqlite3.connect(path)
    for tag in old:
        db.executescript(source(baseline, f'drizzle/{tag}.sql'))
    # Non-production SQL fixtures. Payloads test byte preservation, not UI validity.
    db.execute('INSERT INTO site_settings(id,value) VALUES(?,?)', (1, '{"companySections":[{"id":"sharia","visible":true}]}'))
    db.execute('INSERT INTO paper_trades(id,symbol,side,quantity,price,currency,created_at,data,portfolio_id) VALUES(?,?,?,?,?,?,?,?,?)', ('legacy-trade','AAPL','buy','2','100','USD','2026-09-01T00:00:00Z','{"legacy":true}','legacy'))
    db.execute('INSERT INTO paper_cash_entries(id,portfolio_id,cash_type,amount,currency,created_at,data) VALUES(?,?,?,?,?,?,?)', ('legacy-cash','legacy','deposit','1000','USD','2026-09-01T00:00:00Z','{"legacy":true}'))
    db.execute('INSERT INTO analysis_snapshots(id,symbol,created_at,data) VALUES(?,?,?,?)', ('legacy-snapshot','AAPL','2026-09-01T00:00:00Z','{"legacy":true}'))
    db.execute('INSERT INTO forecast_records(id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ('legacy-forecast','legacy-snapshot','AAPL','2026-09-01T00:00:00Z',5,'legacy-model','us','technology','low',1,'{"legacy":true,"price":100}'))
    db.commit()
    before = snapshot(db)
    for tag in new[len(old):]:
        db.executescript(source(target, f'drizzle/{tag}.sql'))
    after = snapshot(db)
    assert before == after, 'Legacy rows changed during migration'
    integrity = db.execute('PRAGMA integrity_check').fetchone()[0]
    assert integrity == 'ok'
    db.close()
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    reopened = snapshot(db)
    assert reopened == before, 'Legacy rows changed after reopen'
    db.close()
    print(json.dumps({'result':'PASS_LOCAL_ONLY','baselineCommit':baseline,'targetCommit':target,'sqliteVersion':sqlite3.sqlite_version,'environment':'temporary file-backed SQLite; synthetic rows; no production access','baselineMigrations':old,'appliedMigrations':new[len(old):],'before':before,'after':after,'reopened':reopened,'integrityCheck':integrity,'limitations':['No old application runtime executed','No live D1 or production backup tested','No destructive database rollback performed','Fixture payloads test preservation, not full application validity'],'humanReview':'PENDING'}, ensure_ascii=False, indent=2))
