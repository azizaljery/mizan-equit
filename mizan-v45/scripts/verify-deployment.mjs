#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SITE = 'https://mizan-equity.aljeryabod.workers.dev';
export const LEGACY_SITE = 'https://mizan-equity.aljeryabod.chatgpt.site';
const DATABASE = 'e95b74e8-81d6-4beb-8ea2-ad59c863d21d';
const SCRIPT = 'mizan-equity';
const MAX_BYTES = 2_000_000;
export const QUERIES = Object.freeze({
  forecastRecords: `SELECT horizon,market,model,COUNT(*) AS total_records,SUM(available=1) AS available_count,SUM(available=0) AS unavailable_count FROM forecast_records GROUP BY horizon,market,model ORDER BY horizon,market,model LIMIT 500`,
  forecastOutcomes: `SELECT f.horizon,f.market,f.model,CASE WHEN json_valid(o.data) THEN json_extract(o.data,'$.state') ELSE 'invalid-json' END AS state,COUNT(*) AS outcomes,MIN(o.evaluated_at) AS oldest_evaluation,MAX(o.evaluated_at) AS newest_evaluation FROM forecast_outcomes o JOIN forecast_records f ON f.id=o.id GROUP BY f.horizon,f.market,f.model,state ORDER BY f.horizon,f.market,f.model,state LIMIT 500`,
  accuracyRows: `SELECT state,COUNT(*) AS rows FROM accuracy_rows GROUP BY state LIMIT 30`,
  watchlist: `SELECT market,COUNT(DISTINCT symbol) AS watched_symbols FROM customer_market_watch GROUP BY market LIMIT 20`,
  observations: `SELECT market,COUNT(*) AS observations,COUNT(DISTINCT symbol) AS symbols,MIN(observed_at) AS oldest_observation,MAX(observed_at) AS newest_observation FROM market_observations GROUP BY market LIMIT 20`,
  dataCenterState: `SELECT id,updated_at,json_extract(data,'$.status') AS status,json_extract(data,'$.observationsSaved') AS observations_saved,json_extract(data,'$.analysesRecorded') AS analyses_recorded FROM research_state WHERE id IN ('job:market-collector:last','job:forecast-seed:last') AND json_valid(data) ORDER BY id`,
  councilRuns: `SELECT id,created_at,updated_at,trigger,status,json_extract(data,'$.version') AS version,json_extract(data,'$.securityReviewer.decision.decision') AS security_decision FROM council_runs ORDER BY created_at DESC LIMIT 5`,
  heartbeats: `SELECT id,updated_at,json_extract(data,'$.enabled') AS enabled,json_extract(data,'$.evaluation.state') AS resolution_state,json_extract(data,'$.evaluation.evaluationsSaved') AS evaluations_saved,json_extract(data,'$.accuracyEvaluation.state') AS accuracy_state,json_extract(data,'$.accuracyEvaluation.rowsAdvanced') AS rows_advanced,json_extract(data,'$.accuracyEvaluation.rowsFailed') AS rows_failed FROM research_state WHERE id IN ('job:cron:heartbeat:last-arrival','job:cron:heartbeat:last-evaluation','job:cron:heartbeat:last-save-failure','job:accuracy-cron:heartbeat:last-arrival','job:accuracy-cron:heartbeat:last-evaluation','job:accuracy-cron:heartbeat:last-save-failure') AND json_valid(data) ORDER BY id`,
});

function validSha(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('A full Git commit SHA is required.');
  return sha;
}
export async function requestText(url, init = {}, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('response-too-large');
    const reader = response.body?.getReader(); let text = '', size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > MAX_BYTES) throw new Error('response-too-large');
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
    }
    return { status: response.status, type: response.headers.get('content-type') || '', text };
  } finally { clearTimeout(timer); }
}
export async function checkSite(origin, expectedSha, fetcher = fetch) {
  if (![SITE, LEGACY_SITE].includes(origin)) throw new Error('Unapproved website.');
  validSha(expectedSha); const checks = [];
  const specifications = [
    { path: '/', valid: r => r.status === 200 && r.type.includes('text/html') && /href=["']\/screener["']/.test(r.text) },
    { path: '/screener', valid: r => r.status === 200 && r.type.includes('text/html') && r.text.includes('فرز توقعات الأسهم') },
    { path: '/mizan-deployment.json', valid: r => {
      if (r.status !== 200 || !r.type.includes('json')) return false;
      try { const m = JSON.parse(r.text); return m.commit === expectedSha && m.worker === SCRIPT; } catch { return false; }
    } },
  ];
  for (const spec of specifications) {
    try {
      const r = await requestText(`${origin}${spec.path}?deployment=${expectedSha}`, { headers: { Accept: spec.path.endsWith('.json') ? 'application/json' : 'text/html', 'Cache-Control': 'no-cache' } }, fetcher);
      checks.push({ path: spec.path, httpStatus: r.status, ok: spec.valid(r) });
    } catch { checks.push({ path: spec.path, httpStatus: null, ok: false, reason: 'network-timeout-or-invalid-response' }); }
  }
  if (origin === SITE) {
    try {
      const r = await requestText(`${origin}/api/screener`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' }, fetcher);
      let valid = false; try { valid = r.status === 400 && r.type.includes('json') && JSON.parse(r.text).error === 'السوق غير مدعوم.'; } catch {}
      checks.push({ path: '/api/screener (invalid request)', httpStatus: r.status, ok: valid });
    } catch { checks.push({ path: '/api/screener (invalid request)', httpStatus: null, ok: false, reason: 'network-timeout-or-invalid-response' }); }
  }
  return { origin, expectedSha, ok: checks.every(c => c.ok), checks };
}
export function summarizeBindings(result) {
  if (!Array.isArray(result?.bindings)) throw new Error('invalid-settings');
  const has = name => result.bindings.some(b => b.name === name);
  const flag = result.bindings.find(b => b.name === 'MIZAN_BACKGROUND_CRON_ENABLED');
  const db = result.bindings.find(b => b.name === 'DB' && b.type === 'd1');
  return {
    worker: SCRIPT,
    databaseBindingMatches: !!db && (db.id ?? db.database_id) === DATABASE,
    backgroundCronFlag: !flag ? 'missing' : flag.type === 'plain_text' ? (flag.text === 'true' ? 'enabled' : 'disabled') : 'present-value-not-readable',
    councilProviders: { openai: has('OPENAI_API_KEY'), anthropic: has('ANTHROPIC_API_KEY'), deepseek: has('DEEPSEEK_API_KEY') },
    internalAutomationConfigured: has('MIZAN_INTERNAL_AUTOMATION_TOKEN'),
  };
}
export async function auditRuntime(env = process.env, fetcher = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) return { status: 'unavailable', reason: 'missing-or-invalid-credentials', sections: {} };
  const sections = {};
  async function api(path, sql) {
    const response = await requestText(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
      method: sql ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(sql ? { body: JSON.stringify({ sql, params: [] }) } : {}),
    }, fetcher);
    if (response.status !== 200) throw new Error(`cloudflare-http-${response.status}`);
    let data; try { data = JSON.parse(response.text); } catch { throw new Error('invalid-cloudflare-json'); }
    if (data.success !== true) throw new Error('cloudflare-request-failed'); return data.result;
  }
  async function capture(name, task) { try { sections[name] = { status: 'ok', data: await task() }; } catch { sections[name] = { status: 'unavailable', reason: 'request-denied-failed-or-schema-missing' }; } }
  await capture('settings', async () => summarizeBindings(await api(`/workers/scripts/${SCRIPT}/settings`)));
  await capture('schedules', async () => {
    const result = await api(`/workers/scripts/${SCRIPT}/schedules`); const rows = Array.isArray(result) ? result : result?.schedules;
    if (!Array.isArray(rows)) throw new Error('invalid-schedules'); return rows.map(r => ({ cron: r.cron, createdOn: r.created_on ?? null }));
  });
  for (const [name, sql] of Object.entries(QUERIES)) {
    await capture(name, async () => {
      if (!/^SELECT\s/i.test(sql) || sql.includes(';')) throw new Error('non-read-only-query');
      const result = await api(`/d1/database/${DATABASE}/query`, sql);
      if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true || !Array.isArray(result[0].results)) throw new Error('invalid-d1-result');
      if (Number(result[0].meta?.rows_written || 0) !== 0) throw new Error('unexpected-write'); return result[0].results;
    });
  }
  return { status: Object.values(sections).every(s => s.status === 'ok') ? 'ok' : 'partial', sections };
}
async function main() {
  const mode = process.argv[2];
  if (mode === '--mark') {
    const commit = validSha(process.env.GITHUB_SHA); await mkdir('public', { recursive: true });
    await writeFile('public/mizan-deployment.json', JSON.stringify({ worker: SCRIPT, commit, generatedAt: new Date().toISOString() }) + '\n'); return;
  }
  if (!['--verify', '--audit'].includes(mode)) throw new Error('Use --mark, --verify or --audit.');
  await mkdir('verify-out', { recursive: true });
  if (mode === '--audit') {
    const audit = await auditRuntime(); await writeFile('verify-out/runtime-audit.json', JSON.stringify(audit, null, 2) + '\n');
    console.log('MIZAN_RUNTIME_AUDIT=' + JSON.stringify(audit));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Read-only runtime audit\n\nStatus: ${audit.status}. No jobs started, SQL writes, or configuration changes.\n`);
    return;
  }
  const sha = validSha(process.env.GITHUB_SHA); let production;
  for (let attempt = 1; attempt <= 3; attempt++) {
    production = { ...await checkSite(SITE, sha), attempt }; if (production.ok || attempt === 3) break;
    await new Promise(done => setTimeout(done, 10_000));
  }
  const legacy = await checkSite(LEGACY_SITE, sha);
  const report = { checkedAt: new Date().toISOString(), production, legacy, scope: 'HTTP routing and release identity; not browser interaction or forecasting accuracy.' };
  await writeFile('verify-out/deployment.json', JSON.stringify(report, null, 2) + '\n'); console.log('MIZAN_DEPLOYMENT_VERIFICATION=' + JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\n## Verified deployment\n\nCommit: \`${sha}\`\n\nWorker: ${production.ok ? 'PASS' : 'FAIL'} — [Open Mizan](${SITE}) · [Stock screener](${SITE}/screener)\n\nLegacy chatgpt.site: ${legacy.ok ? 'same release verified' : 'not verified as this release; do not use as proof of deployment'}\n\nScope: ${report.scope}\n`);
  if (!production.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Mizan verification failed; no credentials or response bodies have been logged.'); process.exitCode = 1; });
