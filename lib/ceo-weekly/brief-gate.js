/**
 * Pre-send sense-check for the Monday CEO brief. assessBriefGate() is pure (inputs → checks) so the
 * broken and corrected 2 Nov data can be replayed; loadBriefGateInputs() reads the inputs from Supabase.
 */
import { BRIEF_GATE } from './brief-gate-config.js';
import { googleOwnerShare } from '../keyword-ranking/serp-redirect-owner.js';

const share = (cur, prev) => (Number.isFinite(cur) && Number.isFinite(prev) && prev > 0 ? (cur - prev) / prev : null);
const pct = (x) => `${Math.round(x * 100)}%`;
const check = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

function dialChecks(inp, cfg) {
  return ['surface_visibility_score', 'top_of_page_score'].map((k) => {
    const s = share(inp.current?.[k], inp.previous?.[k]);
    return check(`dial_move_${k}`, s == null || Math.abs(s) <= cfg.maxDialMoveShare,
      `${k} ${inp.previous?.[k] ?? '—'} → ${inp.current?.[k] ?? '—'}${s == null ? '' : ` (${s > 0 ? '+' : ''}${pct(s)})`}; limit ±${pct(cfg.maxDialMoveShare)}`);
  });
}

function top10Check(inp, cfg) {
  const s = share(inp.current?.top10, inp.previous?.top10);
  return check('top10_drop', s == null || s >= -cfg.maxTop10DropShare,
    `top-10 keywords ${inp.previous?.top10 ?? '—'} → ${inp.current?.top10 ?? '—'}; limit −${pct(cfg.maxTop10DropShare)}`);
}

function rankingChecks(inp, cfg) {
  const owner = googleOwnerShare(inp.rankingRows || []);
  return [
    check('ranking_quality_complete', inp.current?.ranking_quality === 'complete', `ranking_quality: ${inp.current?.ranking_quality || 'missing'}`),
    check('owner_domain_google', owner.share <= cfg.maxGoogleOwnerShare,
      `${owner.google} of ${owner.total} owner slots on google.com (${pct(owner.share)}); limit ${pct(cfg.maxGoogleOwnerShare)}`),
  ];
}

function findingsCheck(inp) {
  const since = Date.parse(inp.latestFullRunStart || '');
  const old = (inp.shownFindings || []).filter((f) => !Number.isFinite(since) || Date.parse(f.last_checked || '') < since);
  return check('findings_current', old.length === 0,
    old.length ? `${old.length} red/amber finding(s) in the brief were not re-checked by the latest ① run` : 'all findings in the brief come from the latest ① run');
}

function sourcesCheck(inp, cfg) {
  const ok = new Set((inp.steps || []).filter((s) => s.ok).map((s) => s.key));
  const missing = cfg.requiredSteps.filter((k) => !ok.has(k));
  return check('sources_refreshed', missing.length === 0, missing.length ? `not refreshed this week: ${missing.join(', ')}` : 'all brief sources refreshed this week');
}

/** Backlinks / SEO health: a changed basis is labelled (deltas withheld); an implausible swing on the same basis holds. */
function swingCheck(id, label, block) {
  if (!block) return check(id, true, `${label}: not checked`);
  if (block.error) return check(id, true, `${label}: unavailable (${block.error})`);
  const c = block.comparable || { ok: true };
  if (c.implausible) return check(id, false, `${label}: ${c.reason}`);
  if (!c.ok) return check(id, true, `${label}: week-on-week withheld and labelled — ${c.reason}`);
  return check(id, true, `${label}: comparable with last week`);
}

function swingChecks(blocks) {
  if (!blocks) return [];
  return [swingCheck('backlinks_swing', 'backlinks', blocks.backlinks), swingCheck('seo_health_swing', 'SEO health', blocks.seo_health)];
}

/**
 * @param {{ current, previous, rankingRows, shownFindings, latestFullRunStart, steps, blocks }} inp
 *   blocks: { backlinks, seo_health } from weekOnWeekBlocks() — each carries `comparable`.
 *   current / previous: { surface_visibility_score, top_of_page_score, top10, ranking_quality }
 */
export function assessBriefGate(inp, cfg = BRIEF_GATE) {
  const checks = [...dialChecks(inp, cfg), top10Check(inp, cfg), ...rankingChecks(inp, cfg), findingsCheck(inp), sourcesCheck(inp, cfg), ...swingChecks(inp.blocks)];
  const failures = checks.filter((c) => !c.ok);
  return { held: failures.length > 0, checks, failures };
}

/** This week: the latest audit row. Last week: the latest COMPLETE ranking audit before this week (other days copy scores). */
async function auditRow(sb, propertyUrl, cmp, date) {
  let q = sb.from('audit_results').select('audit_date, surface_visibility_score, top_of_page_score, ranking_quality')
    .eq('property_url', propertyUrl)[cmp]('audit_date', date);
  if (cmp === 'lt') q = q.eq('ranking_quality', 'complete');
  const { data } = await q.order('audit_date', { ascending: false }).limit(1);
  return data?.[0] || null;
}

async function rankingRows(sb, propertyUrl, auditDate, table = 'keyword_rankings') {
  if (!auditDate) return [];
  const { data } = await sb.from(table).select('best_rank_group, serp_surface_stack').eq('property_url', propertyUrl).eq('audit_date', auditDate);
  return data || [];
}

const top10Of = (rows) => rows.filter((r) => r.best_rank_group != null && r.best_rank_group <= 10).length;

/** Inputs for this week vs the latest earlier audit. tables lets the replay read the 2 Nov backups. */
export async function loadBriefGateInputs(sb, { propertyUrl, weekStart, steps = [], shownFindings = [], latestFullRunStart = null, tables = {}, blocks = null }) {
  const cur = await auditRow(sb, propertyUrl, 'gte', weekStart);
  const prev = await auditRow(sb, propertyUrl, 'lt', weekStart);
  const curRows = await rankingRows(sb, propertyUrl, cur?.audit_date, tables.rankings);
  const prevRows = await rankingRows(sb, propertyUrl, prev?.audit_date);
  return {
    current: cur ? { ...cur, ...(tables.auditOverride || {}), top10: top10Of(curRows) } : null,
    previous: prev ? { ...prev, top10: top10Of(prevRows) } : null,
    rankingRows: curRows,
    shownFindings,
    latestFullRunStart,
    steps,
    blocks,
  };
}
