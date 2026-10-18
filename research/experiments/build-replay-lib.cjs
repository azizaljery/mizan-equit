#!/usr/bin/env node
/**
 * Transpile mizan-v45/lib (TypeScript) to CommonJS for offline research replays. Transpile-only (no type check), so it
 * needs no node_modules in mizan-v45; it never edits app code. Output layout matches what run-forecast-replay.cjs and
 * shara-backfill.cjs expect: <out>/lib/research-model.js, <out>/lib/screener-shara.js, <out>/lib/shara/*.js, ...
 *
 * usage: NODE_PATH=/opt/npm-tools/node_modules node build-replay-lib.cjs <out-dir> [mizan-v45-dir]
 */
const fs = require('fs'), path = require('path');
const ts = require('typescript');
const [, , outArg, appArg] = process.argv;
if (!outArg) { console.error('usage: build-replay-lib.cjs <out-dir> [mizan-v45-dir]'); process.exit(2); }
const appDir = path.resolve(appArg || path.join(__dirname, '../../mizan-v45'));
const srcRoot = path.join(appDir, 'lib'), outRoot = path.join(path.resolve(outArg), 'lib');
let n = 0, copied = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name), rel = path.relative(srcRoot, p), o = path.join(outRoot, rel);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.d\.ts$/.test(e.name)) continue;
    if (/\.(ts|mts|tsx)$/.test(e.name)) {
      const src = fs.readFileSync(p, 'utf8');
      const out = ts.transpileModule(src, {fileName: p, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX}}).outputText;
      fs.mkdirSync(path.dirname(o), {recursive: true});
      fs.writeFileSync(o.replace(/\.(ts|mts|tsx)$/, '.js'), out); n++;
    } else if (/\.(json|js|cjs)$/.test(e.name)) {
      fs.mkdirSync(path.dirname(o), {recursive: true}); fs.copyFileSync(p, o); copied++;
    }
  }
}
walk(srcRoot);
console.log(`transpiled ${n} files, copied ${copied} -> ${outRoot}`);
