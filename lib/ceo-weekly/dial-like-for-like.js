/**
 * Surface / Top of page week-on-week for the Monday brief: when the scan stored a same-keyword comparison
 * (audit_results.ranking_quality_detail.stability.cohort.like_for_like, see scan-stability-guard.js), the chip
 * shows that pair instead of the two stored audit rows, so a re-run or a keyword-set change can't fake a move.
 * Same pair the pre-send gate checks (brief-gate.js dialPair).
 */
import { deltaArrow } from './shared.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The stored like-for-like comparison on an audit row, or null when the scan has none. */
export function likeForLikeOf(row) {
  const stability = row?.ranking_quality_detail?.stability;
  const lfl = stability?.cohort?.like_for_like;
  if (!(Number(lfl?.keywords) > 0)) return null;
  return { ...lfl, prior_audit_date: stability.prior_audit_date || null };
}

/** chipFromHistory() output → the like-for-like chip (value + ▲/▼ vs the same keywords last scan). */
export function withLikeForLike(chip, lfl, field) {
  if (!lfl || chip?.stale || chip?.withheld) return chip;
  const cur = num(lfl.current?.[field]);
  const prev = num(lfl.prior?.[field]);
  if (cur == null || prev == null) return chip;
  return {
    ...chip,
    value: cur,
    wow: { ...deltaArrow(cur, prev), basis: 'like_for_like' },
    prior_value: prev,
    vs_audit_date: lfl.prior_audit_date || chip.vs_audit_date,
    basis: 'like_for_like',
    like_for_like_keywords: Number(lfl.keywords),
    basis_note: lfl.note || null,
  };
}

/** Dial line score: the chip's like-for-like value when used, else the stored audit score. */
export function dialScore(chip, row, field) {
  return chip?.basis === 'like_for_like' ? chip.value : num(row?.[field]);
}

/** One line under the dial chips when the stored comparison carries an explanation (e.g. a replaced re-run). */
export function dialBasisNote(chips) {
  return chips?.surface_vis?.basis_note || chips?.top_of_page?.basis_note || '';
}
