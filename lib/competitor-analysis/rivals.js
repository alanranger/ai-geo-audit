/**
 * Keyword-driven rival helpers from serp_surface_stack (organic + local_pack).
 * Replaces unused aggregateStackOwners rollup for Competitor Analysis v3.
 */
import {
  MONEY_KEYWORD_CLASSES,
  NOISE_DOMAIN_TYPES,
  AUTO_SUGGEST_FLAG_THRESHOLD,
} from './constants.js';

export function normDomain(raw) {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!d || d.includes(' ') || !d.includes('.')) return null;
  if (d.endsWith('.google.com') || d === 'google.com' || d === 'youtube.com') return null;
  return d;
}

export function normKeyword(kw) {
  return String(kw || '').trim().toLowerCase();
}

function isOurs(owner, self) {
  if (!owner) return false;
  if (owner.ours === true) return true;
  const d = normDomain(owner.domain);
  return d && self && (d === self || d.endsWith('.' + self));
}

function surfaceLabel(type) {
  if (type === 'local_pack') return 'Map';
  if (type === 'organic') return 'Organic';
  return type || '—';
}

/** Best (lowest) position wins; ties prefer map pack. */
function betterSurface(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.position !== b.position) return a.position < b.position ? a : b;
  if (a.surface === 'local_pack') return a;
  if (b.surface === 'local_pack') return b;
  return a;
}

/**
 * Extract you + rival candidates from one keyword row (pre-noise filter).
 */
export function extractKeywordSurfaces(row, selfDomain = 'alanranger.com') {
  const self = normDomain(selfDomain);
  const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
  let yourBest = null;
  const rivals = new Map();
  let packHasUs = false;
  let packHasRival = false;
  let hasSerp = false;

  for (const type of ['local_pack', 'organic']) {
    const el = stack.find((e) => e?.type === type && e.slot != null);
    if (!el) continue;
    hasSerp = true;
    const owners = Array.isArray(el.owners) ? el.owners : [];

    if (el.ours || (el.our_position != null && Number.isFinite(Number(el.our_position)))) {
      const pos = el.our_position != null ? Number(el.our_position) : null;
      if (pos != null && Number.isFinite(pos)) {
        yourBest = betterSurface(yourBest, { surface: type, position: pos, label: surfaceLabel(type) });
        if (type === 'local_pack') packHasUs = true;
      }
    }

    for (const owner of owners) {
      if (isOurs(owner, self)) {
        if (type === 'local_pack') packHasUs = true;
        const pos = owner.position != null ? Number(owner.position) : null;
        if (pos != null && Number.isFinite(pos)) {
          yourBest = betterSurface(yourBest, { surface: type, position: pos, label: surfaceLabel(type) });
        }
        continue;
      }
      const domain = normDomain(owner.domain);
      const name = (owner.name || domain || '').trim();
      if (!domain && !name) continue;
      const key = domain || name.toLowerCase();
      const pos = owner.position != null ? Number(owner.position) : null;
      if (pos == null || !Number.isFinite(pos)) continue;
      if (type === 'local_pack') packHasRival = true;

      const cand = {
        domain: domain || null,
        name: name || domain,
        surface: type,
        position: pos,
        label: surfaceLabel(type),
      };
      const prev = rivals.get(key);
      if (!prev || betterSurface(cand, prev) === cand) rivals.set(key, cand);
    }
  }

  return {
    hasSerp,
    yourBest,
    rivals: Array.from(rivals.values()),
    packContested: packHasUs && packHasRival,
  };
}

export function passesNoiseFilter(domainType, isCompetitor, independentsOnly) {
  if (!independentsOnly) return true;
  if (isCompetitor) return true;
  return !NOISE_DOMAIN_TYPES.has(domainType || 'unmapped');
}

/**
 * Top N non-Alan rivals after noise filter, by best position.
 */
export function topRivalsForKeyword(extracted, metaByDomain, independentsOnly, n = 3) {
  const filtered = (extracted?.rivals || []).filter((r) => {
    const d = r.domain;
    if (!d) return !independentsOnly; // name-only pack entries: keep unless noise-only mode needs domain_type
    const m = metaByDomain[d] || {};
    return passesNoiseFilter(m.domain_type, m.is_competitor === true, independentsOnly);
  });
  filtered.sort((a, b) => a.position - b.position || (a.surface === 'local_pack' ? -1 : 1));
  return filtered.slice(0, n);
}

export function keywordStatus(extracted, topRival) {
  if (!extracted?.hasSerp) return 'no-serp';
  if (extracted.packContested) {
    // Still classify win/loss; pack-contested is also a filter flag
  }
  const you = extracted.yourBest;
  if (topRival && you && topRival.position < you.position) return 'rival-beats';
  if (topRival && !you) return 'rival-beats';
  if (you && (!topRival || you.position < topRival.position)) return 'you-win';
  if (you && topRival && you.position === topRival.position) return 'tied';
  if (!you && !topRival) return 'no-rival';
  return 'rival-beats';
}

export function formatSurfacePos(best) {
  if (!best || best.position == null) return '—';
  return `${best.label} #${best.position}`;
}

export function isMoneyClass(cls) {
  return MONEY_KEYWORD_CLASSES.includes(cls || 'national-money');
}

export function needsAutoSuggest(moneyKwBeaten, isCompetitor) {
  return moneyKwBeaten >= AUTO_SUGGEST_FLAG_THRESHOLD && !isCompetitor;
}

/** Domain census: money keywords where rival beats you (for suggest chips). */
export function aggregateMoneyRivals(rows, targetRoot = 'alanranger.com') {
  const self = normDomain(targetRoot);
  const rivals = new Map();

  for (const row of rows || []) {
    if (!isMoneyClass(row?.keyword_class)) continue;
    const kw = String(row.keyword || '').trim();
    const extracted = extractKeywordSurfaces(row, self);
    const top = topRivalsForKeyword(extracted, {}, false, 20);
    for (const r of top) {
      if (!r.domain) continue;
      if (!rivals.has(r.domain)) {
        rivals.set(r.domain, { domain: r.domain, beaten: new Set(), organic: 0, pack: 0 });
      }
      const rec = rivals.get(r.domain);
      if (r.surface === 'organic') rec.organic += 1;
      if (r.surface === 'local_pack') rec.pack += 1;
      const status = keywordStatus(extracted, r);
      if (status === 'rival-beats' && kw) rec.beaten.add(kw);
    }
  }

  return Array.from(rivals.values())
    .map((r) => ({
      domain: r.domain,
      moneyKwBeaten: r.beaten.size,
      organicAppearances: r.organic,
      packAppearances: r.pack,
      where: r.organic && r.pack ? 'both' : r.pack ? 'pack' : r.organic ? 'organic' : '—',
    }))
    .sort((a, b) => b.moneyKwBeaten - a.moneyKwBeaten || b.organicAppearances - a.organicAppearances);
}

export { AUTO_SUGGEST_FLAG_THRESHOLD, NOISE_DOMAIN_TYPES, MONEY_KEYWORD_CLASSES };
