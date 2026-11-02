/**
 * Guards for the Monday Full refresh catalog (2 Nov 2026). On 30 Oct (e572c2ea) the extractability + schema QA sync
 * step was silently replaced by the rendered ① and its runner left unused — these tests would have caught it.
 * fetch is stubbed: no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDashboardFullSteps, runFullStep, STEP_RUNNERS } from '../lib/ceo-weekly/dashboard-full-catalog.js';

/** Runners kept on purpose without a step, with the reason. Anything else unused fails. */
const RETIRED = { silent_faults: 'folded into Traditional SEO ① on 30 Oct (e572c2ea); the step stays as ui_noop' };
const HANDLED_BY_CRON = new Set(['email']);

const steps = buildDashboardFullSteps();
const keys = steps.map((s) => s.key);

function stubFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body || '{}') });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, run_id: 'r1', data: { rows: [] } }) };
  };
  return calls;
}

test('catalog: extractability + schema QA sync is its own step, after audit_scan and schema_qa, before the rendered ①', () => {
  const ext = keys.indexOf('content_extractability_sync');
  const render = keys.indexOf('trad_seo_render');
  assert.ok(ext > keys.indexOf('audit_scan') && ext > keys.indexOf('schema_qa'), 'after audit_scan and schema_qa');
  assert.equal(render, ext + 1, 'immediately before the rendered ①');
  assert.equal(keys.indexOf('trad_seo_broken_links'), render + 1);
  assert.equal(steps[ext].kind, 'trad_seo_full');
  assert.equal(steps[render].kind, 'trad_seo_render');
  assert.deepEqual(steps[render + 1].dependsOn, ['trad_seo_render']);
  assert.ok(!keys.includes('trad_seo_full'), 'the key trad_seo_full no longer names the rendered ①');
});

test('dispatch: the extractability step calls content-extractability then the schema QA sync; the ① step calls start', async () => {
  const calls = stubFetch();
  await runFullStep(steps[keys.indexOf('content_extractability_sync')], { base: 'https://x', headers: {}, propertyUrl: 'sc-domain:alanranger.com', progress: {} });
  assert.match(calls[0].url, /\/api\/aigeo\/content-extractability\?tier=all/);
  assert.match(calls[1].url, /\/api\/aigeo\/traditional-seo-sync-schema-qa$/);
  const calls2 = stubFetch();
  await runFullStep(steps[keys.indexOf('trad_seo_render')], { base: 'https://x', headers: {}, progress: {} });
  assert.match(calls2[0].url, /\/api\/aigeo\/traditional-seo-render$/);
  assert.equal(calls2[0].body.action, 'start');
});

test('guard: every step kind has a runner, and every runner is used by a step (or is named retired)', () => {
  for (const s of steps) {
    const ok = (s.kind && (STEP_RUNNERS[s.kind] || HANDLED_BY_CRON.has(s.kind))) || (!s.kind && s.method && s.path);
    assert.ok(ok, `${s.key}: kind ${s.kind || '(none)'} has no runner`);
  }
  const used = new Set(steps.map((s) => s.kind).filter(Boolean));
  const unused = Object.keys(STEP_RUNNERS).filter((k) => !used.has(k) && !RETIRED[k]);
  assert.deepEqual(unused, [], 'runner(s) with no step: a step was dropped or re-pointed');
});

test('dashboard Full refresh runs the same steps, in the same order, as the Monday cron', () => {
  const html = fs.readFileSync(new URL('../audit-dashboard.html', import.meta.url), 'utf8');
  const block = html.slice(html.indexOf('/** Single source of truth. Each entry: key, label, tiers, dependsOn, runner. */'));
  const list = block.slice(0, block.indexOf('];'));
  const full = [...list.matchAll(/\{ key: '([\w]+)', label: '[^']*', tiers: \[([^\]]*)\]/g)].filter((m) => m[2].includes("'full'")).map((m) => m[1]);
  assert.deepEqual(full, keys);
});
