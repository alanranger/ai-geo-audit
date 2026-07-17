/**
 * Phase 2 — Surface outcomes table (won-of-served %) + biggest-gap callout.
 * Money keywords only (local-money / regional-money / national-money). No penalty for unserved surfaces.
 */

function demandVol(row) {
  const v = row?.search_volume;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return 10;
  return Number(v);
}

function stackOf(row) {
  return Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
}

function aioServed(row) {
  const stack = stackOf(row);
  if (stack.some((e) => e?.type === 'ai_overview' && e?.slot != null)) return true;
  return row?.ai_overview_present_any === true || row?.has_ai_overview === true;
}

function aioOwned(row) {
  if ((Number(row?.ai_alan_citations_count) || 0) > 0) return true;
  return stackOf(row).some((e) => e?.type === 'ai_overview' && e?.ours === true);
}

function packServed(row) {
  if (row?.local_pack_present_any === true) return true;
  return stackOf(row).some((e) => e?.type === 'local_pack' && e?.slot != null);
}

function packOwned(row) {
  if (row?.local_pack_position != null && Number(row.local_pack_position) > 0) return true;
  return stackOf(row).some((e) => e?.type === 'local_pack' && e?.our_position != null);
}

function boxServed(row) {
  if (row?.featured_snippet_present_any === true || row?.paa_present_any === true) return true;
  return stackOf(row).some(
    (e) => (e?.type === 'featured_snippet' || e?.type === 'people_also_ask') && e?.slot != null
  );
}

function boxOwned(row) {
  return row?.featured_snippet_ours === true || row?.paa_ours === true;
}

function organicServed(row) {
  return row?.best_rank_group != null && Number(row.best_rank_group) > 0;
}

function organicOwned(row) {
  const r = Number(row?.best_rank_group);
  return Number.isFinite(r) && r > 0 && r <= 10;
}

const SURFACE_DEFS = [
  { key: 'ai_answer', label: 'AI answer', served: aioServed, owned: aioOwned },
  { key: 'map_pack', label: 'Map pack', served: packServed, owned: packOwned },
  { key: 'answer_boxes', label: 'Answer boxes', served: boxServed, owned: boxOwned },
  { key: 'organic_top10', label: 'Organic top-10', served: organicServed, owned: organicOwned },
];

function emptyCell() {
  return { served: 0, owned: 0, pct: null, avgPos: null, gapVol: 0 };
}

function rollCell(rows, def) {
  const cell = emptyCell();
  let posSum = 0;
  let posN = 0;
  for (const row of rows) {
    if (!def.served(row)) continue;
    cell.served += 1;
    if (def.owned(row)) cell.owned += 1;
    else cell.gapVol += demandVol(row);
    if (def.key === 'organic_top10') {
      const p = Number(row.best_rank_group);
      if (Number.isFinite(p) && p > 0) {
        posSum += p;
        posN += 1;
      }
    }
  }
  cell.pct = cell.served > 0 ? Math.round((100 * cell.owned) / cell.served) : null;
  cell.avgPos = posN > 0 ? Math.round((posSum / posN) * 10) / 10 : null;
  return cell;
}

/** Demand-share suffix for biggest-gap callout — never "all X" unless ~100% of gapVol. */
export function buildClassGapSuffix(classGaps, gapTotal) {
  if (!classGaps.length) return '';
  const total = gapTotal > 0 ? gapTotal : 1;
  const topShare = classGaps[0].gap / total;
  if (classGaps.length === 1 && topShare >= 0.995) {
    return ` — all ${classGaps[0].label}`;
  }
  if (topShare >= 0.7) return ` — mostly ${classGaps[0].label}`;
  if (classGaps.length >= 2) {
    const topTwo = (classGaps[0].gap + classGaps[1].gap) / total;
    if (topTwo >= 0.85) {
      return ` — mostly ${classGaps.slice(0, 2).map((c) => c.label).join(' + ')}`;
    }
  }
  const parts = classGaps
    .filter((c) => c.gap / total >= 0.05)
    .slice(0, 3)
    .map((c) => `${Math.round((100 * c.gap) / total)}% ${c.label}`);
  return parts.length ? ` — ${parts.join(', ')}` : '';
}

/**
 * @param {Array} rows combinedRows from Ranking & AI
 * @returns {{ rows: Array, biggestGap: object|null, moneyVol: number }}
 */
export function computeSurfaceOutcomesRollup(rows) {
  const money = (Array.isArray(rows) ? rows : []).filter(
    (r) => {
      const cls = r?.keyword_class;
      return cls === 'local-money' || cls === 'regional-money' || cls === 'national-money';
    }
  );
  const local = money.filter((r) => r.keyword_class === 'local-money');
  const regional = money.filter((r) => r.keyword_class === 'regional-money');
  const national = money.filter((r) => r.keyword_class === 'national-money');
  const moneyVol = money.reduce((s, r) => s + demandVol(r), 0);

  const tableRows = SURFACE_DEFS.map((def) => {
    const localCell = rollCell(local, def);
    const regionalCell = rollCell(regional, def);
    const nationalCell = rollCell(national, def);
    const overallCell = rollCell(money, def);
    const gapVol = localCell.gapVol + regionalCell.gapVol + nationalCell.gapVol;
    return {
      key: def.key,
      label: def.label,
      overall: overallCell,
      local: localCell,
      regional: regionalCell,
      national: nationalCell,
      gapVol,
      gapPctOfMoney: moneyVol > 0 ? Math.round((100 * gapVol) / moneyVol) : 0,
    };
  });

  let biggest = null;
  // Callout: AI / Map / Organic only (Answer boxes stay in table but PAA volume skews the headline).
  for (const row of tableRows) {
    if (row.key === 'answer_boxes') continue;
    if (!biggest || row.gapVol > biggest.gapVol) biggest = row;
  }

  let callout = null;
  if (biggest && biggest.gapVol > 0 && moneyVol > 0) {
    // Attribute by uncited/unowned DEMAND volume share — never "all X" unless that class is 100% of gapVol.
    const classGaps = [
      { label: 'local', gap: biggest.local?.gapVol || 0 },
      { label: 'regional', gap: biggest.regional?.gapVol || 0 },
      { label: 'national', gap: biggest.national?.gapVol || 0 },
    ].filter((c) => c.gap > 0).sort((a, b) => b.gap - a.gap);
    const gapTotal = classGaps.reduce((s, c) => s + c.gap, 0) || 1;
    const suffix = buildClassGapSuffix(classGaps, gapTotal);
    callout = {
      surfaceKey: biggest.key,
      surfaceLabel: biggest.label,
      gapPct: biggest.gapPctOfMoney,
      text: biggest.key === 'ai_answer'
        ? `${biggest.gapPctOfMoney}% of money-search demand is in AI answers you're not cited in${suffix}.`
        : `${biggest.gapPctOfMoney}% of money-search demand sits on ${biggest.label.toLowerCase()} gaps${suffix}.`,
    };
  }

  return { rows: tableRows, biggestGap: callout, moneyVol, moneyCount: money.length };
}

export { SURFACE_DEFS, aioServed, aioOwned, packServed, packOwned, boxServed, boxOwned };
