"""Local-only SQLite recovery rehearsal using pinned application migrations.
Usage: python verify-isolated-database-restore.py /path/to/site-git-checkout
Synthetic data only. This is not a D1 backup, production export, or app restore.
"""
import hashlib, json, pathlib, sqlite3, subprocess, sys, tempfile

repo = pathlib.Path(sys.argv[1])
target = '65b623639588f40eb73c5d76616308737ab33f33'
def source(path):
    return subprocess.check_output(['git', '-C', str(repo), 'show', f'{target}:{path}'], text=True)
def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
def snapshot(db):
    schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
    tables = [r[1] for r in schema if r[0] == 'table']
    return {'schemaSha256':digest(schema), 'objects':{kind:sum(r[0]==kind for r in schema) for kind in ['table','index','trigger','view']},
            'tables':{table:{'rows':len(rows),'sha256':digest(rows)} for table in tables for rows in [db.execute(f'SELECT rowid,* FROM "{table}" ORDER BY rowid').fetchall()]}}
with tempfile.TemporaryDirectory(prefix='mizan-isolated-restore-') as tmp:
    root=pathlib.Path(tmp)
    db=sqlite3.connect(root/'source.sqlite')
    db.execute('PRAGMA foreign_keys=ON')
    migrations=[e['tag'] for e in json.loads(source('drizzle/meta/_journal.json'))['entries']]
    for tag in migrations:
        db.executescript(source(f'drizzle/{tag}.sql'))
    at='2026-09-01T00:00:00Z'
    db.execute('INSERT INTO site_settings(id,value) VALUES(?,?)',(1,'{"synthetic":true,"legacyMarker":"preserve-exactly"}'))
    db.execute('INSERT INTO paper_trades(id,symbol,side,quantity,price,currency,created_at,data,portfolio_id) VALUES(?,?,?,?,?,?,?,?,?)',('synthetic-trade','AAPL','buy','2','100','USD',at,'{"synthetic":true}','legacy'))
    db.execute('INSERT INTO paper_cash_entries(id,portfolio_id,cash_type,amount,currency,created_at,data) VALUES(?,?,?,?,?,?,?)',('synthetic-cash','legacy','deposit','1000','USD',at,'{"synthetic":true}'))
    db.execute('INSERT INTO analysis_snapshots(id,symbol,created_at,data) VALUES(?,?,?,?)',('screener:synthetic','AAPL',at,'{"synthetic":true}'))
    db.execute('INSERT INTO forecast_records(id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)',('synthetic-forecast','screener:synthetic','AAPL',at,5,'synthetic-model','us','technology','low',1,'{"synthetic":true,"price":100}'))
    db.commit()
    before=snapshot(db)
    backup=sqlite3.connect(root/'backup.sqlite')
    db.backup(backup)
    backup.close()
    # A later write must not appear in the earlier recovery point.
    db.execute('INSERT INTO paper_cash_entries(id,portfolio_id,cash_type,amount,currency,created_at,data) VALUES(?,?,?,?,?,?,?)',('after-recovery-point','legacy','deposit','500','USD',at,'{"synthetic":true}'))
    db.commit()
    db.close()
    backup=sqlite3.connect(f'file:{root / "backup.sqlite"}?mode=ro',uri=True)
    restored=sqlite3.connect(root/'restored.sqlite')
    backup.backup(restored)
    backup.close()
    restored.close()
    restored=sqlite3.connect(root/'restored.sqlite')
    restored.execute('PRAGMA foreign_keys=ON')
    after=snapshot(restored)
    assert before == after, 'Restored schema/rows differ from recovery point'
    assert restored.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
    assert restored.execute('PRAGMA foreign_key_check').fetchall()==[]
    assert restored.execute("SELECT COUNT(*) FROM paper_cash_entries WHERE id='after-recovery-point'").fetchone()[0]==0
    blocked=[]
    for sql in ["UPDATE forecast_records SET data='{}' WHERE id='synthetic-forecast'", "DELETE FROM forecast_records WHERE id='synthetic-forecast'", "UPDATE analysis_snapshots SET data='{}' WHERE id='screener:synthetic'", "DELETE FROM analysis_snapshots WHERE id='screener:synthetic'"]:
        try:
            restored.execute(sql)
        except sqlite3.IntegrityError as error:
            assert 'immutable' in str(error)
            blocked.append(str(error))
        else:
            raise AssertionError('Immutable trigger did not protect restored row')
    assert snapshot(restored)==before
    restored.close()
    print(json.dumps({'result':'PASS_LOCAL_SYNTHETIC_ONLY','sourceCommit':target,'sqliteVersion':sqlite3.sqlite_version,'method':'SQLite online backup API to local file, then restore to separate local file and reopen','migrationCount':len(migrations),'before':before,'restored':after,'integrityCheck':'ok','foreignKeyViolations':0,'immutableWriteAttemptsBlocked':len(blocked),'postRecoveryPointWriteAbsent':True,'productionAccess':False,'limitations':['No production data, D1 export or D1 recovery point used','No hosted database identity, retention, RPO or RTO proven','Application runtime was not executed against restored data','Most tables are empty; core synthetic fixtures check byte preservation, not all application validity','Later writes require explicit reconciliation; never overwrite production to test recovery'],'humanReview':'PENDING'},ensure_ascii=False,indent=2))
