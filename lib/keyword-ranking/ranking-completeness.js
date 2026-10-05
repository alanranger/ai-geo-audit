/**
 * Ranking audit completeness — null-stack / empty-capture guard.
 * Incomplete days must not be treated as "latest" for dials or CEO surfaces.
 */

export const NULL_STACK_INCOMPLETE_PCT = 0.10;

export function assessRankingCompleteness(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  let nullStack = 0;
  let emptyCapture = 0;
  let incompleteCapture = 0;
  for (const row of list) {
    const stack = row?.serp_surface_stack;
    const emptyStack = stack == null || (Array.isArray(stack) && stack.length === 0);
    if (emptyStack) nullStack += 1;
    const st = String(row?.serp_features?.capture_status || '').toLowerCase();
    if (st === 'empty') emptyCapture += 1;
    if (st === 'incomplete') incompleteCapture += 1;
  }
  const failedLike = Math.max(nullStack, emptyCapture + incompleteCapture);
  const nullStackPct = n ? nullStack / n : 0;
  const failedPct = n ? failedLike / n : 0;
  const incomplete = n > 0 && (nullStackPct > NULL_STACK_INCOMPLETE_PCT || failedPct > NULL_STACK_INCOMPLETE_PCT);
  return {
    n,
    null_stack: nullStack,
    empty_capture: emptyCapture,
    incomplete_capture: incompleteCapture,
    null_stack_pct: nullStackPct,
    failed_pct: failedPct,
    incomplete,
    ranking_quality: incomplete ? 'incomplete' : 'complete',
    reason: incomplete
      ? `null_stack ${nullStack}/${n} (${(nullStackPct * 100).toFixed(1)}%)`
      : null,
  };
}

export function rankingFallbackBanner({ incompleteDate, completeDate, missing, total }) {
  if (!incompleteDate || !completeDate) return null;
  return `Using ${completeDate} — ${incompleteDate} incomplete (${missing} of ${total} missing)`;
}

/** Prefer rows that will not wipe a prior good stack on finalize. */
export function filterFinalizeKeywordRows(rows = []) {
  return (rows || []).filter((row) => {
    const stack = row?.serp_surface_stack;
    const hasStack = Array.isArray(stack) && stack.length > 0;
    if (hasStack) return true;
    const org = Number(row?.organic_count ?? row?.serp_features?.organic_count ?? 0);
    // organic_count>0 with empty stack = slim/corrupt observation — keep prior batch save
    if (org > 0) return false;
    return true;
  });
}

export async function markAuditRankingQuality({
  propertyUrl,
  auditDate,
  assessment,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
} = {}) {
  if (!supabaseUrl || !supabaseKey || !propertyUrl || !auditDate || !assessment) {
    throw new Error('markAuditRankingQuality: missing args');
  }
  const nowIso = new Date().toISOString();
  const row = {
    property_url: propertyUrl,
    audit_date: String(auditDate).slice(0, 10),
    ranking_incomplete: assessment.incomplete === true,
    ranking_quality: assessment.ranking_quality,
    ranking_quality_detail: {
      null_stack: assessment.null_stack,
      empty_capture: assessment.empty_capture,
      incomplete_capture: assessment.incomplete_capture,
      n: assessment.n,
      null_stack_pct: assessment.null_stack_pct,
      reason: assessment.reason,
      checked_at: nowIso,
    },
    updated_at: nowIso,
  };
  const r = await fetch(`${supabaseUrl}/rest/v1/audit_results?on_conflict=property_url,audit_date`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`markAuditRankingQuality ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return row;
}

export async function resolveLatestCompleteAuditDate({
  propertyUrl,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
} = {}) {
  if (!supabaseUrl || !supabaseKey || !propertyUrl) return null;
  const q = new URLSearchParams({
    property_url: `eq.${propertyUrl}`,
    or: '(ranking_incomplete.is.null,ranking_incomplete.eq.false)',
    select: 'audit_date,ranking_incomplete,ranking_quality,ranking_quality_detail',
    order: 'audit_date.desc',
    limit: '1',
  });
  const r = await fetch(`${supabaseUrl}/rest/v1/audit_results?${q}`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] || null;
}
