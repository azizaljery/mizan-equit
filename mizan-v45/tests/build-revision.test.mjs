import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveBuildRevision} from '../scripts/resolve-build-revision.mjs';
const sha='a'.repeat(40),other='b'.repeat(40);
test('GitHub source revision is preserved',()=>assert.equal(resolveBuildRevision({GITHUB_SHA:sha},sha),sha));
test('Workers Builds revision is recognised without GITHUB_SHA',()=>assert.equal(resolveBuildRevision({WORKERS_CI:'1',WORKERS_CI_COMMIT_SHA:sha},sha),sha));
test('same revision from both CI systems is unambiguous',()=>assert.equal(resolveBuildRevision({GITHUB_SHA:sha,WORKERS_CI_COMMIT_SHA:sha},sha),sha));
test('wrong environment revision cannot be stamped onto different source',()=>assert.throws(()=>resolveBuildRevision({WORKERS_CI_COMMIT_SHA:other},sha)));
test('conflicting CI variables fail before building',()=>assert.throws(()=>resolveBuildRevision({GITHUB_SHA:sha,WORKERS_CI_COMMIT_SHA:other})));
test('local checked-out revision is used instead of a null placeholder',()=>assert.equal(resolveBuildRevision({},sha),sha));
test('missing provenance fails closed',()=>assert.throws(()=>resolveBuildRevision({})));
test('partial and malformed SHA values are rejected',()=>{for(const v of ['abc',sha+'x',42,'../../secret'])assert.throws(()=>resolveBuildRevision({WORKERS_CI_COMMIT_SHA:v}));});
test('build regenerates both stamps before compilation, retaining bundle checks',async()=>{const s=await readFile(new URL('../scripts/build-verified.sh',import.meta.url),'utf8');assert.ok(s.indexOf('resolve-build-revision.mjs')<s.indexOf('"${vinext}" build'));assert.ok(s.includes('scripts/verify-deployment.mjs" --mark'));assert.ok(s.includes('scripts/verify-release-bundle.mjs'));});

test('published build wrapper passes Bash syntax validation',()=>{execFileSync('bash',['-n',fileURLToPath(new URL('../scripts/build-verified.sh',import.meta.url))],{stdio:'pipe'});});
