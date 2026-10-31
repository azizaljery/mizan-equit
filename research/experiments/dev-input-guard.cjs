/* FCST-0002 development-input guard.
 * Rule: research scripts read price files ONLY through openDevInput(), which
 *  1) refuses any directory inside a restricted root (the sealed research-data copy) — including via symlinks (realpath);
 *  2) refuses any file not listed in an approved manifest;
 *  3) verifies SHA-256 of the raw bytes BEFORE JSON.parse (no parsing of unapproved content);
 *  4) only then parses, and re-checks max date <= manifest.cutoff as a secondary assertion.
 * The manifest itself is approved by commit (its own SHA-256 is pinned by the caller).
 * A new cut fetch restores separation of INPUTS; it does not restore independence of a period already used. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

function openDevInput({manifestPath, manifestSha256, restrictedRoots = []}) {
  const mBuf = fs.readFileSync(manifestPath);
  if (sha256(mBuf) !== manifestSha256) throw new Error('DEV_INPUT: manifest hash mismatch (unapproved manifest)');
  const m = JSON.parse(mBuf.toString('utf8'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.cutoff || '') || !Array.isArray(m.files) || !m.files.length) throw new Error('DEV_INPUT: invalid manifest');
  const dir = fs.realpathSync(path.resolve(path.dirname(manifestPath), m.dir || '.'));
  for (const r of restrictedRoots) { let rr; try { rr = fs.realpathSync(r); } catch { rr = path.resolve(r); } if (inside(dir, rr)) throw new Error('DEV_INPUT: directory is inside a restricted root'); }
  const listed = new Map(m.files.map((f) => [f.name, f]));
  const present = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  for (const n of present) if (!listed.has(n)) throw new Error(`DEV_INPUT: unlisted file present: ${n}`);
  function read(name) {
    const meta = listed.get(name); if (!meta) throw new Error(`DEV_INPUT: not in manifest: ${name}`);
    const p = path.join(dir, name), real = fs.realpathSync(p);
    for (const r of restrictedRoots) { let rr; try { rr = fs.realpathSync(r); } catch { rr = path.resolve(r); } if (inside(real, rr)) throw new Error('DEV_INPUT: file resolves into a restricted root'); }
    const buf = fs.readFileSync(real);
    if (buf.length !== meta.bytes || sha256(buf) !== meta.sha256) throw new Error(`DEV_INPUT: hash mismatch for ${name} (rejected before parsing)`);
    const d = JSON.parse(buf.toString('utf8'));
    const last = (d.rows || []).reduce((a, r) => (r[0] > a ? r[0] : a), '');
    if (last > m.cutoff) throw new Error(`DEV_INPUT: ${name} contains dates after cutoff (approved file is wrong)`);
    return d;
  }
  return {cutoff: m.cutoff, names: [...listed.keys()].sort(), read};
}
function buildManifest(dir, cutoff) {
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((name) => { const b = fs.readFileSync(path.join(dir, name)); return {name, bytes: b.length, sha256: sha256(b)}; });
  return {cutoff, dir: '.', files};
}
module.exports = {openDevInput, buildManifest, sha256};
