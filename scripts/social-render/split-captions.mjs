/**
 * One-off migration of GPT's social drafts (final fix round, item 1): split each production brief into public_caption /
 * asset_instructions / internal_notes / platform_state on its placements (marketing_social_placements). Splits only
 * where the brief is clearly delimited (lib/social-standard/caption.mjs splitBrief); otherwise public_caption stays
 * empty ("needs caption", GPT rewrites). Never overwrites a public_caption already stored; the brief column is untouched.
 *   node --env-file=.env.local scripts/social-render/split-captions.mjs           dry run: the audit only
 *   node --env-file=.env.local scripts/social-render/split-captions.mjs --apply   write the fields (with history)
 */
import { createClient } from '@supabase/supabase-js';
import { splitBrief } from '../../lib/social-standard/caption.mjs';

const PROP = 'https://www.alanranger.com';
const APPLY = process.argv.includes('--apply');
const BY = 'Cursor caption split (final fix round item 1)';
const placementsOf = (channel) => (channel === 'LinkedIn' ? ['linkedin_feed'] : ['facebook_feed', 'instagram_feed', 'instagram_story']);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const filled = (v) => String(v ?? '').trim() !== '';
const counts = { skipped: 0, filled: 0, needs_caption: 0 };
/** Only EMPTY fields are filled; anything GPT (or anyone) already wrote is kept exactly as written. */
function patchFor(cur, s, placement) {
  const caption = placement === 'instagram_story' ? null : s.public_caption;
  const patch = {};
  for (const [k, v] of [['public_caption', caption], ['asset_instructions', s.asset_instructions], ['internal_notes', s.internal_notes], ['platform_state', s.platform_state]]) if (!filled(cur?.[k]) && filled(v)) patch[k] = v;
  return patch;
}
async function placementRow(step, placement) {
  const { data } = await sb.from('marketing_social_placements').select('public_caption, asset_instructions, internal_notes, platform_state, caption_split, history').eq('property_url', PROP).eq('step_key', step.step_key).eq('placement', placement).maybeSingle();
  return data;
}
async function write(step, s, now) {
  for (const placement of placementsOf(step.channel)) {
    const cur = await placementRow(step, placement);
    if (filled(cur?.public_caption)) { counts.skipped += 1; continue; }
    const patch = patchFor(cur, s, placement);
    if (patch.public_caption) counts.filled += 1; else counts.needs_caption += 1;
    if (!APPLY || !Object.keys(patch).length) continue;
    const row = { property_url: PROP, step_key: step.step_key, placement, ...patch, caption_split: cur?.caption_split || (s.split === 'clean' ? 'clean' : `needs_gpt: ${s.reason}`), history: [...(cur?.history || []), { at: now, by: BY, action: 'caption_split', split: s.split, reason: s.reason, filled: Object.keys(patch) }], set_by: BY, set_at: now };
    const { error } = await sb.from('marketing_social_placements').upsert(row, { onConflict: 'property_url,step_key,placement' });
    if (error) throw new Error(`${step.step_key} ${placement}: ${error.message}`);
  }
}

const { data, error } = await sb.from('strategy_campaign_steps').select('step_key, scheduled_day, channel, step, brief').eq('property_url', PROP).like('step_key', 'gpt-%').order('scheduled_day');
if (error) throw new Error(error.message);
const now = new Date().toISOString();
const rows = data.map((st) => ({ st, s: splitBrief(st.brief) }));
for (const { st, s } of rows) {
  console.log(`${s.split === 'clean' ? 'split cleanly' : 'needs GPT    '} · ${st.scheduled_day} · ${st.channel} · ${st.step}${s.split === 'clean' ? '' : ` · ${s.reason}`}`);
  await write(st, s, now);
}
console.log(`${rows.length} drafts: ${rows.filter((r) => r.s.split === 'clean').length} split cleanly, ${rows.filter((r) => r.s.split !== 'clean').length} need GPT`);
console.log(`placements: ${counts.skipped} skipped (public caption already filled, kept as written) · ${counts.filled} ${APPLY ? 'filled' : 'would be filled'} · ${counts.needs_caption} needs caption${APPLY ? '' : ' · dry run, nothing written'}`);
