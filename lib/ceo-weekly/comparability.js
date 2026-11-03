/**
 * Week-on-week deltas are only shown when last week's figure has the same basis (source + definition).
 * When the basis changed — or last week recorded no basis and the swing is implausible — the delta is
 * withheld ("—") with a reason; the brief gate and System health report every withheld block.
 */
import { basisTag } from './backlink-basis.js';

export const SWING_LIMITS = {
  backlinksShare: 0.5,   // referring domains / backlinks / DA-band counts moving > 50% in a week
  seoHealthPoints: 20,   // SEO-health score moving > 20 points in a week
  seoScopeShare: 0.2     // evaluated-page count changing > 20%
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (ymd) => `${Number(ymd.slice(8, 10))} ${MON[Number(ymd.slice(5, 7)) - 1]}`;

export function withheldWow(reason) {
  return { delta: null, arrow: '—', label: '—', pending: false, withheld: true, reason };
}

const shareMove = (cur, prev) => (Number(prev) > 0 && cur != null ? Math.abs(Number(cur) - Number(prev)) / Number(prev) : 0);

/** Backlink index basis: filter version + how the index was built (a weekly full live re-fetch, or deltas on top). */
export function backlinkBasis(state) {
  if (!state) return null;
  return { tag: basisTag(state), filters_version: state.filters_version || null, ingest: state.last_ingest_action || null, last_full_at: state.last_full_at || null };
}

function tagComparable(pb, cur, moves) {
  if (pb.tag !== cur.basis.tag) return { ok: false, reason: `backlink basis changed (${pb.tag} → ${cur.basis.tag})` };
  return Math.max(...moves) > SWING_LIMITS.backlinksShare
    ? { ok: true, implausible: true, reason: `backlink counts moved over ${SWING_LIMITS.backlinksShare * 100}% on the same basis (${cur.basis.tag})` }
    : { ok: true, tag: cur.basis.tag };
}

/** { ok, reason } — may this week's backlink counts be compared with last week's? */
export function backlinksComparable(cur, priorBl) {
  const pb = priorBl?.index_basis;
  const moves = [shareMove(cur.referring_domains, priorBl?.referring_domains), shareMove(cur.backlinks, priorBl?.backlinks)];
  if (pb?.tag && cur.basis?.tag) return tagComparable(pb, cur, moves);
  // No basis recorded last week: only an implausible swing proves the source changed.
  if (Math.max(...moves) > SWING_LIMITS.backlinksShare) {
    const when = cur.basis?.last_full_at ? dayMonth(String(cur.basis.last_full_at).slice(0, 10)) : 'this week';
    return { ok: false, reason: `backlink index rebuilt ${when} (fresh live-only re-fetch); last week's counts came from the older index` };
  }
  return { ok: true };
}

/** { ok, reason } — may this week's SEO-health score be compared with last week's? */
export function seoHealthComparable(cur, priorSh) {
  const pu = Number(priorSh?.evaluated_urls);
  const prev = Number(priorSh?.score);
  if (pu > 0 && cur.evaluated_urls > 0) {
    if (shareMove(cur.evaluated_urls, pu) > SWING_LIMITS.seoScopeShare) {
      return { ok: false, reason: `evaluation scope changed (${pu} → ${cur.evaluated_urls} pages)` };
    }
    return Math.abs(cur.score - prev) > SWING_LIMITS.seoHealthPoints
      ? { ok: true, implausible: true, reason: `score moved ${prev} → ${cur.score} on the same evaluation scope` }
      : { ok: true };
  }
  if (Number.isFinite(prev) && cur.score != null && Math.abs(cur.score - prev) > SWING_LIMITS.seoHealthPoints) {
    return { ok: false, reason: `score moved ${prev} → ${cur.score}; last week recorded no evaluation scope, so the two aren't comparable` };
  }
  return { ok: true };
}
