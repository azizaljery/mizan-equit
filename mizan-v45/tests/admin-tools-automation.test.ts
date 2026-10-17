import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  decideAutomationAuth, ownerSessionActionAllowed, equalSecret, clampEvaluateLimit,
  validateBacktestForm, validateWalkForward, classifyAdminStatus, EVALUATE_LIMIT_MAX,
} from '../lib/admin-tools-client';

const O = 'https://mizan.test';
const OWNER = 'owner@example.com';
const TOKEN = 'a'.repeat(40);
const UI = O + '/api/admin/tools/automation';

function req(url: string, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(url, {method, headers, body: method === 'POST' ? '{}' : undefined});
}
const ownerHeaders = {origin: O, 'cf-access-authenticated-user-email': OWNER, 'sec-fetch-site': 'same-origin'};
function opts(session = true, expectedToken = '') {
  let calls = 0;
  return {
    o: {expectedToken, ownerEmail: OWNER, hasAdminSession: async () => { calls++; return session; }},
    calls: () => calls,
  };
}

test('owner session path: identity + session + same-origin POST under /api/admin', async () => {
  const {o, calls} = opts(true);
  assert.equal(await decideAutomationAuth(req(UI, ownerHeaders), o), 'owner-session');
  assert.equal(calls(), 1);
});

test('owner session path rejects each missing factor (and skips the DB when cheap checks fail)', async () => {
  const cases: Array<[string, Request]> = [
    ['no origin', req(UI, {'cf-access-authenticated-user-email': OWNER})],
    ['foreign origin', req(UI, {...ownerHeaders, origin: 'https://evil.test'})],
    ['null origin', req(UI, {...ownerHeaders, origin: 'null'})],
    ['cross-site fetch', req(UI, {...ownerHeaders, 'sec-fetch-site': 'cross-site'})],
    ['no identity', req(UI, {origin: O})],
    ['other identity', req(UI, {...ownerHeaders, 'cf-access-authenticated-user-email': 'x@example.com'})],
    ['GET method', req(UI, ownerHeaders, 'GET')],
    ['outside Access path', req(O + '/api/internal/automation', ownerHeaders)],
  ];
  for (const [name, r] of cases) {
    const {o, calls} = opts(true);
    assert.equal(await decideAutomationAuth(r, o), null, name);
    assert.equal(calls(), 0, name + ' must not touch the session store');
  }
});

test('owner session path requires a valid admin session and survives session errors', async () => {
  assert.equal(await decideAutomationAuth(req(UI, ownerHeaders), opts(false).o), null);
  const throwing = {expectedToken: '', ownerEmail: OWNER, hasAdminSession: async () => { throw new Error('db down'); }};
  assert.equal(await decideAutomationAuth(req(UI, ownerHeaders), throwing), null);
  assert.equal(await decideAutomationAuth(req(UI, ownerHeaders), {...opts(true).o, ownerEmail: ''}), null, 'unset owner email disables the path');
});

test('owner email comparison is case-insensitive like ownerIdentity', async () => {
  const r = req(UI, {...ownerHeaders, 'cf-access-authenticated-user-email': ' Owner@Example.COM '});
  assert.equal(await decideAutomationAuth(r, opts(true).o), 'owner-session');
});

test('bearer token path: valid token works anywhere; wrong or unset token never falls back to session', async () => {
  const good = req(O + '/api/internal/automation', {authorization: 'Bearer ' + TOKEN});
  assert.equal(await decideAutomationAuth(good, opts(false, TOKEN).o), 'token');
  const wrong = req(UI, {...ownerHeaders, authorization: 'Bearer ' + 'b'.repeat(40)});
  const w = opts(true, TOKEN);
  assert.equal(await decideAutomationAuth(wrong, w.o), null);
  assert.equal(w.calls(), 0);
  assert.equal(await decideAutomationAuth(req(UI, {...ownerHeaders, authorization: 'Bearer ' + TOKEN}), opts(true, '').o), null, 'unset token rejects any bearer');
  assert.equal(await decideAutomationAuth(req(UI, {authorization: 'Bearer short'}), opts(true, 'short').o), null, 'malformed bearer');
  assert.equal(await decideAutomationAuth(req(UI, {authorization: 'Basic ' + TOKEN}), opts(true, TOKEN).o), null);
});

test('equalSecret is exact and rejects empty values', async () => {
  assert.equal(await equalSecret(TOKEN, TOKEN), true);
  assert.equal(await equalSecret(TOKEN, TOKEN + 'x'), false);
  assert.equal(await equalSecret('', ''), false);
  assert.equal(await equalSecret(TOKEN, ''), false);
});

test('owner session allowlist excludes long or state-enabling actions', () => {
  for (const a of ['daily-archive-status', 'status', 'screener-operations', 'runtime-ready', 'followup-acceptance-status', 'followup-acceptance-start', 'followup-step'])
    assert.equal(ownerSessionActionAllowed(a), true, a);
  for (const a of ['followup-run', 'followup-accept', 'collect', 'seed', 'resolve', 'council', '', 'unknown', undefined, 42])
    assert.equal(ownerSessionActionAllowed(a), false, String(a));
});

test('route keeps the auth gate first and enforces the allowlist before any action', async () => {
  const route = await readFile(new URL('../app/api/internal/automation/route.ts', import.meta.url), 'utf8');
  const gate = route.indexOf('if(!await authorized(req))');
  const allow = route.indexOf("decisions.get(req)==='owner-session'&&!ownerSessionActionAllowed(action)");
  assert.ok(gate > 0 && allow > gate);
  assert.ok(allow < route.indexOf("if(action==='daily-archive-status')"));
  const ui = await readFile(new URL('../app/api/admin/tools/automation/route.ts', import.meta.url), 'utf8');
  assert.ok(ui.includes("export {POST} from '../../../internal/automation/route'"));
});

test('UI caps: evaluation limit and backtest inputs', () => {
  assert.equal(clampEvaluateLimit(100), EVALUATE_LIMIT_MAX);
  assert.equal(clampEvaluateLimit(0), 1);
  assert.equal(clampEvaluateLimit('3'), 3);
  assert.equal(clampEvaluateLimit('x'), 2);
  const base = {symbols: 'AAPL', startDate: '2025-01-01', endDate: '2025-06-30', horizons: [5, 21], commissionBps: 5, slippageBps: 10, doubleSided: true, minSessions: 200};
  const ok = validateBacktestForm(base, '2026-10-17');
  assert.ok(ok.ok && Array.isArray(ok.value.symbols) && ok.value.mode === 'single');
  assert.equal(validateBacktestForm({...base, symbols: 'AAPL MSFT TSLA'}, '2026-10-17').ok, false);
  assert.equal(validateBacktestForm({...base, symbols: '2222'}, '2026-10-17').ok, false);
  assert.ok(validateBacktestForm({...base, symbols: '2222.sr'}, '2026-10-17').ok);
  assert.equal(validateBacktestForm({...base, endDate: '2026-10-17'}, '2026-10-17').ok, false);
  assert.equal(validateBacktestForm({...base, horizons: [7]}, '2026-10-17').ok, false);
  assert.equal(validateBacktestForm({...base, commissionBps: 2000}, '2026-10-17').ok, false);
  const wf = validateWalkForward(base, [{trainStart: '2024-01-01', trainEnd: '2024-12-31', testStart: '2025-01-02', testEnd: '2025-03-31'}], '2026-10-17');
  assert.ok(wf.ok && wf.value.mode === 'walk-forward' && !('startDate' in wf.value));
  const three = Array.from({length: 3}, (_, i) => ({trainStart: '2023-01-01', trainEnd: '2023-12-31', testStart: `2024-0${i * 3 + 1}-01`, testEnd: `2024-0${i * 3 + 2}-28`}));
  assert.equal(validateWalkForward(base, three, '2026-10-17').ok, false);
  assert.equal(validateWalkForward({...base, symbols: 'AAPL MSFT'}, three.slice(0, 1), '2026-10-17').ok, false);
});

test('HTTP status classification drives the sign-in guidance', () => {
  assert.equal(classifyAdminStatus(0), 'access');
  assert.equal(classifyAdminStatus(401), 'session');
  assert.equal(classifyAdminStatus(403), 'owner');
  assert.equal(classifyAdminStatus(409), 'locked');
  assert.equal(classifyAdminStatus(400), 'input');
  assert.equal(classifyAdminStatus(500), 'server');
});
