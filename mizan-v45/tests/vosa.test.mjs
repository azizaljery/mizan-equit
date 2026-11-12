import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), V = m.vosa, E = m.botEngine, S2 = E.STRATEGY_V2;
const OPTS = {pipelineId: 'T', pipelineVersion: '1'};
let n = 0; const det = {makeId: () => 'id' + (++n), now: () => new Date('2026-11-12T10:00:00Z')};
const gate = (gateId, run, o = {}) => V.makeGate({gateId, gateVersion: '1', description: gateId, config: {gateId}, pure: o.pure, evaluate: (c) => run(c)});
const pass = (id) => ({gateId: id, gateVersion: '1', status: 'PASS', findings: []});
const kill = (id, observed = 1) => ({gateId: id, gateVersion: '1', status: 'KILL', findings: [{ruleId: id, message: 'x', observed, required: 0}]});
const susp = (id) => ({gateId: id, gateVersion: '1', status: 'SUSPEND', findings: [{ruleId: id, message: 'x'}]});
const cand = (id = 'A', payload = {x: 1}, version = 1) => V.makeCandidate(id, version, payload);
const pair = async (gates, c, mode = 'EXECUTION') => ({candidate: c, evaluation: await V.vosaEvaluate(gates, c, {...OPTS, ...det, mode})});

test('1. PASS only when every gate passes', async () => {
  const c = await cand(), ok = [await gate('G1', () => pass('G1')), await gate('G2', () => pass('G2'))];
  assert.equal((await V.vosaEvaluate(ok, c, OPTS)).finalStatus, 'PASS');
  const one = [ok[0], await gate('G2', () => susp('G2'))];
  assert.notEqual((await V.vosaEvaluate(one, c, OPTS)).finalStatus, 'PASS');
});
test('2. first KILL stops the pipeline (EXECUTION); AUDIT runs every gate', async () => {
  const c = await cand(), g = [await gate('K', () => kill('K')), await gate('P', () => pass('P'))];
  assert.equal((await V.vosaEvaluate(g, c, OPTS)).gateResults.length, 1);
  const a = await V.vosaEvaluate(g, c, {...OPTS, mode: 'AUDIT'}); assert.equal(a.gateResults.length, 2); assert.equal(a.finalStatus, 'KILL');
});
test('3. a KILL without proof is not accepted (fails closed to SUSPEND)', async () => {
  const g = await gate('K', () => ({gateId: 'K', gateVersion: '1', status: 'KILL', findings: []}));
  const e = await V.vosaEvaluate([g], await cand(), OPTS);
  assert.equal(e.finalStatus, 'SUSPEND'); assert.equal(e.gateResults[0].findings[0].ruleId, 'KILL-WITHOUT-PROOF');
});
test('4. a later PASS (or a forged final status) cannot resurrect a killed candidate', async () => {
  const c = await cand(), a = await pair([await gate('K', () => kill('K')), await gate('P', () => pass('P'))], c, 'AUDIT');
  assert.equal(a.evaluation.finalStatus, 'KILL');
  const forged = {...a.evaluation, finalStatus: 'PASS'};
  const sel = await V.vosaSelect([{candidate: c, evaluation: forged}], () => 5);
  assert.equal(sel.ranking.length, 0);
});
test('5. SUSPEND stops advancement but is not a permanent rejection (a corrected version can pass)', async () => {
  const g = [await gate('NEED', (c) => c.payload.x === undefined ? susp('NEED') : pass('NEED'))];
  const v1 = await cand('A', {}), e1 = await V.vosaEvaluate(g, v1, OPTS); assert.equal(e1.finalStatus, 'SUSPEND');
  const v2 = await V.nextVersion(v1, {x: 1}); assert.equal((await V.vosaEvaluate(g, v2, OPTS)).finalStatus, 'PASS');
});
test('6. SUSPEND never reaches the ranker', async () => {
  let called = 0; const c = await cand();
  const sel = await V.vosaSelect([await pair([await gate('S', () => susp('S'))], c)], () => { called++; return 1; });
  assert.equal(called, 0); assert.equal(sel.ranking.length, 0);
});
test('7. a new immutable version has its own identity, lineage and starts from scratch', async () => {
  const v1 = await cand('A', {x: 1}), v2 = await V.nextVersion(v1, {x: 2});
  assert.equal(v2.identity.version, 2); assert.equal(v2.identity.parentVersion, 1); assert.notEqual(v1.identity.payloadHash, v2.identity.payloadHash);
  assert.throws(() => { 'use strict'; v1.payload.x = 9; }, TypeError);
  const e = await V.vosaEvaluate([await gate('P', () => pass('P'))], v2, OPTS); assert.equal(e.auditTrail[0].gateOrder, 1); assert.equal(e.auditTrail[0].candidate.version, 2);
});
test('8. KILL on v1 is not inherited by a corrected v2', async () => {
  const g = [await gate('MAX', (c) => c.payload.x > 1 ? kill('MAX', c.payload.x) : pass('MAX'))];
  const v1 = await cand('A', {x: 5}), v2 = await V.nextVersion(v1, {x: 1});
  assert.equal((await V.vosaEvaluate(g, v1, OPTS)).finalStatus, 'KILL'); assert.equal((await V.vosaEvaluate(g, v2, OPTS)).finalStatus, 'PASS');
});
test('9+10. no survivors: a constraint-conflict report, and the least-bad rejected candidate is never passed', async () => {
  const k = await gate('K', () => kill('K')), s = await gate('S', () => susp('S'));
  const sel = await V.vosaSelect([await pair([k], await cand('A')), await pair([s], await cand('B'))], (c) => 100);
  assert.equal(sel.ranking.length, 0); assert.equal(sel.conflict.code, 'CONSTRAINT_CONFLICT');
  assert.deepEqual(sel.conflict.byStatus, {PASS: 0, KILL: 1, SUSPEND: 1}); assert.equal(sel.conflict.byGate.K.KILL, 1); assert.equal(sel.conflict.byGate.S.SUSPEND, 1);
});
test('11. NaN / Infinity input gives SUSPEND (and is hashed as a visible marker, not dropped)', async () => {
  const g = [await gate('NUM', (c) => Number.isFinite(c.payload.x) ? pass('NUM') : susp('NUM'))];
  for (const bad of [NaN, Infinity, -Infinity]) { const c = await cand('A', {x: bad}); assert.equal((await V.vosaEvaluate(g, c, OPTS)).finalStatus, 'SUSPEND'); }
  await assert.rejects(V.canonicalHash({x: NaN}), TypeError);
  assert.notEqual((await cand('A', {x: NaN})).identity.payloadHash, (await cand('A', {x: Infinity})).identity.payloadHash);
});
test('12. a non-finite rank score is a hard error: no ranking', async () => {
  const c = await cand(); const item = await pair([await gate('P', () => pass('P'))], c);
  await assert.rejects(V.vosaSelect([item], () => NaN), TypeError);
});
test('13. gate identity conflict fails closed', async () => {
  const g = await gate('A', () => pass('OTHER')), e = await V.vosaEvaluate([g], await cand(), OPTS);
  assert.equal(e.finalStatus, 'SUSPEND'); assert.equal(e.gateResults[0].findings[0].ruleId, 'GATE-IDENTITY-CONFLICT');
});
test('14. audit export is complete, ordered, valid JSON and carries each gate config hash', async () => {
  const c = await cand('A', {x: NaN}), gs = [await gate('P1', () => pass('P1')), await gate('S2', () => ({gateId: 'S2', gateVersion: '1', status: 'SUSPEND', findings: [{ruleId: 'R', message: 'bad', observed: NaN}]}))];
  const e = await V.vosaEvaluate(gs, c, {...OPTS, ...det, mode: 'AUDIT'}), parsed = JSON.parse(V.auditToJson(e.auditTrail));
  assert.equal(parsed.length, 2); assert.deepEqual(parsed.map(x => x.gateOrder), [1, 2]); assert.equal(parsed[1].findings[0].observed, 'NaN');
  assert.equal(parsed[0].gateConfigHash, gs[0].configHash); assert.equal(parsed[0].candidate.payloadHash, c.identity.payloadHash); assert.equal(parsed[0].runId, e.runId);
});
test('exception closed, AUDIT rejects impure gates, duplicate gate identity rejected, hash is order-independent', async () => {
  const boom = await gate('BOOM', () => { throw new Error('x'); }); assert.equal((await V.vosaEvaluate([boom], await cand(), OPTS)).finalStatus, 'SUSPEND');
  const imp = await gate('IMP', () => pass('IMP'), {pure: false});
  await assert.rejects(V.vosaEvaluate([imp], await cand(), {...OPTS, mode: 'AUDIT'}), /pure/);
  const p = await gate('P', () => pass('P')); await assert.rejects(V.vosaEvaluate([p, p], await cand(), OPTS), /duplicate/);
  assert.equal(await V.canonicalHash({a: 1, b: [1, 2]}), await V.canonicalHash({b: [1, 2], a: 1}));
});

// ---- Mizan gates: each gate shows PASS, and KILL and/or SUSPEND ----
const NOW = Date.parse('2026-11-12T12:00:00Z');
const base = (o = {}) => ({market: 'sa', symbol: '1120.SR', horizon: 5, now: NOW, forecastId: 'f1', forecastCreatedAt: '2026-11-12T10:00:00.000Z', votes: 3, targetPrice: 21, range: [19, 21.2],
  price: 20, advValue: 50_000_000, dailyVol: .02, orderValue: 100_000, signals: [{source: 'mizan-direction', direction: 'up', issuedAt: '2026-11-12T10:00:00.000Z'}], ...o});
async function audit(o) {
  const gates = await V.mizanBotGates(S2, 'sa'), e = await V.vosaEvaluate(gates, await V.botCandidate(base(o)), {...OPTS, mode: 'AUDIT'});
  return Object.fromEntries(e.gateResults.map(r => [r.gateId, r.status]));
}
test('Mizan gates: a clean candidate passes all eight gates', async () => {
  const r = await audit({}); assert.deepEqual(Object.values(r), Array(8).fill('PASS'));
  assert.deepEqual(Object.keys(r), ['REQUIRED_EVIDENCE', 'FINITE_NUMBERS', 'FORECAST_FRESHNESS', 'SOURCE_CONFLICT', 'SIGNAL_STRENGTH', 'LIQUIDITY', 'COST', 'CONFORMAL_RANGE']);
});
test('Mizan gates: KILL cases', async () => {
  assert.equal((await audit({forecastCreatedAt: '2026-11-11T00:00:00.000Z'})).FORECAST_FRESHNESS, 'KILL');
  assert.equal((await audit({votes: 1})).SIGNAL_STRENGTH, 'KILL');
  assert.equal((await audit({advValue: 1_000_000, orderValue: 5_000})).LIQUIDITY, 'KILL');
  assert.equal((await audit({orderValue: 900_000})).LIQUIDITY, 'KILL');
  assert.equal((await audit({targetPrice: 20.05})).COST, 'KILL');
  assert.equal((await audit({range: [15, 25]})).CONFORMAL_RANGE, 'KILL');
});
test('Mizan gates: SUSPEND cases (missing, non-finite, conflicting, future)', async () => {
  const a = await audit({price: null}); assert.equal(a.REQUIRED_EVIDENCE, 'SUSPEND');
  assert.equal((await audit({price: NaN})).FINITE_NUMBERS, 'SUSPEND'); assert.equal((await audit({advValue: Infinity})).LIQUIDITY, 'SUSPEND');
  assert.equal((await audit({signals: [{source: 'a', direction: 'up', issuedAt: 'x'}, {source: 'b', direction: 'down', issuedAt: 'x'}]})).SOURCE_CONFLICT, 'SUSPEND');
  assert.equal((await audit({forecastCreatedAt: '2026-11-12T13:00:00.000Z'})).FORECAST_FRESHNESS, 'SUSPEND');
  assert.equal((await audit({votes: null})).SIGNAL_STRENGTH, 'SUSPEND'); assert.equal((await audit({targetPrice: null})).COST, 'SUSPEND');
  assert.equal((await audit({range: null})).CONFORMAL_RANGE, 'SUSPEND');
});
test('Mizan gates: only a clean candidate survives and is ranked; killed and suspended are never ranked; config is bound to the strategy', async () => {
  const gates = await V.mizanBotGates(S2, 'sa'), mk = async (o) => { const c = await V.botCandidate(base(o)); return {candidate: c, evaluation: await V.vosaEvaluate(gates, c, OPTS)}; };
  const items = [await mk({}), await mk({symbol: 'BAD.SR', votes: 1}), await mk({symbol: 'NA.SR', price: null})];
  const sel = await V.vosaSelect(items, c => c.payload.votes);
  assert.deepEqual(sel.ranking.map(r => r.candidate.payload.symbol), ['1120.SR']);
  assert.notEqual(gates[0].configHash, (await V.mizanBotGates(E.STRATEGY_V1, 'sa'))[0].configHash);
  assert.equal(V.VOSA_NOT_ACTIVE.length, 4);
});
