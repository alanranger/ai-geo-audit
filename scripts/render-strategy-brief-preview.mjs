/**
 * Render Monday brief Strategy Scorecard HTML with live data (for screenshot).
 * node scripts/render-strategy-brief-preview.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { buildStrategyBrief, renderStrategyBriefHtml } from '../lib/ceo-weekly/strategyScorecard.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) {
        process.env[m[1]] = val;
      }
    }
  } catch { /* optional */ }
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE,
  { auth: { persistSession: false } }
);
const brief = await buildStrategyBrief(sb, 'https://www.alanranger.com');
const section = renderStrategyBriefHtml(brief);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Strategy Scorecard preview</title></head>
<body style="margin:0;padding:24px;background:#eef1f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0f2740;padding:22px 28px;">
  <div style="color:#8fb0d0;font-size:12px;font-weight:600;">ALAN RANGER PHOTOGRAPHY · WEEKLY BUSINESS BRIEF</div>
  <div style="color:#fff;font-size:22px;font-weight:700;margin-top:4px;">Monday brief · as of ${brief.as_of || ''}</div>
</td></tr>
${section}
</table>
<pre style="max-width:600px;margin:16px auto;font-size:11px;color:#667085">${JSON.stringify({
  scorecard: brief.scorecard,
  action_needed_count: (brief.action_needed || []).length,
  overdue: (brief.overdue_actions || []).length
}, null, 2)}</pre>
</body></html>`;

const outDir = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'LIVE-STRATEGY-BRIEF-PREVIEW-LATEST.html');
writeFileSync(out, html, 'utf8');
console.log(JSON.stringify({
  out,
  as_of: brief.as_of,
  gp_t3: brief.scorecard?.gp?.t3,
  plans_active: brief.scorecard?.plans?.active,
  action_needed: (brief.action_needed || []).length,
  overdue: (brief.overdue_actions || []).length
}, null, 2));
