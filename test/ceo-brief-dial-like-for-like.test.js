/**
 * 9 Nov 2026 corrected brief: the Surface / Top of page week-on-week uses the stored same-keyword comparison
 * (2 Nov overnight 18 / 25 → 9 Nov 21 / 27, 94 keywords), not the stored rows (2 Nov daytime re-run 33 / 41 → 21 / 26).
 * The corrected resend goes once per (week, onceKey) and keeps the provider message id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dialBasisNote, dialScore, likeForLikeOf, withLikeForLike } from '../lib/ceo-weekly/dial-like-for-like.js';
import { assessBriefGate } from '../lib/ceo-weekly/brief-gate.js';
import { BRIEF_GATE } from '../lib/ceo-weekly/brief-gate-config.js';
import { renderCeoWeeklyHtml } from '../lib/ceo-weekly/email.js';
import { claimOnce, finishOnce, onceStateKey, sendRecord, validOnceKey } from '../lib/ceo-weekly/send-once.js';

const NOTE = '2 Nov published 33 / 41 was a daytime re-run; the like-for-like overnight comparison is shown.';
const nov9 = {
  audit_date: '2026-11-09', surface_visibility_score: 21, top_of_page_score: 26, ranking_quality: 'complete',
  ranking_quality_detail: { stability: { prior_audit_date: '2026-11-02', cohort: { size: 94, keywords: 94, like_for_like: {
    keywords: 94, note: NOTE,
    prior: { surface_visibility_score: 18, top_of_page_score: 25 },
    current: { surface_visibility_score: 21, top_of_page_score: 27 },
  } } } },
};
const storedChip = (value, prev) => ({ value, wow: { delta: value - prev, arrow: '▼', label: `▼ ${prev - value}` }, stale: false, withheld: false, audit_date: '2026-11-09', vs_audit_date: '2026-11-02' });

test('stored like-for-like replaces the two audit rows for both dials', () => {
  const lfl = likeForLikeOf(nov9);
  const surface = withLikeForLike(storedChip(21, 33), lfl, 'surface_visibility_score');
  const top = withLikeForLike(storedChip(26, 41), lfl, 'top_of_page_score');
  assert.deepEqual([surface.value, surface.prior_value, surface.wow.delta, surface.wow.label], [21, 18, 3, '▲ 3']);
  assert.deepEqual([top.value, top.prior_value, top.wow.delta, top.wow.label], [27, 25, 2, '▲ 2']);
  assert.equal(top.vs_audit_date, '2026-11-02');
  assert.equal(top.like_for_like_keywords, 94);
  assert.equal(dialScore(top, nov9, 'top_of_page_score'), 27);
  assert.equal(dialBasisNote({ surface_vis: surface, top_of_page: top }), NOTE);
});

test('no stored comparison, a stale or a withheld chip: unchanged', () => {
  const plain = { ...nov9, ranking_quality_detail: {} };
  assert.equal(likeForLikeOf(plain), null);
  const chip = storedChip(26, 41);
  assert.equal(withLikeForLike(chip, null, 'top_of_page_score'), chip);
  assert.equal(dialScore(chip, plain, 'top_of_page_score'), 26);
  const lfl = likeForLikeOf(nov9);
  const stale = { ...chip, stale: true };
  const withheld = { ...chip, withheld: true };
  assert.equal(withLikeForLike(stale, lfl, 'top_of_page_score'), stale);
  assert.equal(withLikeForLike(withheld, lfl, 'top_of_page_score'), withheld);
  assert.equal(dialBasisNote({ surface_vis: chip, top_of_page: chip }), '');
});

test('gate: the like-for-like pair passes; the stored re-run pair is what held 9 Nov', () => {
  const steps = BRIEF_GATE.requiredSteps.map((key) => ({ key, ok: true }));
  const base = { rankingRows: [], shownFindings: [], latestFullRunStart: null, steps };
  const previous = { surface_visibility_score: 33, top_of_page_score: 41, top10: 39, ranking_quality: 'complete' };
  const held = assessBriefGate({ ...base, previous, current: { ...nov9, ranking_quality_detail: {}, top10: 36 } });
  assert.deepEqual(held.failures.map((f) => f.id).sort(), ['dial_move_surface_visibility_score', 'dial_move_top_of_page_score']);
  const lfl = assessBriefGate({ ...base, previous, current: { ...nov9, top10: 36 } });
  assert.equal(lfl.held, false, JSON.stringify(lfl.failures));
  assert.match(lfl.checks.find((c) => c.id === 'dial_move_top_of_page_score').detail, /25 → 27 \(\+8%\).*same 94 keywords/);
});

test('rendered brief: like-for-like chips and the one explanatory line', () => {
  const lfl = likeForLikeOf(nov9);
  const chips = {
    surface_vis: withLikeForLike(storedChip(21, 33), lfl, 'surface_visibility_score'),
    top_of_page: withLikeForLike(storedChip(26, 41), lfl, 'top_of_page_score'),
  };
  const html = renderCeoWeeklyHtml({ generated_at: '2026-11-09T18:00:00Z', strategy: { error: 'x' }, section_g: { error: 'x' }, chips });
  assert.match(html, />21<\/div><div[^>]*>surface vis ▲3</);
  assert.match(html, />27<\/div><div[^>]*>top of page ▲2</);
  assert.equal(html.split(NOTE).length - 1, 1);
  assert.doesNotMatch(html, /▼12|▼15/);
});

function fakeStateTable() {
  const rows = new Map();
  const sb = {
    from: () => ({
      insert: async (row) => (rows.has(row.key) ? { error: { message: 'duplicate key value violates unique constraint' } } : (rows.set(row.key, { ...row }), { error: null })),
      select: () => ({ eq: (_c, key) => ({ maybeSingle: async () => ({ data: rows.get(key) || null }) }) }),
      update: (patch) => ({ eq: async (_c, key) => { rows.set(key, { ...rows.get(key), ...patch }); return { error: null }; } }),
    }),
  };
  return { sb, rows };
}

test('one-shot resend: first claim sends and records the message id; a repeat is refused', async () => {
  const { sb, rows } = fakeStateTable();
  assert.equal(validOnceKey('lfl-dials-resend'), true);
  assert.equal(validOnceKey('bad key!'), false);
  const first = await claimOnce(sb, '2026-11-09', 'lfl-dials-resend');
  assert.equal(first.claimed, true);
  const report = { mode: 'report', snapshot: { id: 's1' }, send: { ok: true, provider: 'smtp', id: '<abc@mail>', to: 'alan@example.test', subject: 'CEO weekly' } };
  const record = sendRecord(report, '2026-11-09T18:00:00Z');
  assert.deepEqual([record.ok, record.message_id, record.to, record.provider], [true, '<abc@mail>', 'alan@example.test', 'smtp']);
  await finishOnce(sb, first.key, { week_start: '2026-11-09', once_key: 'lfl-dials-resend' }, record);
  const second = await claimOnce(sb, '2026-11-09', 'lfl-dials-resend');
  assert.equal(second.claimed, false);
  assert.equal(second.prior.state, 'done');
  assert.equal(second.prior.last_details.message_id, '<abc@mail>');
  assert.equal(rows.size, 1);
  assert.equal(onceStateKey('2026-11-09', 'lfl-dials-resend'), 'ceo_brief_once:2026-11-09:lfl-dials-resend');
});

test('a dry run or a failed send is not recorded as sent', () => {
  assert.equal(sendRecord({ mode: 'report', send: { ok: true, dryRun: true } }).ok, false);
  assert.equal(sendRecord({ mode: 'fail_safe', send: { ok: true, id: 'x' } }).ok, false);
});
