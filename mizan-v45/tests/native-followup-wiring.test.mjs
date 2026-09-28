import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';

test('deployment stages full acceptance and production cron advances the same resumable path',async()=>{
 const source=await readFile(new URL('../scripts/verify-screener-followup.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("action:'followup-acceptance-start'"));
 assert.ok(source.includes("action:'runtime-ready'"));
 assert.ok(!source.includes("action:'archive-batch'"));
 const route=await readFile(new URL('../app/api/internal/automation/route.ts',import.meta.url),'utf8');
 assert.ok(route.indexOf('if(!await authorized(req))')<route.indexOf("if(action==='followup-acceptance-start')"));
 assert.ok(route.includes("startScreenerFollowupAcceptance(runtime.DB,body.config,deploymentIdentity.commit)"));
 const worker=await readFile(new URL('../worker/screener-followup.ts',import.meta.url),'utf8');
 assert.ok(worker.includes("controller.cron!==SCREENER_FOLLOWUP_CRON"));
 assert.ok(worker.includes('advanceAcceptance(env.DB,controller.scheduledTime)'));
 assert.ok(worker.includes("acceptFollowupProof(db,ids,acceptance.config,true)"));
 const vite=await readFile(new URL('../vite.config.ts',import.meta.url),'utf8');
 assert.ok(vite.includes('SCREENER_FOLLOWUP_CRON'));
 const workflow=await readFile(new URL('../../.github/workflows/deploy-mizan-equity.yml',import.meta.url),'utf8');
 assert.ok(workflow.includes('Stage full-market screener acceptance for scheduled completion'));
});
