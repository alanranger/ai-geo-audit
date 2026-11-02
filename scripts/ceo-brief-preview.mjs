// Render the Monday brief to a file — PREVIEW ONLY, never sends.
//   node scripts/ceo-brief-preview.mjs --week 2026-11-02 --out <file.html> [--live]
// Default: that week's stored ceo_weekly_report_snapshots.metrics (same figures as the email that week),
// with the profit levers and the redesign blocks (pipeline, Sales tab, tiles, cards, system health)
// computed as at the snapshot's generated_at. --live builds every metric fresh (no send, no snapshot write).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buildSectionG } from '../lib/ceo-weekly/sectionG.js';
import { attachRedesign } from '../lib/ceo-weekly/redesign-data.js';
import { buildCeoWeeklyMetrics } from '../lib/ceo-weekly/metrics.js';
import { renderCeoWeeklyHtml } from '../lib/ceo-weekly/email.js';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const m of env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
  if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const week = arg('week', '2026-11-02');
const out = arg('out', `C:/TEMP/ceo-redesign/preview-${week}.html`);
const property = 'https://www.alanranger.com';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fromSnapshot() {
  const { data, error } = await sb.from('ceo_weekly_report_snapshots').select('metrics').eq('week_start', week).maybeSingle();
  if (error || !data?.metrics) throw new Error(`no snapshot metrics for ${week}`);
  const metrics = data.metrics;
  const asOf = metrics.generated_at;
  metrics.section_g = await buildSectionG(sb, { propertyUrl: property, asOf });
  await attachRedesign(sb, metrics, { propertyUrl: property, weekStart: week, asOf });
  return metrics;
}

/** --mask-names: "Derek B." in the pipeline (preview files shared outside the email never carry full client names). */
function maskNames(metrics) {
  const short = (n) => {
    const parts = String(n || '').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  };
  for (const w of metrics.pipeline?.windows || []) {
    for (const r of w.rows) for (const p of r.who) if (!p.jlr) p.name = short(p.name);
  }
  for (const f of metrics.pipeline?.flags || []) f.name = short(f.name);
}

const metrics = process.argv.includes('--live')
  ? await buildCeoWeeklyMetrics(sb, { weekStart: week, propertyUrl: property })
  : await fromSnapshot();
if (process.argv.includes('--mask-names')) maskNames(metrics);
const html = renderCeoWeeklyHtml(metrics);
fs.writeFileSync(out, html, 'utf8');
fs.writeFileSync(out.replace(/\.html$/, '.metrics.json'), JSON.stringify(metrics, null, 1), 'utf8');
console.log(`preview written ${out} (${html.length} chars) · front ${metrics.front?.error || 'ok'} · gate ${metrics.brief_gate?.held ? 'HELD' : 'pass'}`);
