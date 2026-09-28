import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeFixture} from './support/hybrid-fixture.mjs';

test('CLI replays both horizons, preserves provenance, and never overwrites a report',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aziz-hybrid-'));
 try{
  const data=makeFixture(230),input=join(dir,'input.json'),output=join(dir,'report.json');
  await writeFile(input,JSON.stringify(data));
  const script=fileURLToPath(new URL('../scripts/run-hybrid-replay.mjs',import.meta.url));
  const args=[script,input,output,data.bars.at(-1).availableAt];
  const run=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const before=await readFile(output,'utf8'),report=JSON.parse(before);
  assert.equal(report.kind,'research_replay_not_live_accuracy');
  assert.deepEqual(report.results.map(r=>r.horizon),[5,21]);
  assert.ok(report.results.every(r=>!r.canActivate&&r.inputProvenance.source==='synthetic_fixture'));
  const duplicate=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/EEXIST/);
  assert.equal(await readFile(output,'utf8'),before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
