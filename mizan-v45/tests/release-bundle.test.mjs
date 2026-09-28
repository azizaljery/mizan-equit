import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyReleaseBundle} from '../scripts/verify-release-bundle.mjs';
for(const kind of ['valid','unstamped-import','unstamped-entry','missing-route'])test('actual release bundle check: '+kind,async()=>{
 const root=await mkdtemp(join(tmpdir(),'mizan-bundle-'));
 try{
  for(const dir of ['public','lib','dist/server'])await mkdir(join(root,dir),{recursive:true});
  const stamp={worker:'mizan-equity',commit:'a'.repeat(40),generatedAt:'2026-09-25T18:00:00Z'};
  await writeFile(join(root,'public/mizan-deployment.json'),JSON.stringify(stamp));
  await writeFile(join(root,'lib/deployment-identity.json'),JSON.stringify(kind==='unstamped-import'?{...stamp,commit:null}:stamp));
  await writeFile(join(root,'dist/server/index.js'),(kind==='unstamped-entry'?'old':stamp.commit)+(kind==='missing-route'?'':' mizan-deployment.json'));
  if(kind==='valid')assert.equal((await verifyReleaseBundle(root,stamp.commit)).status,'passed');
  else await assert.rejects(verifyReleaseBundle(root,stamp.commit),/release-bundle-mismatch/);
  const report=JSON.parse(await readFile(join(root,'verify-out/release-bundle.json'),'utf8'));assert.equal(report.status,kind==='valid'?'passed':'failed');
 }finally{await rm(root,{recursive:true,force:true});}
});
