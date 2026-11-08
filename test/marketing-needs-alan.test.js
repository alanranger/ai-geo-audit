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
