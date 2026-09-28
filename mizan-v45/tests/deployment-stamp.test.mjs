import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stampDeploymentRoute} from '../scripts/stamp-deployment-route.mjs';
test('bundled identity matches the existing public stamp byte for byte',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mizan-stamp-'));
 try{
  await mkdir(join(root,'public'));const value={worker:'mizan-equity',commit:'a'.repeat(40),generatedAt:'2026-09-25T18:00:00Z'};
  await writeFile(join(root,'public/mizan-deployment.json'),JSON.stringify(value)+'\n');
  await stampDeploymentRoute(root,value.commit);assert.deepEqual(JSON.parse(await readFile(join(root,'lib/deployment-identity.json'),'utf8')),value);
  await assert.rejects(stampDeploymentRoute(root,'b'.repeat(40)));await assert.rejects(stampDeploymentRoute(root,'abc'));
 }finally{await rm(root,{recursive:true,force:true});}
});
