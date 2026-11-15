// Runs every test file that is not part of `npm test` (listed in scripts/standalone-tests.txt), one file per process,
// and prints a pass/fail line per file so unregistered suites can be promoted into `npm test` with evidence.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=readFileSync(new URL('./standalone-tests.txt',import.meta.url),'utf8').split('\n').filter(Boolean);
let failed=0;
for(const f of files){
  const r=spawnSync(process.execPath,['--test','--import','tsx',f],{encoding:'utf8',timeout:120000});
  const out=(r.stdout||'')+(r.stderr||''),m=(k)=>Number((out.match(new RegExp('# '+k+' (\\d+)'))||[])[1]||0);
  const ok=r.status===0;if(!ok)failed++;
  console.log(`STANDALONE ${ok?'PASS':'FAIL'} ${f} tests=${m('tests')} pass=${m('pass')} fail=${m('fail')} skipped=${m('skipped')}${ok?'':' status='+r.status}`);
}
console.log(`STANDALONE SUMMARY files=${files.length} failed=${failed}`);
process.exitCode=0; // informational: promotion into npm test is a separate, reviewed change
