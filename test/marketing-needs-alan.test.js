/**
 * Tile 7 (Needs Alan): quarter actions count as Alan's only when their initiative's owner is Alan (or no owner is
 * recorded); the rest are shown by owner ("GPT: 2 · Claude: 1"), never under Needs Alan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function tiles() {
  const win = {};
  const document = { getElementById: () => null, querySelector: () => null, head: { insertAdjacentHTML: () => {} } };
  const c = vm.createContext({ window: win, document, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, setTimeout });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-overview-tiles.js', import.meta.url), 'utf8'), c);
  return win.mkOverviewTiles;
}
const act = (action_key, label, due, extra = {}) => ({ id: action_key, action_key, label, due_week_start: due, is_ticked: false, ...extra });

test('tile 6: two bars (approved solid, drafts hatched), zero segments hidden but kept in the tooltip, detail folded', () => {
  const pm = { window: { from: '2026-11-02', to: '2026-11-29' }, deliveries: 20, by_primary: { sell: 15, educate: 2, inspire: 3, nurture: 0 }, set_by_hand: 1, by_rule: 19, draft: { deliveries: 12, by_primary: { sell: 7, educate: 3, inspire: 1, nurture: 1 } }, modules: { total: 21, by_purpose: { sell: 19, educate: 2 } } };
  const T = tiles();
  const html = T.tileHtml(T.tileMix({ quarter_plan: { purpose_mix: pm } }));
  assert.match(html, /20 <span class="mko-unit">deliveries · next 4 weeks<\/span>/);
  assert.match(html, /\+12 drafts/);
  assert.equal((html.match(/class="mko-seg p-nurture"/g) || []).length, 0, 'approved Nurture 0: no segment');
  assert.equal((html.match(/class="mko-seg p-nurture hatch"/g) || []).length, 1, 'draft Nurture 1: hatched segment');
  assert.match(html, /title="Scheduled \/ approved: Sell 15 · Educate 2 · Inspire 3 · Nurture 0"/);
  assert.match(html, /Drafts \(not approved\): Sell 7/);
  assert.match(html, /<details class="mko-det"><summary>details<\/summary>/);
});

test('tile 9: the denominator line fills from the client-health summary (the slim summary, not the panel)', () => {
  const summary = { can_email: 673, can_email_people: 669, owner_addresses: 3, organisations: 1, gap: 0, recent_not_eligible: { total: 0 } };
  const t = tiles().tileAudience({ identity: { subscribed_unsuppressed: 673 }, runs: {} }, { state: 'ok', data: summary });
  assert.match(t.lines[0], /= 669 people \+ 3 own addresses \+ 1 organisation</);
  assert.ok(!/…/.test(t.lines[0]));
});

test('Needs Alan counts only Alan-owned (or unowned) actions; others are listed by owner', () => {
  const s = {
    actions: [
      act('a-alan-late', 'Approve the gift copy', '2026-10-26'),
      act('a-none-late', 'Check the diary', '2026-10-19'),
      act('a-gpt-late', 'Draft the Macro posts', '2026-10-26'),
      act('a-gpt-next', 'Draft the gift posts', '2027-01-04'),
      act('a-claude-late', 'Link the Academy deliveries', '2026-10-26')
    ],
    quarter_plan: { action_owner: { 'a-alan-late': 'Alan', 'a-gpt-late': 'GPT', 'a-gpt-next': 'GPT', 'a-claude-late': 'Claude' } },
    campaign: { campaigns: [], step_status: { late_campaign: 0 } }
  };
  const t = tiles().tileNeedsAlan({ identity: {}, tiles: { cleanup: { frozen: [] } } }, s);
  const late = t.lines.find((l) => /late:/.test(l));
  assert.match(late, /2 late:<\/span> Check the diary/, 'Alan-owned + unowned only, oldest first');
  assert.ok(t.lines.some((l) => /Owned elsewhere \(not Needs Alan\): GPT: 2 · Claude: 1/.test(l)));
  assert.ok(!t.lines.some((l) => /Macro posts|Academy deliveries/.test(l)), 'other owners\' actions are not listed as Alan\'s');
});
