/**
 * Phase 2 — Surface outcomes table (won-of-served %) + biggest-gap callout.
 * Money keywords only (local-money / national-money). No penalty for unserved surfaces.
 */

function demandVol(row) {
  const v = row?.search_volume;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return 10;
  return Number(v);
}

function stackOf(row) {
  return Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
}

/** Same SoT as Ranking census / scan: classic SERP stack slot only (not has_ai_overview flags). */
function aioServed(row) {
  return stackOf(row).some((e) => e?.type === 'ai_overview' && e?.slot != null);
}

/** Same SoT as stackOwnsSurface(ai_overview): stack.ours only — AI Mode citation counts are diagnostics. */
function aioOwned(row) {
  return stackOf(row).some((e) => e?.type === 'ai_overview' && e?.slot != null && e?.ours === true);
}

function packServed(row) {
  if (row?.local_pack_present_any === true) return true;
  return stackOf(row).some((e) => e?.type === 'local_pack' && e?.slot != null);
}

function packOwned(row) {
  if (row?.local_pack_position != null && Number(row.local_pack_position) > 0) return true;
  return stackOf(row).some((e) => e?.type === 'local_pack' && e?.our_position != null);
}

/**
 * MC-57 Option A: "Answer boxes" = featured snippet only, stack-gated (same SoT as aioServed).
 * People Also Ask is a distinct surface and is NOT an answer box — excluded. Flags are not
 * trusted (they over-count); served only when the SERP stack actually shows a featured snippet.
 */
function boxServed(row) {
  return stackOf(row).some((e) => e?.type === 'featured_snippet' && e?.slot != null);
}

function boxOwned(row) {
  return stackOf(row).some((e) => e?.type === 'featured_snippet' && e?.slot != null && e?.ours === true);
}

function organicServed(row) {
  return row?.best_rank_group != null && Number(row.best_rank_group) > 0;
}

function organicOwned(row) {
  const r = Number(row?.best_rank_group);
  return Number.isFinite(r) && r > 0 && r <= 10;
}

/** Google AI Mode (standalone product) — diagnostics only; not classic SERP stack. */
function aimodeServed(row) {
  return !!(row?.ai_engines?.google_ai_mode?.present);
}

function aimodeOwned(row) {
  const slot = row?.ai_engines?.google_ai_mode;
  if (!slot?.present) return false;
  return (Number(slot.alan_citations_count) || 0) > 0;
}

/** PAA — stack-gated only (never paa_present_any / paa_ours flags alone). */
function paaServed(row) {
  return stackOf(row).some((e) => e?.type === 'people_also_ask' && e?.slot != null);
}

function paaOwned(row) {
  return stackOf(row).some((e) => e?.type === 'people_also_ask' && e?.slot != null && e?.ours === true);
}

/** Knowledge panel — show-only on Outcomes (money CLASS_WEIGHTS.kp = 0; not scored). */
function kpServed(row) {
  if (row?.kp_present === true) return true;
  return stackOf(row).some((e) => e?.type === 'knowledge_panel');
}

function kpOwned(row) {
  if (row?.kp_ours === true) return true;
  return stackOf(row).some((e) => e?.type === 'knowledge_panel' && e?.ours === true);
}

const SURFACE_DEFS = [
  { key: 'ai_answer', label: 'Google AI Overview', served: aioServed, owned: aioOwned, weightKey: 'aio' },
  {
    key: 'google_ai_mode',
    label: 'Google AI Mode',
    served: aimodeServed,
    owned: aimodeOwned,
    diagnostic: true,
  },
  { key: 'map_pack', label: 'Map pack', served: packServed, owned: packOwned, weightKey: 'pack' },
  // Featured snippet only (MC-57) — classic SERP answer box, not AI Overview.
  { key: 'answer_boxes', label: 'Featured snippet', served: boxServed, owned: boxOwned, weightKey: 'fs_paa' },
  { key: 'paa', label: 'People Also Ask', served: paaServed, owned: paaOwned, weightKey: 'paa' },
  {
    key: 'knowledge_panel',
    label: 'Knowledge panel',
    served: kpServed,
    owned: kpOwned,
    showOnly: true, // money weight 0 — transparency only
    weightKey: 'kp',
  },
  { key: 'organic_top10', label: 'Organic top-10', served: organicServed, owned: organicOwned, weightKey: 'organic' },
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
      // regional-money retired (2026-08): local + national only
      return cls === 'local-money' || cls === 'national-money';
    }
  );
  const local = money.filter((r) => r.keyword_class === 'local-money');
  const national = money.filter((r) => r.keyword_class === 'national-money');
  const moneyVol = money.reduce((s, r) => s + demandVol(r), 0);

  const tableRows = SURFACE_DEFS.map((def) => {
    const localCell = rollCell(local, def);
    const nationalCell = rollCell(national, def);
    const overallCell = rollCell(money, def);
    const gapVol = localCell.gapVol + nationalCell.gapVol;
    return {
      key: def.key,
      label: def.label,
      diagnostic: !!def.diagnostic,
      showOnly: !!def.showOnly,
      weightKey: def.weightKey ?? null,
      overall: overallCell,
      local: localCell,
      national: nationalCell,
      gapVol,
      gapPctOfMoney: moneyVol > 0 ? Math.round((100 * gapVol) / moneyVol) : 0,
    };
  });

  let biggest = null;
  // Callout: scored leverage surfaces — skip Answer boxes FS-only, KP show-only, diagnostic AI Mode.
  // PAA is included (Alan 2026-08-10 scored surface).
  for (const row of tableRows) {
    if (row.key === 'answer_boxes' || row.key === 'knowledge_panel' || row.diagnostic || row.showOnly || row.key === 'google_ai_mode') continue;
    if (!biggest || row.gapVol > biggest.gapVol) biggest = row;
  }

    let callout = null;
  if (biggest && biggest.gapVol > 0 && moneyVol > 0) {
    // Attribute by uncited/unowned DEMAND volume share — never "all X" unless that class is 100% of gapVol.
    const classGaps = [
      { label: 'local', gap: biggest.local?.gapVol || 0 },
      { label: 'national', gap: biggest.national?.gapVol || 0 },
    ].filter((c) => c.gap > 0).sort((a, b) => b.gap - a.gap);
    const gapTotal = classGaps.reduce((s, c) => s + c.gap, 0) || 1;
    const suffix = buildClassGapSuffix(classGaps, gapTotal);
    let text;
    if (biggest.key === 'ai_answer') {
      text = `${biggest.gapPctOfMoney}% of money-search demand is in Google AI Overviews you're not cited in${suffix}.`;
    } else if (biggest.key === 'paa') {
      // PAA presence is snapshot-based (single DFS scrape context) and can differ from
      // personalised/local live SERPs — do not present the % as a settled estate fact.
      text = `On this scrape, ~${biggest.gapPctOfMoney}% of money-search demand was where People Also Ask showed and you were unowned${suffix}. PAA presence is volatile across location/login — verify high-volume terms live before treating the figure as settled.`;
    } else {
      text = `${biggest.gapPctOfMoney}% of money-search demand sits on ${biggest.label.toLowerCase()} gaps${suffix}.`;
    }
    callout = {
      surfaceKey: biggest.key,
      surfaceLabel: biggest.label,
      gapPct: biggest.gapPctOfMoney,
      text,
    };
  }

  return { rows: tableRows, biggestGap: callout, moneyVol, moneyCount: money.length };
}

export {
  SURFACE_DEFS,
  aioServed,
  aioOwned,
  aimodeServed,
  aimodeOwned,
  packServed,
  packOwned,
  boxServed,
  boxOwned,
  paaServed,
  paaOwned,
  kpServed,
  kpOwned,
};
