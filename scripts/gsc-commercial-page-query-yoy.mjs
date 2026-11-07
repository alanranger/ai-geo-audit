/**
 * READ-ONLY Claude handoff: commercial page×query GSC compare
 * 2025-06-01→2025-09-30 vs 2026-06-01→2026-09-30.
 * Does NOT write to any table.
 *
 *   node scripts/gsc-commercial-page-query-yoy.mjs
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const PROPERTY = 'https://www.alanranger.com';
const ROW_LIMIT = 25000;
const PAUSE_MS = 150;
const WIN_A = { label: '2025', start: '2025-06-01', end: '2025-09-30' };
const WIN_B = { label: '2026', start: '2026-06-01', end: '2026-09-30' };
const COMMERCIAL_TIERS = new Set(['A_landing', 'B_product', 'C_event']);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output/gsc-commercial-page-query-yoy.json');

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normPath(u) {
  try {
    const x = new URL(u);
    let p = x.pathname || '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p.toLowerCase();
  } catch {
    const s = String(u || '').split('?')[0].replace(/^https?:\/\/[^/]+/i, '');
    return (s || '/').replace(/\/$/, '').toLowerCase() || '/';
  }
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function fetchPageQueryAgg(token, start, end) {
  const all = [];
  let startRow = 0;
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  for (;;) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: start,
        endDate: end,
        dimensions: ['page', 'query'],
        rowLimit: ROW_LIMIT,
        startRow,
        dataState: 'final',
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`searchAnalytics ${r.status}: ${t.slice(0, 500)}`);
      err.status = r.status;
      err.body = t;
      throw err;
    }
    const j = await r.json();
    const batch = (j.rows || []).map((row) => ({
      page_url: row.keys[0],
      query: row.keys[1],
      clicks: Math.trunc(row.clicks ?? 0),
      impressions: Math.trunc(row.impressions ?? 0),
      ctr: Number(row.ctr) || 0,
      position: row.position == null ? null : Number(row.position),
      path: normPath(row.keys[0]),
    }));
    all.push(...batch);
    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    await sleep(PAUSE_MS);
  }
  return all;
}

async function probeEarliest(token) {
  // Confirm 2025-06 window is reachable; if not, find earliest month with data.
  try {
    const rows = await fetchPageQueryAgg(token, '2025-06-01', '2025-06-07');
    return { ok: true, probed: '2025-06-01', sample_rows: rows.length };
  } catch (e) {
    const msg = String(e.message || e);
    // Try stepping forward month by month from 2025-01
    for (const start of [
      '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01',
      '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01'
    ]) {
      const end = start.slice(0, 8) + '07';
      try {
        const rows = await fetchPageQueryAgg(token, start, end);
        return { ok: rows.length > 0, earliest_ok: start, sample_rows: rows.length, prior_error: msg };
      } catch (e2) {
        continue;
      }
    }
    return { ok: false, error: msg };
  }
}

async function loadCommercialPages() {
  const local = join(dirname(fileURLToPath(import.meta.url)), 'output/commercial-pages-master.json');
  try {
    const { readFileSync, existsSync } = await import('fs');
    if (existsSync(local)) {
      const rows = JSON.parse(readFileSync(local, 'utf8'));
      const byPath = new Map();
      for (const row of rows) {
        const p = normPath(row.path || row.url);
        byPath.set(p, { path: p, url: row.url, tier: row.tier });
      }
      return byPath;
    }
  } catch (_e) { /* fall through */ }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('need commercial-pages-master.json or Supabase keys');
  const endpoint = `${url}/rest/v1/pages_master?tier=in.(A_landing,B_product,C_event)&select=path,url,tier&order=tier,path`;
  const r = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!r.ok) throw new Error(`pages_master ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  const byPath = new Map();
  for (const row of rows) {
    const p = normPath(row.path || row.url);
    byPath.set(p, { path: p, url: row.url, tier: row.tier });
  }
  return byPath;
}

function weightedPos(rows) {
  let iw = 0;
  let w = 0;
  for (const r of rows) {
    const im = Number(r.impressions) || 0;
    if (!im || r.position == null) continue;
    iw += r.position * im;
    w += im;
  }
  return w ? Math.round((iw / w) * 10) / 10 : null;
}

function aggregatePage(rows) {
  let clicks = 0;
  let impressions = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
  }
  return { clicks, impressions, avg_position: weightedPos(rows) };
}

function filterCommercial(rows, pageMap) {
  return rows.filter((r) => pageMap.has(r.path));
}

function bestPageForQuery(rowsByQuery) {
  // Highest clicks wins; ties by impressions.
  let best = null;
  for (const r of rowsByQuery) {
    if (!best
      || r.clicks > best.clicks
      || (r.clicks === best.clicks && r.impressions > best.impressions)) {
      best = r;
    }
  }
  return best;
}

try {
  const token = await getAccessToken();
  console.log('probing GSC history…');
  const probe = await probeEarliest(token);
  console.log(JSON.stringify(probe));
  if (!probe.ok) {
    const report = { stopped: true, reason: 'gsc_history_unavailable', probe };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  if (probe.earliest_ok && probe.earliest_ok > '2025-06-01') {
    const report = {
      stopped: true,
      reason: 'gsc_earliest_after_requested_start',
      requested_start: '2025-06-01',
      earliest_available: probe.earliest_ok,
      probe
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log('loading commercial pages_master…');
  let pageMap;
  try {
    pageMap = await loadCommercialPages();
  } catch (e) {
    console.warn('pages_master via REST failed:', e.message);
    // Fall back: MCP-exported list via stdin file if present
    throw e;
  }
  console.log(`commercial pages: ${pageMap.size}`);

  console.log(`fetch ${WIN_A.label}…`);
  const rawA = await fetchPageQueryAgg(token, WIN_A.start, WIN_A.end);
  console.log(`fetch ${WIN_B.label}…`);
  const rawB = await fetchPageQueryAgg(token, WIN_B.start, WIN_B.end);
  console.log(`raw rows A=${rawA.length} B=${rawB.length}`);

  const a = filterCommercial(rawA, pageMap);
  const b = filterCommercial(rawB, pageMap);
  console.log(`commercial rows A=${a.length} B=${b.length}`);

  // Per-page rollup
  const pages = [...pageMap.values()].map((p) => {
    const ra = a.filter((r) => r.path === p.path);
    const rb = b.filter((r) => r.path === p.path);
    const aa = aggregatePage(ra);
    const bb = aggregatePage(rb);
    return {
      path: p.path,
      tier: p.tier,
      url: p.url,
      clicks_2025: aa.clicks,
      impressions_2025: aa.impressions,
      avg_position_2025: aa.avg_position,
      clicks_2026: bb.clicks,
      impressions_2026: bb.impressions,
      avg_position_2026: bb.avg_position,
      clicks_delta: bb.clicks - aa.clicks,
    };
  }).sort((x, y) => x.clicks_delta - y.clicks_delta);

  // Query-level: map query -> rows in each window (all commercial pages)
  function byQuery(rows) {
    const m = new Map();
    for (const r of rows) {
      const q = String(r.query || '').trim().toLowerCase();
      if (!q) continue;
      if (!m.has(q)) m.set(q, []);
      m.get(q).push(r);
    }
    return m;
  }
  const qa = byQuery(a);
  const qb = byQuery(b);
  const allQ = new Set([...qa.keys(), ...qb.keys()]);
  const losses = [];
  for (const q of allQ) {
    const ra = qa.get(q) || [];
    const rb = qb.get(q) || [];
    const bestA = bestPageForQuery(ra);
    const bestB = bestPageForQuery(rb);
    const c25 = ra.reduce((s, r) => s + r.clicks, 0);
    const c26 = rb.reduce((s, r) => s + r.clicks, 0);
    const loss = c25 - c26;
    if (loss <= 0) continue;
    const page25 = bestA?.path || null;
    const page26 = bestB?.path || null;
    const differentUrl = !!(page25 && page26 && page25 !== page26);
    // Also check if 2026 best is a different alanranger URL even outside commercial set
    let differentAny = differentUrl;
    if (page25 && !page26) {
      // query may have moved to non-commercial page in raw B
      const rbAll = rawB.filter((r) => String(r.query || '').trim().toLowerCase() === q);
      const bestAny = bestPageForQuery(rbAll);
      if (bestAny && normPath(bestAny.page_url) !== page25) {
        differentAny = true;
      }
    }
    losses.push({
      query: q,
      page_2025: page25,
      page_2026: page26 || (differentAny ? bestPageForQuery(rawB.filter((r) => String(r.query || '').trim().toLowerCase() === q))?.path : null),
      clicks_2025: c25,
      clicks_2026: c26,
      clicks_loss: loss,
      position_2025: weightedPos(ra),
      position_2026: weightedPos(rb.length ? rb : rawB.filter((r) => String(r.query || '').trim().toLowerCase() === q)),
      different_alanranger_url: !!(page25 && page26 && page25 !== page26)
        || !!(page25 && !page26 && differentAny),
    });
  }
  losses.sort((x, y) => y.clicks_loss - x.clicks_loss);
  const top20 = losses.slice(0, 20);

  // Landscape workshops specific
  const lwPath = '/landscape-photography-workshops';
  const lwA = a.filter((r) => r.path === lwPath);
  const lwB = b.filter((r) => r.path === lwPath);
  const lwByQ = new Map();
  for (const r of lwA) {
    const q = String(r.query || '').trim().toLowerCase();
    if (!lwByQ.has(q)) lwByQ.set(q, { q, c25: 0, i25: 0, p25: [], c26: 0, i26: 0, p26: [] });
    const o = lwByQ.get(q);
    o.c25 += r.clicks;
    o.i25 += r.impressions;
    if (r.position != null) o.p25.push({ position: r.position, impressions: r.impressions });
  }
  for (const r of lwB) {
    const q = String(r.query || '').trim().toLowerCase();
    if (!lwByQ.has(q)) lwByQ.set(q, { q, c25: 0, i25: 0, p25: [], c26: 0, i26: 0, p26: [] });
    const o = lwByQ.get(q);
    o.c26 += r.clicks;
    o.i26 += r.impressions;
    if (r.position != null) o.p26.push({ position: r.position, impressions: r.impressions });
  }
  function wpos(arr) {
    let iw = 0; let w = 0;
    for (const x of arr) { iw += x.position * x.impressions; w += x.impressions; }
    return w ? Math.round((iw / w) * 10) / 10 : null;
  }
  const lwLosses = [...lwByQ.values()]
    .map((o) => ({
      query: o.q,
      page: lwPath,
      clicks_2025: o.c25,
      clicks_2026: o.c26,
      clicks_loss: o.c25 - o.c26,
      position_2025: wpos(o.p25),
      position_2026: wpos(o.p26),
      different_alanranger_url: (() => {
        if (o.c25 <= o.c26) return false;
        const rbAll = rawB.filter((r) => String(r.query || '').trim().toLowerCase() === o.q);
        const best = bestPageForQuery(rbAll);
        return !!(best && normPath(best.page_url) !== lwPath);
      })(),
      page_2026_elsewhere: (() => {
        const rbAll = rawB.filter((r) => String(r.query || '').trim().toLowerCase() === o.q);
        const best = bestPageForQuery(rbAll);
        return best ? normPath(best.page_url) : null;
      })(),
    }))
    .filter((x) => x.clicks_loss > 0)
    .sort((x, y) => y.clicks_loss - x.clicks_loss);

  const report = {
    stopped: false,
    read_only: true,
    windows: { win_2025: WIN_A, win_2026: WIN_B },
    commercial_page_count: pageMap.size,
    raw_rows: { a: rawA.length, b: rawB.length },
    commercial_rows: { a: a.length, b: b.length },
    per_page: pages,
    top20_query_losses: top20,
    landscape_workshops: {
      page: aggregatePage(lwA),
      page_2026: aggregatePage(lwB),
      top_query_losses: lwLosses.slice(0, 30),
    },
    totals: {
      clicks_2025: pages.reduce((s, p) => s + p.clicks_2025, 0),
      clicks_2026: pages.reduce((s, p) => s + p.clicks_2026, 0),
    },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`wrote ${OUT}`);
  console.log(JSON.stringify({
    totals: report.totals,
    pages_with_data: pages.filter((p) => p.clicks_2025 || p.clicks_2026).length,
    top5_losses: top20.slice(0, 5),
  }, null, 2));
} catch (e) {
  console.error('FATAL', e);
  process.exit(1);
}
