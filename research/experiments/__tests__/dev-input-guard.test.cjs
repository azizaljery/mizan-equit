const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const {openDevInput, buildManifest, sha256} = require('../dev-input-guard.cjs');
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-'));
  const sealed = path.join(root, 'research-data'), dev = path.join(root, 'dev');
  fs.mkdirSync(sealed); fs.mkdirSync(dev);
  fs.writeFileSync(path.join(sealed, 'X.json'), JSON.stringify({symbol: 'X', rows: [['2024-09-03', 1, 1, 1, 1, 1], ['2025-01-02', 9, 9, 9, 9, 9]]}));
  fs.writeFileSync(path.join(dev, 'X.json'), JSON.stringify({symbol: 'X', rows: [['2024-09-03', 1, 1, 1, 1, 1]]}));
  const m = buildManifest(dev, '2024-09-04'); const mp = path.join(dev, 'manifest.json.lock'); const mb = JSON.stringify(m); fs.writeFileSync(mp, mb);
  return {root, sealed, dev, mp, msha: sha256(Buffer.from(mb))};
}
test('approved dev file opens; dates within cutoff', () => { const s = setup(); const g = openDevInput({manifestPath: s.mp, manifestSha256: s.msha, restrictedRoots: [s.sealed]}); assert.equal(g.read('X.json').rows.length, 1); });
test('manifest with wrong pinned hash is refused', () => { const s = setup(); assert.throws(() => openDevInput({manifestPath: s.mp, manifestSha256: '0'.repeat(64), restrictedRoots: [s.sealed]}), /manifest hash mismatch/); });
test('directory inside the restricted root is refused', () => { const s = setup(); const m = {cutoff: '2024-09-04', dir: '../research-data', files: [{name: 'X.json', bytes: 1, sha256: 'x'}]}; const mp = path.join(s.dev, 'evil.lock'); fs.writeFileSync(mp, JSON.stringify(m));
  assert.throws(() => openDevInput({manifestPath: mp, manifestSha256: sha256(fs.readFileSync(mp)), restrictedRoots: [s.sealed]}), /restricted root/); });
test('symlink into the restricted root is refused before reading', () => { const s = setup(); const link = path.join(s.root, 'link'); fs.symlinkSync(s.sealed, link); const m = {cutoff: '2024-09-04', dir: '../link', files: [{name: 'X.json', bytes: 1, sha256: 'x'}]}; const mp = path.join(s.dev, 'sym.lock'); fs.writeFileSync(mp, JSON.stringify(m));
  assert.throws(() => openDevInput({manifestPath: mp, manifestSha256: sha256(fs.readFileSync(mp)), restrictedRoots: [s.sealed]}), /restricted root/); });
test('tampered file is rejected by hash BEFORE JSON.parse (invalid JSON gives hash error, not parse error)', () => { const s = setup(); const g = openDevInput({manifestPath: s.mp, manifestSha256: s.msha, restrictedRoots: [s.sealed]}); fs.writeFileSync(path.join(s.dev, 'X.json'), '{not json');
  assert.throws(() => g.read('X.json'), /hash mismatch .*before parsing/); });
test('file not in manifest is refused; unlisted file in dir blocks opening', () => { const s = setup(); const g = openDevInput({manifestPath: s.mp, manifestSha256: s.msha, restrictedRoots: [s.sealed]}); assert.throws(() => g.read('Y.json'), /not in manifest/);
  fs.writeFileSync(path.join(s.dev, 'Y.json'), '{}'); assert.throws(() => openDevInput({manifestPath: s.mp, manifestSha256: s.msha, restrictedRoots: [s.sealed]}), /unlisted file/); });
test('an approved-but-wrong file with post-cutoff dates is still refused (secondary check)', () => { const s = setup(); fs.copyFileSync(path.join(s.sealed, 'X.json'), path.join(s.dev, 'X.json')); const m = buildManifest(s.dev, '2024-09-04'); const mb = JSON.stringify(m); fs.writeFileSync(s.mp, mb);
  const g = openDevInput({manifestPath: s.mp, manifestSha256: sha256(Buffer.from(mb)), restrictedRoots: [s.sealed]}); assert.throws(() => g.read('X.json'), /after cutoff/); });
