// Static guard: FCST-0002 scripts must not read price files directly; only via dev-input-guard.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const files=fs.readdirSync(dir).filter(n=>/^fcst0002-.*\.cjs$/.test(n));
test('FCST-0002 scripts exist',()=>assert.ok(files.length>0));
for(const n of files)test(`${n}: no direct readFileSync/readdirSync/research-data path`,()=>{const s=fs.readFileSync(path.join(dir,n),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
 assert.ok(!/\breadFileSync\s*\(|\breaddirSync\s*\(|\bcreateReadStream\s*\(/.test(s),'direct read found');assert.ok(!/research-data/.test(s),'hard-coded sealed path');});
