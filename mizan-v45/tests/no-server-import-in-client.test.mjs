import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// Regression: a browser-bundled module must not import ./pin-lock (it built an empty chunk that WebKit rejects).
test('admin-tools-client does not import pin-lock',()=>{
 const src=readFileSync(new URL('../lib/admin-tools-client.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/from\s+['"]\.\/pin-lock['"]/);
});
