/**
 * Links the Light & Logic promotion modules already inside the 19 Nov / 17 Dec email drafts to their edition rows
 * (15 Nov / 15 Dec), through the existing app path: POST /api/aigeo/strategy-initiatives { type: 'asset' } →
 * public.strategy_content_assets (history appended). One content asset per module, used_in =
 * newsletter|light-and-logic + send|<campaign_key> + delivery|<edition step_key>. No sends, no new tables.
 *   node scripts/content/link-light-logic-promotions.mjs            dry run (prints the rows)
 *   node scripts/content/link-light-logic-promotions.mjs --write    writes them (idempotent: unchanged rows stay)
 */
import fs from 'node:fs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = process.env.BASE || 'https://ai-geo-audit.vercel.app';
const SOURCE = 'GPT live audit 9 Nov 13:07 (QUESTION-2026-11-09-live-audit-corrections-1307 item 2)';
const MODULES = [
  { edition: '2026-11-15', month: 'November', campaign: 'theme|gpt-8w-2026-11-19', email: '19 Nov' },
  { edition: '2026-12-15', month: 'December', campaign: 'theme|gpt-8w-2026-12-17', email: '17 Dec' }
];
const rowOf = (m) => ({
  type: 'asset', via: 'claude', asset_key: `module|light-and-logic|${m.edition}`, kind: 'email', status: 'draft', reuse: false,
  title: `Light & Logic ${m.month} edition: promotion module in the ${m.email} email`,
  used_in: ['newsletter|light-and-logic', `send|${m.campaign}`, `delivery|gpt-ll-newsletter-${m.edition}`],
  note: `Light & Logic ${m.month} edition promotion module, already in the ${m.email} provider draft. Rides on that email's own sends (budgeted once); the newsletter never uses Squarespace credits. Source: ${SOURCE}.`
});

const rows = MODULES.map(rowOf);
if (!process.argv.includes('--write')) {
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}
for (const r of rows) {
  const res = await fetch(`${BASE}/api/aigeo/strategy-initiatives`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': ENV.ARP_ADMIN_KEY }, body: JSON.stringify(r) });
  const j = await res.json().catch(() => ({}));
  console.log(r.asset_key, res.status, j.ok ? `ok · created ${j.created} · changes ${Object.keys(j.changes || {}).join(',') || 'none'}` : j.error);
}
