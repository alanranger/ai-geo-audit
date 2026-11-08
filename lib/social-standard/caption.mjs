/**
 * AR-social-v1 caption safety. A GPT production brief mixes the public caption with internal text (header, asset /
 * render instructions, status, delivery pack, event-card coverage). Only `public_caption` may ever be shown as the
 * "Final caption" or copied for publishing. A brief splits only where it is clearly delimited: header paragraph →
 * caption → an explicit "Asset:" line; and the caption part must contain no internal marker phrase. Anything else is
 * "needs caption" (GPT rewrites it); nothing is publish-ready by default.
 */
export const MARKERS = [
  /\bmaster\b/i, /\btemplate\b/i, /\bapp plan\b/i, /provider[- ]scheduled/i, /\bprepared under\b/i, /\bverify\b/i,
  /AR-social-v1/i, /^DRAFT\b/im, /\bAlan to review\b/i, /^\s*(Asset|Status):/im, /DELIVERY PACK/i, /EVENT CARD COVERAGE/i
];
/** Internal marker phrases found in a text (the readiness check). */
export const markersIn = (text) => MARKERS.filter((re) => re.test(String(text || ''))).map((re) => (String(text).match(re) || [''])[0].trim());

const HEADER = /^DRAFT\b[^\n]*(?:\n(?!\s*\n)[^\n]*)*/;
const ASSET = /\n\s*Asset:/;
/**
 * Split a brief into { public_caption, asset_instructions, internal_notes, platform_state, split, reason }.
 * `split` = 'clean' or 'needs_gpt'; public_caption is null unless clean.
 */
/* ---------- booking URL resolves (cached per server instance, 1 hour) ---------- */

const URL_TTL = 3600000;
const urlCache = new Map();
async function probe(url, fetchFn) {
  const opts = (method) => ({ method, redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'AlanRanger-dashboard-linkcheck' } });
  try {
    let r = await fetchFn(url, opts('HEAD'));
    if (r.status === 405 || r.status === 403) r = await fetchFn(url, opts('GET'));
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: null, error: String(e?.message || e).slice(0, 80) };
  }
}
/** { url: { ok, status, checked_at } } for each distinct https URL; a HEAD (GET if refused), cached for an hour. */
export async function checkUrls(urls, fetchFn = fetch, now = Date.now()) {
  const list = [...new Set((urls || []).filter((u) => /^https:\/\//.test(String(u || ''))))];
  const out = {};
  await Promise.all(list.map(async (u) => {
    const hit = urlCache.get(u);
    if (hit && now - hit.at < URL_TTL) { out[u] = hit.v; return; }
    const v = { ...(await probe(u, fetchFn)), checked_at: new Date(now).toISOString() };
    urlCache.set(u, { at: now, v });
    out[u] = v;
  }));
  return out;
}
export const urlsInCaption = (text) => String(text || '').match(/https:\/\/[^\s)"'<>]+/g) || [];

const needsGpt = (reason, extra = {}) => ({ public_caption: null, asset_instructions: null, internal_notes: null, split: 'needs_gpt', reason, ...extra });
export function splitBrief(brief) {
  const b = String(brief || '').replace(/\r\n/g, '\n');
  const head = (b.match(HEADER) || [''])[0];
  const platform_state = /provider schedule|publication scheduled|App plan only|no social publication scheduled/i.test(b) ? 'app_draft' : null;
  if (!head) return needsGpt('no DRAFT header paragraph', { platform_state });
  const rest = b.slice(head.length);
  const at = rest.search(ASSET);
  if (at < 0) return needsGpt('no explicit "Asset:" line after the caption', { platform_state });
  const caption = rest.slice(0, at).trim();
  const tail = rest.slice(at).trim();
  const assetLine = (tail.match(/^Asset:[\s\S]*?(?=\n\s*Status:|\n\s*\n|$)/) || [''])[0];
  const asset = assetLine.replace(/^Asset:\s*/, '').trim() || null;
  const internal = [head.trim(), tail.slice(assetLine.length).trim()].filter(Boolean).join('\n\n') || null;
  const found = markersIn(caption);
  if (!caption || found.length) return needsGpt(caption ? `internal text in the caption part (${found.join(', ')})` : 'empty caption part', { asset_instructions: asset, internal_notes: internal, platform_state });
  return { public_caption: caption, asset_instructions: asset, internal_notes: internal, platform_state, split: 'clean', reason: 'header, caption, then an explicit "Asset:" line' };
}
