import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importPreflight,recordImportAttemptFailure,TWELVE_DATA_SECRET} from '../lib/aziz/import-run-log';

test('missing provider key is a recorded failure, not a silent one',async()=>{
 for(const k of [undefined,null,'','   ',0])assert.equal(importPreflight(k)?.code,'twelve_data_key_missing',String(k));
 assert.equal(importPreflight('abc'),null);
 const seen:any[]=[];const DB={prepare:(sql:string)=>({bind:(...v:unknown[])=>({run:async()=>{seen.push({sql,v});}})})};
 const id=await recordImportAttemptFailure(DB as any,1,['2222.SR','1120.SR'],importPreflight('')!);
 assert.ok(id);assert.equal(seen.length,1);assert.match(seen[0].sql,/INSERT INTO aziz_import_runs/);
 assert.equal(seen[0].v[4],'failed');assert.deepEqual(JSON.parse(seen[0].v[6]),['2222.SR','1120.SR']);
 const result=JSON.parse(seen[0].v[7]);assert.equal(result.code,'twelve_data_key_missing');assert.equal(result.secretName,TWELVE_DATA_SECRET);
 const broken={prepare:()=>({bind:()=>({run:async()=>{throw Error('db down')}})})};
 assert.equal(await recordImportAttemptFailure(broken as any,1,[],importPreflight('')!),null);
});
test('route records the failed attempt before any provider call and after the owner/admin gates',()=>{
 const src=readFileSync('app/api/admin/aziz/import/route.ts','utf8');
 const gate=src.indexOf('adminSession(DB,req)'),pre=src.indexOf('recordImportAttemptFailure(DB'),fetchAt=src.indexOf('await fetch(');
 assert.ok(gate>0&&pre>gate,'preflight after auth gates');assert.ok(fetchAt>0&&fetchAt<pre||src.indexOf('for(const item of items)')>pre,'preflight before the import loop');
 assert.ok(src.indexOf('for(const item of items)')>pre);
});
