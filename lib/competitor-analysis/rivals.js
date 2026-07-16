/**
 * Aggregate money-keyword rivals from serp_surface_stack owners.
 * Wires the unused aggregateStackOwners pattern for organic + local_pack.
 */
import {
  MONEY_KEYWORD_CLASSES,
  NOISE_DOMAIN_TYPES,
  AUTO_SUGGEST_FLAG_THRESHOLD,
} from './constants.js';

function normDomain(raw) {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!d || d.includes(' ') || !d.includes('.')) return null;
  if (d.endsWith('.google.com')) return null;
  return d;
}

function isMoneyRow(row) {
  return MONEY_KEYWORD_CLASSES.includes(row?.keyword_class || 'national-money');
}

function rivalBeatsUs(el, owner) {
  if (!el || !owner || owner.ours) return false;
  const pos = owner.position != null ? Number(owner.position) : null;
  const ourPos = el.our_position != null ? Number(el.our_position) : null;
  if (pos == null || !Number.isFinite(pos)) return false;
  if (ourPos == null || !Number.isFinite(ourPos)) return true;
  return pos < ourPos;
}

function whereBadge(hasOrganic, hasPack) {
  if (hasOrganic && hasPack) return 'both';
  if (hasPack) return 'pack';
  if (hasOrganic) return 'organic';
  return '—';
}

export function aggregateMoneyRivals(rows, targetRoot = 'alanranger.com') {
  const self = normDomain(targetRoot);
  const rivals = new Map();

  for (const row of rows || []) {
    if (!isMoneyRow(row)) continue;
    const kw = String(row.keyword || '').trim();
    const stack = Array.isArray(row.serp_surface_stack) ? row.serp_surface_stack : [];

    for (const el of stack) {
      if (!el?.slot || (el.type !== 'organic' && el.type !== 'local_pack')) continue;
      const owners = Array.isArray(el.owners) ? el.owners : [];

      for (const owner of owners) {
        if (owner?.ours) continue;
        const domain = normDomain(owner.domain || owner.name);
        if (!domain || domain === self) continue;

        if (!rivals.has(domain)) {
          rivals.set(domain, {
            domain,
            moneyKwBeaten: new Set(),
            organicAppearances: 0,
            packAppearances: 0,
            hasOrganic: false,
            hasPack: false,
            sampleKeywords: [],
          });
        }
        const rec = rivals.get(domain);
        if (el.type === 'organic') {
          rec.organicAppearances += 1;
          rec.hasOrganic = true;
        }
        if (el.type === 'local_pack') {
          rec.packAppearances += 1;
          rec.hasPack = true;
        }
        if (rivalBeatsUs(el, owner) && kw) rec.moneyKwBeaten.add(kw);
        if (kw && rec.sampleKeywords.length < 5 && !rec.sampleKeywords.includes(kw)) {
          rec.sampleKeywords.push(kw);
        }
      }
    }
  }

  return Array.from(rivals.values())
    .map((r) => ({
      domain: r.domain,
      moneyKwBeaten: r.moneyKwBeaten.size,
      organicAppearances: r.organicAppearances,
      packAppearances: r.packAppearances,
      where: whereBadge(r.hasOrganic, r.hasPack),
      sampleKeywords: r.sampleKeywords,
    }))
    .sort((a, b) => b.moneyKwBeaten - a.moneyKwBeaten || b.organicAppearances - a.organicAppearances);
}

export function passesNoiseFilter(domainType, isCompetitor, independentsOnly) {
  if (!independentsOnly) return true;
  if (isCompetitor) return true;
  return !NOISE_DOMAIN_TYPES.has(domainType || 'unmapped');
}

export function needsAutoSuggest(moneyKwBeaten, isCompetitor) {
  return moneyKwBeaten >= AUTO_SUGGEST_FLAG_THRESHOLD && !isCompetitor;
}

export { AUTO_SUGGEST_FLAG_THRESHOLD, NOISE_DOMAIN_TYPES };
