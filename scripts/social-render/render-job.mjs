/**
 * AR-social-v1 render on Alan's PC: event facts → feed 1080×1350, Story 1080×1920, LinkedIn 1200×1500 SVG masters →
 * PNG (Chromium, system Arial). The original photo is embedded unchanged as ONE image (no redraw, no crop).
 * Checks every render: the SVG's embedded bytes equal the original file (sha256), and the PNG's photo rectangle is
 * pixel-identical to the photo rendered alone at the same place (no text, sticker or redraw on the photo).
 *
 *   node --env-file=.env.local scripts/social-render/render-job.mjs --jobs                 queued "Render" requests
 *   node --env-file=.env.local scripts/social-render/render-job.mjs --event=norfolk-2026-11-20 [--store --step=KEY]
 *   node scripts/social-render/render-job.mjs --json=<event.json> [--out=<dir>]            GPT's event JSON, files only
 * Outputs: <out>/<id>-{feed,story,linkedin}.{svg,png} + <id>-publishing.json. With --jobs / --store, PNGs go to the
 * private storage bucket social-renders and onto that step's placements (marketing_social_placements.assets).
 * Never publishes, schedules or marks anything scheduled.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { FORMATS, mimeOf, photoRect, publishingPack, renderSvg, embeddedImages } from '../../lib/social-standard/template.mjs';
import { socialStandardView, templateEvent } from '../../lib/social-standard/facts.mjs';
import { loadSquarespaceEventFeeds } from '../../lib/squarespace-events-feed.mjs';

const PROP = 'https://www.alanranger.com';
const DRIVE = process.env.CLAUDE_DRIVE_ROOT || 'C:/Users/alan/Google Drive/Claude shared resources';
const OUT_ROOT = path.join(DRIVE, 'Cursor Outputs for Claude', 'social-renders');
const BUCKET = 'social-renders';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || null;
const flag = (k) => process.argv.includes(`--${k}`);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const todayUk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const sbClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/* ---------- rasterise + pixel check (in Chromium) ---------- */

async function rasterise(page, svg, { width, height }, rect, control) {
  return page.evaluate(async ({ svg: s, control: c, width: w, height: h, rect: r }) => {
    const draw = async (src) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(src)))}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      return cv;
    };
    const [full, ctl] = [await draw(s), await draw(c)];
    const box = [Math.ceil(r.x) + 1, Math.ceil(r.y) + 1, Math.floor(r.width) - 2, Math.floor(r.height) - 2];
    const a = full.getContext('2d').getImageData(...box).data;
    const b = ctl.getContext('2d').getImageData(...box).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
    return { png: full.toDataURL('image/png').split(',')[1], diff, compared: a.length / 4 };
  }, { svg, control, width, height, rect });
}

/** Three masters + PNGs for one event; returns the files and the two checks per format. */
export async function renderEvent(event, photo, outDir, browser) {
  fs.mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage();
  const out = {};
  try {
    for (const format of Object.keys(FORMATS)) {
      const svg = renderSvg(event, photo, format);
      const embedded = embeddedImages(svg);
      const bytesSame = embedded.length === 1 && sha(embedded[0].bytes) === sha(photo.bytes);
      const r = await rasterise(page, svg, FORMATS[format], photoRect(format), renderSvg(event, photo, format, { photoOnly: true }));
      const png = Buffer.from(r.png, 'base64');
      fs.writeFileSync(path.join(outDir, `${event.id}-${format}.svg`), svg);
      fs.writeFileSync(path.join(outDir, `${event.id}-${format}.png`), png);
      out[format] = { file: path.join(outDir, `${event.id}-${format}.png`), png, sha256: sha(png), width: FORMATS[format].width, height: FORMATS[format].height, photo_sha256: sha(photo.bytes), embedded_bytes_identical: bytesSame, photo_pixels_compared: r.compared, photo_pixel_diff: r.diff, photo_check: bytesSame && r.diff === 0 ? 'unchanged' : `CHANGED (${r.diff} channel values differ)` };
    }
  } finally {
    await page.close();
  }
  fs.writeFileSync(path.join(outDir, `${event.id}-publishing.json`), JSON.stringify(publishingPack(event), null, 2));
  return out;
}

/* ---------- facts + storage ---------- */

async function eventFromFacts(sb, eventId) {
  const v = await socialStandardView(sb, PROP, { todayIso: todayUk(), feeds: loadSquarespaceEventFeeds });
  const rec = v.facts.find((f) => f.event_id === eventId);
  if (!rec) throw new Error(`no facts record for ${eventId}`);
  if (!rec.photo_path) throw new Error(`${eventId}: original photo path missing in the facts record`);
  const file = path.isAbsolute(rec.photo_path) ? rec.photo_path : path.join(DRIVE, rec.photo_path);
  return { event: templateEvent(rec), photo: { bytes: fs.readFileSync(file), mime: mimeOf(file) } };
}
function eventFromJson(file) {
  const event = JSON.parse(fs.readFileSync(file, 'utf8'));
  const photoFile = path.resolve(path.dirname(file), event.photo);
  return { event, photo: { bytes: fs.readFileSync(photoFile), mime: mimeOf(photoFile) } };
}
const placementsFor = (stepKey) => (/LinkedIn|-li$/i.test(String(stepKey)) ? { linkedin: ['linkedin_feed'] } : { feed: ['facebook_feed', 'instagram_feed'], story: ['instagram_story'] });

async function store(sb, eventId, stepKey, files, by) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const assets = {};
  for (const [format, f] of Object.entries(files)) {
    const storagePath = `${eventId}/${stamp}/${format}.png`;
    const { error } = await sb.storage.from(BUCKET).upload(storagePath, f.png, { contentType: 'image/png', upsert: false });
    if (error) throw new Error(`upload ${format}: ${error.message}`);
    assets[format] = { storage_path: storagePath, local_file: f.file, sha256: f.sha256, width: f.width, height: f.height, photo_sha256: f.photo_sha256, photo_check: f.photo_check, rendered_at: new Date().toISOString(), template: 'AR-social-v1' };
  }
  if (stepKey) await attach(sb, eventId, stepKey, assets, by);
  return assets;
}
/** Rendered assets onto the step's placements (feed → FB + IG feed, story → IG Story, linkedin → LinkedIn). */
async function attach(sb, eventId, stepKey, assets, by) {
  const now = new Date().toISOString();
  for (const [format, list] of Object.entries(placementsFor(stepKey))) {
    if (!assets[format]) continue;
    for (const placement of list) {
      const { data: cur } = await sb.from('marketing_social_placements').select('stage, assets, history').eq('property_url', PROP).eq('step_key', stepKey).eq('placement', placement).maybeSingle();
      const row = { property_url: PROP, step_key: stepKey, placement, event_id: eventId, stage: cur?.stage || 'preview_review', assets: { ...(cur?.assets || {}), [format]: assets[format] }, history: [...(cur?.history || []), { at: now, by, action: 'rendered', format, sha256: assets[format].sha256, photo_check: assets[format].photo_check }], set_by: by, set_at: now };
      const { error } = await sb.from('marketing_social_placements').upsert(row, { onConflict: 'property_url,step_key,placement' });
      if (error) throw new Error(`placement ${placement}: ${error.message}`);
    }
  }
}

/* ---------- queued jobs ---------- */

async function progress(sb, runId, patch) {
  await sb.from('marketing_collector_runs').update({ heartbeat_at: new Date().toISOString(), ...patch }).eq('run_id', runId);
}
async function claim(sb) {
  const { data } = await sb.from('marketing_collector_runs').select('run_id, checkpoint').eq('kind', 'social-render').eq('status', 'queued').order('started_at').limit(1).maybeSingle();
  if (!data) return null;
  const { data: got } = await sb.from('marketing_collector_runs').update({ status: 'running', host: 'alan-pc', heartbeat_at: new Date().toISOString(), checkpoint: { ...data.checkpoint, step: 'rendering on Alan\'s PC' } }).eq('run_id', data.run_id).eq('status', 'queued').select('run_id').maybeSingle();
  return got ? data : null;
}
async function runJob(sb, job, browser) {
  const cp = job.checkpoint || {};
  try {
    const { event, photo } = await eventFromFacts(sb, cp.event_id);
    await progress(sb, job.run_id, { items_done: 1, checkpoint: { ...cp, step: 'rendering feed, Story and LinkedIn' } });
    const files = await renderEvent(event, photo, path.join(OUT_ROOT, cp.event_id), browser);
    await progress(sb, job.run_id, { items_done: 2, checkpoint: { ...cp, step: 'storing the PNGs on the delivery' } });
    const assets = await store(sb, cp.event_id, cp.step_key, files, 'Render job (Alan\'s PC)');
    const checks = Object.entries(files).map(([k, f]) => `${k} ${f.photo_check}`).join(' · ');
    await progress(sb, job.run_id, { status: 'ok', items_done: 3, finished_at: new Date().toISOString(), checkpoint: { ...cp, step: `3 PNGs stored · photo ${checks}` }, summary: { assets } });
  } catch (e) {
    await progress(sb, job.run_id, { status: 'failed', finished_at: new Date().toISOString(), error: String(e?.message || e).slice(0, 400) });
  }
}

async function jobs() {
  const sb = sbClient();
  let job = await claim(sb);
  if (!job) return;
  const browser = await chromium.launch({ headless: true });
  try {
    for (let n = 0; job && n < 5; job = await claim(sb), n += 1) await runJob(sb, job, browser);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (flag('jobs')) return jobs();
  const browser = await chromium.launch({ headless: true });
  try {
    const json = arg('json');
    const src = json ? eventFromJson(json) : await eventFromFacts(sbClient(), arg('event'));
    const files = await renderEvent(src.event, src.photo, arg('out') || path.join(OUT_ROOT, src.event.id), browser);
    if (flag('store')) await store(sbClient(), src.event.id, arg('step'), files, 'Render CLI (Alan\'s PC)');
    for (const [k, f] of Object.entries(files)) console.log(`${k}: ${f.width}×${f.height} ${f.file} · embedded bytes identical ${f.embedded_bytes_identical} · photo pixels compared ${f.photo_pixels_compared}, differing ${f.photo_pixel_diff} → ${f.photo_check}`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
