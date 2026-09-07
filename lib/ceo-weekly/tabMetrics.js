/**
 * Tab-sourced metrics for Monday CEO email (Acquisition, Surfaces, Money pages, Authority, LLM).
 */
import { computeSurfaceOutcomesRollup } from '../audit/surfaceOutcomes.js';
import { DEFAULT_PROPERTY, deltaArrow, fmtNum } from './shared.js';

function appBase() {
  return (
    process.env.CEO_WEEKLY_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

function num(v) {
  // Number(null) === 0 in JS — treat null/undefined/'' as missing
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctDelta(curr, prev) {
  if (curr == null || prev == null || !Number.isFinite(Number(prev)) || Number(prev) === 0) {
    return { delta: null, arrow: '→', label: 'n/a', pct: null };
  }
  const pct = ((Number(curr) - Number(prev)) / Math.abs(Number(prev))) * 100;
  const arrow = pct > 0.05 ? '▲' : pct < -0.05 ? '▼' : '→';
  const abs = Math.abs(pct);
  // Match dashboard / mock: one decimal (e.g. ▲ 24.8%)
  const label = `${arrow} ${abs.toFixed(1)}%`;
  return { delta: pct, arrow, label, pct };
}

function tileByLabel(tiles, label) {
  return (tiles || []).find((t) => String(t.label || '').toLowerCase() === label.toLowerCase()) || null;
}

function lastNonNullScore(history, field) {
  for (const row of history || []) {
    const v = num(row?.[field]);
    if (v != null) return { value: v, audit_date: row.audit_date || null };
  }
  return { value: null, audit_date: null };
}

function chipFromHistory(history, field, weekAgoDate) {
  const curRow = history?.[0] || {};
  const curVal = num(curRow?.[field]);
  const stale = curVal == null;
  const display = stale ? lastNonNullScore(history, field) : { value: curVal, audit_date: curRow.audit_date || null };
  const prevRow = (history || []).find((r) => weekAgoDate && r.audit_date <= weekAgoDate) || history?.[1] || {};
  const prevVal = num(prevRow?.[field]);
  // Only ▲/▼ when BOTH current (non-stale) and prior are non-null
  const wow = (!stale && display.value != null && prevVal != null)
    ? deltaArrow(display.value, prevVal)
    : { delta: null, arrow: '→', label: 'n/a', stale: true };
  return {
    value: display.value,
    wow,
    stale,
    audit_date: display.audit_date,
    vs_audit_date: prevRow.audit_date || null
  };
}

function shortTitle(title, path) {
  const p = String(path || '').replace(/^\//, '');
  if (/free-online-photography-course/i.test(p)) return 'Free course';
  if (/photography-workshops/i.test(p)) return 'Workshops';
  if (/hire-a-professional-photographer/i.test(p)) return 'Hire a photographer';
  const t = String(title || '').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').trim();
  if (t) {
    const cut = t.split(/[-—|]/)[0].trim();
    if (cut.length > 3 && cut.length < 42) return cut;
  }
  return p.replace(/-/g, ' ').slice(0, 36) || 'page';
}

export async function fetchAcquisitionMetrics() {
  const res = await fetch(`${appBase()}/api/aigeo/acquisition-channels?days=28`, {
    headers: { Accept: 'application/json' }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`acquisition_channels_${res.status}`);
  const sections = json.sections || [];
  const visitsSec = sections.find((s) => s.key === 'ga4_visits') || {};
  const realSec = sections.find((s) => s.key === 'ga4_real_visits') || {};
  const gscSec = sections.find((s) => s.key === 'gsc') || {};
  const tiles = visitsSec.tiles || [];
  const pick = (label) => {
    const t = tileByLabel(tiles, label);
    if (!t) return { value: null, wow: { label: 'n/a', delta: null } };
    return { value: num(t.value), wow: pctDelta(t.value, t.prev), prev: num(t.prev) };
  };
  const totalTile = tileByLabel(realSec.tiles || [], 'Total visits')
    || { value: json.ga4?.attributed_sessions, prev: null };
  const organic = pick('Google organic');
  const direct = pick('Direct');
  const ai = pick('AI Assistant');
  const social = pick('Organic Social');
  const gscTiles = gscSec.tiles || [];
  const clicks = tileByLabel(gscTiles, 'Clicks');
  const impr = tileByLabel(gscTiles, 'Impressions');
  const ctr = tileByLabel(gscTiles, 'CTR');
  const attributed = num(json.ga4?.attributed_sessions) ?? num(totalTile.value);
  const unattributed = num(json.ga4?.unattributed_sessions);
  const attributedPct = num(json.ga4?.attributed_pct);
  const excludedPct = attributedPct != null ? Math.round(100 - attributedPct) : null;
  return {
    attributed_visits: attributed,
    attributed_wow: pctDelta(totalTile.value, totalTile.prev),
    google_organic: organic,
    direct,
    ai_assistant: ai,
    organic_social: social,
    gsc_clicks: { value: num(clicks?.value), wow: pctDelta(clicks?.value, clicks?.prev) },
    gsc_impressions: { value: num(impr?.value), wow: pctDelta(impr?.value, impr?.prev) },
    gsc_ctr: {
      value: ctr?.value != null ? Number(ctr.value) * (Number(ctr.value) <= 1 ? 100 : 1) : null,
      wow: pctDelta(ctr?.value, ctr?.prev)
    },
    bot_footer: unattributed != null && excludedPct != null
      ? `${fmtNum(unattributed)} automated sessions (${excludedPct}%) excluded as bots.`
      : null,
    source: 'GET /api/aigeo/acquisition-channels?days=28'
  };
}

export async function fetchAuditTabMetrics(supabase, propertyUrl = DEFAULT_PROPERTY) {
  // WoW chips = latest audit vs ~7 days prior (AI Health trend cadence), not adjacent saves
  const { data: history } = await supabase
    .from('audit_results')
    .select('audit_date, surface_visibility_score, top_of_page_score, brand_score, ai_summary_score, money_pages_behaviour_score, authority_score, authority_behaviour_score, authority_ranking_score, authority_backlink_score, authority_review_score')
    .ilike('property_url', '%alanranger.com%')
    .order('audit_date', { ascending: false })
    .limit(21);
  const cur = history?.[0] || {};
  const weekAgo = cur.audit_date
    ? new Date(Date.parse(`${cur.audit_date}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10)
    : null;
  const prev = (history || []).find((r) => weekAgo && r.audit_date <= weekAgo) || history?.[1] || {};

  const res = await fetch(
    `${appBase()}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(propertyUrl)}&preferRecent=true&requireGsc=true`,
    { headers: { Accept: 'application/json' } }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`get_latest_audit_${res.status}`);
  const d = json.data || json;
  const scores = d.scores || {};
  const components = scores.authorityComponents || {
    behaviour: cur.authority_behaviour_score,
    ranking: cur.authority_ranking_score,
    backlinks: cur.authority_backlink_score,
    reviews: cur.authority_review_score
  };
  const moneyRows = scores.moneyPagesMetrics?.rows || [];
  const behaviour = scores.moneyPagesMetrics?.behaviour || {};
  const upsidePages = moneyRows
    .map((r) => {
      const ctr = num(r.ctr) || 0;
      const impr = num(r.impressions) || 0;
      const upside = Math.round(impr * Math.max(0, 0.025 - ctr));
      const path = String(r.url || '').replace(/^https?:\/\/[^/]+/i, '');
      return {
        path,
        title: shortTitle(r.title, path),
        category: r.category,
        upside,
        ctr,
        impressions: impr
      };
    })
    .sort((a, b) => b.upside - a.upside)
    .slice(0, 3);
  const opp = scores.moneyPagesMetrics?.summaryByCategory || {};
  const surf = computeSurfaceOutcomesRollup(d.rankingAiData?.combinedRows || []);
  const byKey = Object.fromEntries((surf.rows || []).map((r) => [r.key, r]));
  const surface = (key) => {
    const r = byKey[key];
    if (!r) return { pct: null, owned: null, served: null, label: key };
    return {
      key,
      label: r.label,
      pct: r.overall?.pct ?? null,
      owned: r.overall?.owned ?? null,
      served: r.overall?.served ?? null
    };
  };

  const brandCur = num(cur.brand_score) ?? num(scores.brandOverlay?.score ?? scores.brandOverlay);
  const brandPrev = num(prev.brand_score);

  return {
    chips: {
      surface_vis: chipFromHistory(history, 'surface_visibility_score', weekAgo),
      top_of_page: chipFromHistory(history, 'top_of_page_score', weekAgo),
      brand: {
        value: brandCur,
        wow: (brandCur != null && brandPrev != null)
          ? deltaArrow(brandCur, brandPrev)
          : { delta: null, arrow: '→', label: 'n/a', stale: brandCur == null },
        stale: brandCur == null,
        vs_audit_date: prev.audit_date || null
      }
    },
    authority: {
      score: num(scores.authority?.score ?? scores.authority) ?? num(cur.authority_score),
      behaviour: num(components.behaviour),
      ranking: num(components.ranking),
      backlinks: num(components.backlinks),
      reviews: num(components.reviews)
    },
    money_pages: {
      behaviour_score: num(behaviour.score) ?? num(cur.money_pages_behaviour_score),
      site_ctr_pct: behaviour.siteCtr != null ? Number(behaviour.siteCtr) * 100 : null,
      top10_ctr_pct: behaviour.top10Ctr != null ? Number(behaviour.top10Ctr) * 100 : null,
      high_opportunity: opp.HIGH_OPPORTUNITY?.count ?? null,
      visibility_fix: opp.VISIBILITY_FIX?.count ?? null,
      top_upside: upsidePages
    },
    surfaces: {
      map_pack: surface('map_pack'),
      organic_top10: surface('organic_top10'),
      knowledge_panel: surface('knowledge_panel'),
      ai_overview: surface('ai_answer'),
      paa: surface('paa'),
      featured_snippet: surface('answer_boxes'),
      headline: 'You own the classic surfaces (map/organic) and are absent from every answer surface.'
    },
    ai_summary_score: num(cur.ai_summary_score),
    audit_date: cur.audit_date || null,
    source: 'get-latest-audit + audit_results chips + surfaceOutcomes rollup'
  };
}

export async function fetchLlmMetrics(propertyUrl = DEFAULT_PROPERTY) {
  const res = await fetch(
    `${appBase()}/api/aigeo/llm-visibility?propertyUrl=${encodeURIComponent(propertyUrl)}`,
    { headers: { Accept: 'application/json' } }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`llm_visibility_${res.status}`);
  const summary = json.summary || json.data?.summary || {};
  return {
    prompts_named: num(summary.prompts_named),
    prompts_total: num(summary.prompts_total) || 15,
    mentions: num(summary.mentions),
    source: 'GET /api/aigeo/llm-visibility'
  };
}
