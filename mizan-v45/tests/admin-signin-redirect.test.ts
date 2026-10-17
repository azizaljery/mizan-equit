import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturn} from '../lib/safe-return.ts';
const O='https://mizan-aziz.aljeryabod.workers.dev';
test('keeps same-origin paths',()=>{
  assert.equal(safeReturn('/screener?x=1#a',O),'/screener?x=1#a');
  assert.equal(safeReturn('/',O),'/');
});
test('rejects open-redirect tricks',()=>{
  for(const v of ['/\t/evil.com','/\n/evil.com','/\r/evil.com','//evil.com','/\\evil.com','https://evil.com','evil.com','/%09/evil.com'.replace('%09','\t'),'/\u0000/x',null,''])
    assert.equal(safeReturn(v as any,O),'/',String(JSON.stringify(v)));
});
test('resolved target always stays on origin',()=>{
  for(const v of ['/a/../b','/./x','/%2F%2Fevil.com']){const r=safeReturn(v,O);assert.equal(new URL(r,O).origin,O);}
});
