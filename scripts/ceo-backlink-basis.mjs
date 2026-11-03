// Backlinks basis snapshots for the Monday brief (QUESTION 2026-11-03 item 1). No DataForSEO calls.
//   node scripts/ceo-backlink-basis.mjs --save-week 2026-11-02   store that week's live-only figures (rows must be unchanged since)
//   node scripts/ceo-backlink-basis.mjs --dry-week 2026-11-09 --out <html>   dry render: last week's snapshot vs today's rows
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { weekOnWeekBlocks } from '../lib/ceo-weekly/metrics.js';
import { saveBasisSnapshot, loadBasisSnapshot } from '../lib/ceo-weekly/backlink-basis.js';
import { renderCeoWeeklyHtml } from '../lib/ceo-weekly/email.js';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const m of env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const P = 'https://www.alanranger.com';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: state } = await sb.from('dfs_backlink_ingest_state').select('last_ingest_action, last_ingest_at, last_full_at, filters_version, approx_row_count').eq('domain_host', 'alanranger.com').maybeSingle();
console.log('ingest state', JSON.stringify(state));

if (arg('save-week')) {
  const week = arg('save-week');
  // weekOnWeekBlocks(week + 7) builds this-week figures from the current rows (prior = `week`, unused here).
  const next = new Date(Date.parse(`${week}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const { backlinks } = await weekOnWeekBlocks(sb, next);
  console.log('save', week, JSON.stringify(await saveBasisSnapshot(sb, P, week, backlinks)), backlinks.index_basis?.tag,
    `rd ${backlinks.referring_domains} · bl ${backlinks.backlinks} · df ${backlinks.dofollow} · nf ${backlinks.nofollow}`);
}

if (arg('dry-week')) {
  const week = arg('dry-week');
  const { backlinks, prior_week_start: priorWeek } = await weekOnWeekBlocks(sb, week);
  const snap = await loadBasisSnapshot(sb, P, priorWeek);
  console.log(`last week ${priorWeek} tag ${snap?.basis_tag} · this week tag ${backlinks.index_basis?.tag} · comparable ${JSON.stringify(backlinks.comparable)}`);
  for (const k of ['referring_domains', 'backlinks', 'dofollow', 'nofollow', 'spam_score', 'rank']) console.log(`  ${k}: ${backlinks[k]} · ${JSON.stringify(backlinks.wow[k])}`);
  for (const b of backlinks.da_bands) console.log(`  band ${b.label}: ${b.dofollow} · ${b.wow_dofollow.label}`);
  console.log('  new DA>=50 links:', JSON.stringify(backlinks.new_links));
  const html = renderCeoWeeklyHtml({ generated_at: `${week}T09:00:00Z`, backlinks, strategy: { error: 'dry backlinks-only render' }, section_g: { error: 'dry backlinks-only render' } });
  const from = html.lastIndexOf('<tr>', html.indexOf('Backlinks &amp; authority'));
  const rows = html.slice(from, html.lastIndexOf('<tr>', html.indexOf('>SEO health<')));
  if (arg('out')) fs.writeFileSync(arg('out'), `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial;background:#eef1f5"><table width="600" align="center" style="background:#fff">${rows}</table><p style="width:600px;margin:8px auto;font-size:11px;color:#667085">Dry render for ${week}: last week = ${priorWeek} basis snapshot (${snap?.basis_tag}); this week = stored rows today (${backlinks.index_basis?.tag}). No API call.</p></body></html>`);
}
