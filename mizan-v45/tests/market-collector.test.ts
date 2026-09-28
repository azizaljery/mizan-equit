import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRoundRobin } from '../lib/jobs/round-robin';

const rows=[{symbol:'A'},{symbol:'B'},{symbol:'C'}];

test('round robin advances without duplicate items inside a batch',()=>{
  const first=pickRoundRobin(rows,0,2);
  assert.deepEqual(first.items.map(x=>x.symbol),['A','B']);
  assert.equal(first.next,2);
  const second=pickRoundRobin(rows,first.next,2);
  assert.deepEqual(second.items.map(x=>x.symbol),['C','A']);
  assert.equal(second.next,1);
});

test('round robin caps a batch at universe size and wraps negative cursors',()=>{
  const picked=pickRoundRobin(rows,-1,10);
  assert.deepEqual(picked.items.map(x=>x.symbol),['C','A','B']);
  assert.equal(picked.next,2);
});

test('empty universe is stable',()=>{
  assert.deepEqual(pickRoundRobin([],99,5),{items:[],next:0});
});
