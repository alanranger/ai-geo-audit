/**
 * Record GPT's confirmed YouTube Shorts schedule as shared content records (question 2026-11-09 (f)).
 *   node --env-file=.env.local scripts/content/seed-youtube-shorts.mjs <schedule.json> [--dry] [--read]
 * Upserts one strategy_content_assets row per video (format short_video, purpose, uses: YouTube release + the paired
 * Squarespace email module), appends history, and links the YouTube use to the paired email's initiative
 * (strategy_initiative_links, ref_type delivery). Re-runnable; never overwrites a provider read or a purpose set by hand.
 * --read then reads each video's real state from YouTube (read-only). Nothing is sent, published or changed in YouTube.
 */
import fs from 'node:fs';
import { serviceClient } from '../../lib/marketing/store.mjs';
import { assetKeyOf, campaignOn, readShortsStatus, seedShorts, shortRecord } from '../../lib/marketing/delivery-content.mjs';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) throw new Error('give the schedule JSON path');
const items = JSON.parse(fs.readFileSync(file, 'utf8'));
const need = (cond, msg) => { if (!cond) throw new Error(`schedule JSON: ${msg}`); };
for (const i of items) need(i.key && i.url && i.title && i.date && i.email, `each item needs key, url, title, date and email (${i.key || '?'})`);
const sb = serviceClient();

if (process.argv.includes('--dry')) {
  const { data: camps } = await sb.from('strategy_campaigns').select('campaign_key, planned_send_on, stage').not('planned_send_on', 'is', null);
  for (const i of items) {
    const r = shortRecord(i, campaignOn(camps || [], i.email), null, 'dry run', new Date().toISOString());
    console.log(assetKeyOf(i.key), '|', r.purpose, '|', r.uses.map((u) => `${u.channel}:${u.ref}`).join(' · '));
  }
} else {
  console.log(JSON.stringify(await seedShorts(sb, items)));
  if (process.argv.includes('--read')) console.log(JSON.stringify(await readShortsStatus(sb)));
}
