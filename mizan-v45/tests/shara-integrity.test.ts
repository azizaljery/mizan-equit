import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256Hex} from '../lib/shara/sha256';
import {ChainedAuditSink, verifyAuditChain, AUDIT_GENESIS, type ChainedAuditRecord} from '../lib/shara/chain';
import {SharaLineage, SharaRunLedger, SharaResurrectionError} from '../lib/shara/lineage';
import {SharaEngine} from '../lib/shara/engine';
import {maximumGate} from '../lib/shara/gates';
import type {CandidateEvidenceEnvelope} from '../lib/shara/contracts';

const id = (candidateId: string, version: number, payloadHash = 'h') => ({candidateId, version, payloadHash});

test('sha256Hex matches node:crypto (empty, ascii, block boundaries, unicode/Arabic, long)', () => {
  const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'ميزان للأسهم ✓', 'x'.repeat(10000)];
  for (const s of samples) assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `len=${s.length}`);
});

const envelope = (c: string, x: unknown): CandidateEvidenceEnvelope => ({
  identity: id(c, 1), assembledAt: '2026-01-01T00:00:00.000Z',
  evidence: {x: {evidenceId: `${c}:x`, providerId: 't', providerVersion: '1', observedAt: '2026-01-01T00:00:00.000Z', value: x as number}},
});
async function realChain() {
  const sink = new ChainedAuditSink();
  const engine = new SharaEngine([maximumGate('A', 'x', 1, 'x<=1')], {pipelineId: 't', pipelineVersion: '1', mode: 'EXECUTION', auditSink: sink});
  for (const [c, x] of [['a', 0], ['b', 5], ['c', Number.NaN], ['d', 1]] as const) await engine.evaluate(envelope(c, x));
  return sink;
}

test('chain: engine events verify; head is stable and deterministic', async () => {
  const sink = await realChain();
  assert.equal(sink.records.length, 4, 'every evaluation, including the envelope-integrity SUSPEND, is audited');
  assert.ok(sink.records.some((r) => r.event.gate.gateId === 'ENVELOPE_INTEGRITY'));
  const v = sink.verify();
  assert.equal(v.ok, true);
  assert.deepEqual(sink.head(), (v as {head: unknown}).head);
  assert.equal(sink.records[0].prev, AUDIT_GENESIS);
});
test('chain: editing, reordering, deleting-in-middle, forged hash are all detected', async () => {
  const sink = await realChain();
  const copy = (): ChainedAuditRecord[] => JSON.parse(sink.exportJson());
  const edit = copy(); (edit[1].event as {status: string}).status = 'PASS';
  assert.equal(verifyAuditChain(edit).ok, false);
  const swap = copy(); [swap[0], swap[1]] = [swap[1], swap[0]];
  assert.equal(verifyAuditChain(swap).ok, false);
  const del = copy(); del.splice(1, 1);
  assert.equal(verifyAuditChain(del).ok, false);
  const forged = copy(); (forged[2] as {hash: string}).hash = 'f'.repeat(64);
  assert.equal(verifyAuditChain(forged).ok, false);
  assert.equal(verifyAuditChain(copy()).ok, true, 'untouched export still verifies');
});
test('chain: tail truncation is only caught with an external head anchor (documented limit)', async () => {
  const sink = await realChain();
  const anchor = sink.head();
  const cut: ChainedAuditRecord[] = JSON.parse(sink.exportJson()); cut.pop();
  assert.equal(verifyAuditChain(cut).ok, true, 'without anchor, tail deletion is undetectable');
  assert.equal(verifyAuditChain(cut, anchor).ok, false, 'with anchor it is detected');
});
test('chain: non-finite numbers are rejected at append (cannot be audited silently)', () => {
  const sink = new ChainedAuditSink();
  assert.throws(() => sink.append({durationMs: Number.NaN} as never), /Non-finite/);
  assert.equal(sink.records.length, 0);
});
test('lineage: immutability, increasing versions, unknown parent, same-payload idempotency, bad versions', () => {
  const l = new SharaLineage();
  l.register(id('A', 1));
  l.register(id('A', 1)); // idempotent, same payload
  assert.throws(() => l.register(id('A', 1, 'other')), /immutable/);
  assert.throws(() => l.register(id('B', 1), [{candidateId: 'Z', version: 1}]), /unknown parent/);
  l.register(id('A', 3), [{candidateId: 'A', version: 1}]);
  assert.throws(() => l.register(id('A', 2)), /must increase/);
  for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) assert.throws(() => l.register(id('Q', bad)), RangeError);
  l.register(id('C', 1), [{candidateId: 'A', version: 3}]);
  assert.deepEqual(l.ancestors({candidateId: 'C', version: 1}), ['A@1', 'A@3']);
  assert.throws(() => l.ancestors({candidateId: 'nope', version: 1}), /unknown node/);
});
test('No Resurrection: KILL is terminal within a run; new version and other run are independent', () => {
  const led = new SharaRunLedger();
  const a1 = {candidateId: 'A', version: 1};
  led.record('r1', a1, 'KILL');
  for (const s of ['PASS', 'SUSPEND'] as const) assert.throws(() => led.record('r1', a1, s), SharaResurrectionError);
  assert.equal(led.isRankable('r1', a1), false);
  led.record('r1', a1, 'KILL'); // idempotent
  led.record('r1', {candidateId: 'A', version: 2}, 'PASS'); // from scratch
  assert.equal(led.isRankable('r1', {candidateId: 'A', version: 2}), true);
  led.record('r2', a1, 'PASS'); // different run
  assert.equal(led.isRankable('r2', a1), true);
  assert.equal(led.isRankable('r1', {candidateId: 'unknown', version: 1}), false, 'unknown is never rankable');
});
test('ledger: SUSPEND may resolve; PASS may be tightened to KILL but then stays KILL', () => {
  const led = new SharaRunLedger(); const c = {candidateId: 'S', version: 1};
  led.record('r', c, 'SUSPEND'); assert.equal(led.isRankable('r', c), false);
  led.record('r', c, 'PASS'); assert.equal(led.isRankable('r', c), true);
  led.record('r', c, 'KILL'); assert.equal(led.isRankable('r', c), false);
  assert.throws(() => led.record('r', c, 'PASS'), SharaResurrectionError);
});
