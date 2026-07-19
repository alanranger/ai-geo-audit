/**
 * Phase-1 build tool for pages_master + parity report.
 * After Phase 2, classifications are source of truth — do NOT use this to "re-sync" tiers.
 *
 * Usage:
 *   node scripts/backfill-pages-master-shadow.mjs              # dry-run report only
 *   node scripts/backfill-pages-master-shadow.mjs --apply       # MERGE: insert new paths only
 *   node scripts/backfill-pages-master-shadow.mjs --apply --overwrite-classifications
 *       # last resort: DELETE+INSERT (refused if non-F rows exist unless flag set)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  UTILITY_PATHS,
  CANNIBAL_PATHS,
  FUNNEL_PATHS,
  pathOnly,
  moneyRoleForUrl
} from '../lib/audit/moneyPageRoles.js';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const apply = process.argv.includes('--apply');
const overwrite = process.argv.includes('--overwrite-classifications');
const PROPERTY = 'https://www.alanranger.com';
const SEG_CSV = path.join(root, '../alan-shared-resources/csv/page segmentation by tier.csv');
const SITE_06 = path.join(root, '../alan-shared-resources/csv/06-site-urls.csv');
const OUT_DIR = path.join(root, 'scripts/output');
const OUT_PARITY = path.join(OUT_DIR, 'pages-master-parity-report-LATEST.json');
const OUT_MD = path.join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/pages-master-parity-report-LATEST.md'
);

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const TIER_MAP = {
  landing: 'A_landing',
  product: 'B_product',
  event: 'C_event',
  blog: 'D_blog',
  academy: 'E_academy',
  unmapped: 'F_unmapped'
};

function parseCsvLine(line) {
  const columns = [];
  let current = '';
  let inQuotes = false;
  const text = String(line || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { current += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      columns.push(current.trim());
      current = '';
    } else current += ch;
  }
  columns.push(current.trim());
  return columns;
}

function tierKeyFromHeader(header) {
  const n = String(header || '').toLowerCase();
  if (n.includes('tier a') || n.includes('landing')) return 'landing';
  if (n.includes('tier b') || n.includes('product')) return 'product';
  if (n.includes('tier c') || n.includes('event')) return 'event';
  if (n.includes('tier d') || n.includes('blog')) return 'blog';
  if (n.includes('tier e') || n.includes('academy')) return 'academy';
  if (n.includes('tier f') || n.includes('unmapped')) return 'unmapped';
  return null;
}

function normUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s : `${PROPERTY}${s.startsWith('/') ? s : `/${s}`}`);
    u.hash = '';
    u.search = '';
    let p = (u.pathname || '/').replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    if (p === '/home') p = '/';
    return `${PROPERTY}${p || '/'}`;
  } catch {
    return '';
  }
}

function segmentTypeForMoney(tierLetter) {
  if (tierLetter === 'B_product' || tierLetter === 'product') return 'product';
  if (tierLetter === 'C_event' || tierLetter === 'event') return 'event';
  if (tierLetter === 'A_landing' || tierLetter === 'landing') return 'landing';
  return null;
}

function parseSegmentation(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return new Map();
  const headers = parseCsvLine(lines[0]);
  const colTier = headers.map(tierKeyFromHeader);
  const byPath = new Map(); // path -> { tier, explicit: true }
  for (let r = 1; r < lines.length; r += 1) {
    const cols = parseCsvLine(lines[r]);
    cols.forEach((cell, i) => {
      const tier = colTier[i];
      if (!tier || !cell) return;
      const url = normUrl(cell);
      if (!url) return;
      const p = pathOnly(url);
      // First explicit column wins if duplicate (prefer non-landing over landing when both?)
      // Spec: CSV membership is explicit. If in multiple tiers, prefer non-A.
      const next = TIER_MAP[tier];
      const prev = byPath.get(p);
      if (!prev) byPath.set(p, { tier: next, csvTier: tier });
      else if (prev.tier === 'A_landing' && next !== 'A_landing') {
        byPath.set(p, { tier: next, csvTier: tier });
      }
    });
  }
  return byPath;
}

function parse06(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const out = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const url = normUrl(cols[0]);
    if (url) out.add(pathOnly(url));
  }
  return out;
}

async function fetchOverrides() {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .select('page_url, target_keyword, target_class, notes')
      .eq('property_url', PROPERTY)
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function buildMaster(segByPath, site06, overrides) {
  const ovByPath = new Map();
  for (const o of overrides) {
    const p = pathOnly(o.page_url);
    if (p) ovByPath.set(p, o);
  }

  const allPaths = new Set([...site06, ...segByPath.keys(), ...ovByPath.keys()]);
  // Also ensure money role path sets are present
  for (const p of UTILITY_PATHS) allPaths.add(p);
  for (const p of CANNIBAL_PATHS) allPaths.add(p);
  for (const p of FUNNEL_PATHS) allPaths.add(p);

  const rows = [];
  for (const p of allPaths) {
    if (!p) continue;
    const url = p === '/' ? `${PROPERTY}/` : `${PROPERTY}${p}`;
    const seg = segByPath.get(p);
    const ov = ovByPath.get(p);

    let tier = seg?.tier || null;
    let flagged = false;
    let flagReason = '';
    const sources = [];

    if (seg) sources.push('segmentation_csv');
    if (ov) sources.push('overrides_db');
    if (site06.has(p)) sources.push('06_site_urls');

    // money_role from moneyPageRoles (needs segmentType heuristic from tier)
    const segType = segmentTypeForMoney(tier || 'landing');
    let moneyRole = moneyRoleForUrl(url, segType);
    if (moneyRole) sources.push('moneyPageRoles');

    // If path is only utility/cannibal/funnel from hardcoded sets and nowhere else:
    if (!seg && !ov && !site06.has(p) && moneyRole) {
      sources.push('moneyPageRoles_only');
    }

    // NO catch-all: in 06 (or nowhere) with no CSV tier and no money role and no override class
    // → F_unmapped flagged. Pages with CSV tier keep that tier.
    if (!tier) {
      if (moneyRole === 'utility' || moneyRole === 'cannibal' || moneyRole === 'funnel') {
        // Path-set pages without CSV: still need a tier. Utility often sat in Tier A historically.
        tier = moneyRole === 'utility' ? 'A_landing' : 'A_landing';
        if (!seg) {
          flagged = true;
          flagReason = 'tier_inferred_from_money_role_path_set; not in segmentation CSV';
        }
      } else if (ov?.target_class === 'none_utility') {
        tier = 'A_landing';
        moneyRole = moneyRole || 'utility';
        flagged = true;
        flagReason = 'none_utility override without CSV tier';
      } else {
        tier = 'F_unmapped';
        flagged = true;
        flagReason = 'no_explicit_tier_in_csv_or_path_sets';
      }
    }

    // D2: calendar hubs already in Tier A stay commercial via moneyRoleForUrl(landing)

    rows.push({
      property_url: PROPERTY,
      url,
      path: p,
      tier,
      money_role: moneyRole,
      target_keyword: ov ? String(ov.target_keyword || '') : '',
      target_class: ov?.target_class || null,
      notes: ov ? String(ov.notes || '') : '',
      source: sources.join('+') || 'unknown',
      flagged,
      flag_reason: flagReason,
      updated_at: new Date().toISOString()
    });
  }
  return rows;
}

function liveMoneyRole(url, liveTier) {
  return moneyRoleForUrl(url, segmentTypeForMoney(liveTier));
}

function liveTierFromSeg(segByPath, p) {
  return segByPath.get(p)?.tier || 'F_unmapped';
}

function buildParity(rows, segByPath) {
  const diffs = [];
  const expected = [];
  const unexpected = [];

  for (const row of rows) {
    const liveTier = liveTierFromSeg(segByPath, row.path);
    const liveRole = liveMoneyRole(row.url, liveTier === 'F_unmapped' ? null : liveTier);

    // Consumer "tier-segmentation.js" answer today = CSV lookup (or unmapped/missing)
    const csvTier = segByPath.has(row.path) ? segByPath.get(row.path).tier : null;
    const liveConsumerTier = csvTier || 'F_unmapped';

    if (row.tier !== liveConsumerTier) {
      const item = {
        path: row.path,
        field: 'tier',
        live: liveConsumerTier,
        pages_master: row.tier,
        money_role_live: liveRole,
        money_role_master: row.money_role
      };
      // EXPECTED: catch-all removals (was A via residual, now F) OR utility staying A but flagged
      if (liveConsumerTier === 'A_landing' && row.tier === 'F_unmapped') {
        item.class = 'EXPECTED';
        item.rule = 'no_catch_all: no explicit CSV membership → F_unmapped';
        expected.push(item);
      } else if (row.flagged && row.flag_reason) {
        item.class = 'EXPECTED';
        item.rule = row.flag_reason;
        expected.push(item);
      } else {
        item.class = 'UNEXPECTED';
        unexpected.push(item);
      }
      diffs.push(item);
    }

    // moneyPageRoles live vs master
    const roleLive = liveMoneyRole(row.url, csvTier || 'landing');
    if ((roleLive || null) !== (row.money_role || null)) {
      const item = {
        path: row.path,
        field: 'money_role',
        live: roleLive,
        pages_master: row.money_role,
        class: 'UNEXPECTED',
        rule: 'money_role should match moneyPageRoles.js given live tier heuristic'
      };
      // Master may use inferred tier for role when CSV missing
      if (!csvTier && row.money_role === roleLive) {
        /* identical */
      } else if ((roleLive || null) !== (row.money_role || null)) {
        // Recompute master-style: role from master's tier
        const roleFromMasterTier = moneyRoleForUrl(row.url, segmentTypeForMoney(row.tier));
        if (roleFromMasterTier === row.money_role) {
          item.class = 'EXPECTED';
          item.rule = 'role follows pages_master tier (CSV catch-all / unmapped shift)';
          expected.push(item);
        } else {
          unexpected.push(item);
        }
        diffs.push(item);
      }
    }
  }

  // Utility pages must NOT have commercial/event/product money roles
  const utilityBad = rows.filter(
    (r) => UTILITY_PATHS.has(r.path) && r.money_role && r.money_role !== 'utility'
  );

  const counts = {
    tier: {},
    money_role: {},
    flagged: rows.filter((r) => r.flagged).length,
    total: rows.length
  };
  for (const r of rows) {
    counts.tier[r.tier] = (counts.tier[r.tier] || 0) + 1;
    const mr = r.money_role || 'null';
    counts.money_role[mr] = (counts.money_role[mr] || 0) + 1;
  }

  const tierF = rows.filter((r) => r.tier === 'F_unmapped').map((r) => r.path).sort();
  const utilityRows = rows.filter((r) => UTILITY_PATHS.has(r.path));
  const cannibalRows = rows.filter((r) => CANNIBAL_PATHS.has(r.path));

  return {
    generatedAt: new Date().toISOString(),
    counts,
    utility_path_set: [...UTILITY_PATHS],
    utility_in_master: utilityRows.map((r) => ({
      path: r.path,
      tier: r.tier,
      money_role: r.money_role,
      target_class: r.target_class
    })),
    cannibal_in_master: cannibalRows.map((r) => ({
      path: r.path,
      tier: r.tier,
      money_role: r.money_role,
      target_class: r.target_class
    })),
    utility_not_money_ok: utilityRows.every((r) => r.money_role === 'utility' || r.money_role == null),
    utilityBad,
    tierF_count: tierF.length,
    tierF_sample: tierF.slice(0, 80),
    parity: {
      diff_count: diffs.length,
      expected_count: expected.length,
      unexpected_count: unexpected.length,
      expected: expected.slice(0, 200),
      unexpected: unexpected.slice(0, 200)
    },
    consumers_compared: [
      'tier-segmentation.js (CSV lookup)',
      'moneyPageRoles.js',
      'schema-audit / content-extractability / local-signals / technical-foundation / RF / dfs (all use tier-segmentation)',
      'TradSEO tier column (tier-segmentation)',
      'NOTE: pages_master not wired — shadow only'
    ]
  };
}

async function countNonF() {
  const { count, error } = await sb
    .from('pages_master')
    .select('*', { count: 'exact', head: true })
    .eq('property_url', PROPERTY)
    .neq('tier', 'F_unmapped');
  if (error) throw error;
  return count || 0;
}

async function fetchExistingPaths() {
  const paths = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('pages_master')
      .select('path')
      .eq('property_url', PROPERTY)
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) paths.add(r.path);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return paths;
}

async function insertBatches(rows, label) {
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const { error } = await sb.from('pages_master').insert(batch);
    if (error) throw error;
    console.log(`${label} ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }
}

/** MERGE: insert paths missing from pages_master; never touch existing tier/money_role. */
async function mergeRows(rows) {
  const existing = await fetchExistingPaths();
  const fresh = rows.filter((r) => !existing.has(r.path));
  console.log(`merge: existing=${existing.size} built=${rows.length} insert=${fresh.length}`);
  if (fresh.length) await insertBatches(fresh, 'merged');
  await logMasterMutation(sb, {
    tableName: 'pages_master',
    scriptName: 'backfill-pages-master-shadow.mjs',
    args: '--apply (merge)',
    rowCount: fresh.length,
    notes: `Inserted ${fresh.length} new paths; preserved ${existing.size} existing classifications`
  });
  return fresh.length;
}

/** Full rebuild — last resort only. */
async function overwriteRows(rows) {
  const nonF = await countNonF();
  if (nonF > 0 && !overwrite) {
    console.error(
      `REFUSED: pages_master has ${nonF} non-F classifications. ` +
        'Default --apply uses merge mode. Pass --overwrite-classifications only as last resort.'
    );
    process.exit(2);
  }
  const { error: delErr } = await sb.from('pages_master').delete().eq('property_url', PROPERTY);
  if (delErr) throw delErr;
  await insertBatches(rows, 'inserted');
  await logMasterMutation(sb, {
    tableName: 'pages_master',
    scriptName: 'backfill-pages-master-shadow.mjs',
    args: '--apply --overwrite-classifications',
    rowCount: rows.length,
    notes: `Full rebuild after deleting property rows (prior non-F count was ${nonF})`
  });
}

function writeMd(report, site06Count, segCount, ovCount) {
  const lines = [];
  lines.push('# pages_master Phase 1 SHADOW — parity report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push(`| Metric | n |`);
  lines.push(`|---|---:|`);
  lines.push(`| pages_master rows | ${report.counts.total} |`);
  lines.push(`| 06-site-urls paths | ${site06Count} |`);
  lines.push(`| segmentation CSV paths | ${segCount} |`);
  lines.push(`| overrides DB | ${ovCount} |`);
  lines.push(`| flagged | ${report.counts.flagged} |`);
  lines.push(`| Tier F | ${report.tierF_count} |`);
  lines.push('');
  lines.push('### By tier');
  lines.push('');
  for (const [k, v] of Object.entries(report.counts.tier).sort()) {
    lines.push(`- **${k}:** ${v}`);
  }
  lines.push('');
  lines.push('### By money_role');
  lines.push('');
  for (const [k, v] of Object.entries(report.counts.money_role).sort()) {
    lines.push(`- **${k}:** ${v}`);
  }
  lines.push('');
  lines.push('## Utility path set (must not be commercial money)');
  lines.push('');
  for (const u of report.utility_in_master) {
    lines.push(`- \`${u.path}\` → tier=${u.tier}, money_role=${u.money_role}, target_class=${u.target_class || '—'}`);
  }
  lines.push('');
  lines.push(`Utility OK (role=utility|null): **${report.utility_not_money_ok}**`);
  lines.push('');
  lines.push('## Cannibal rows');
  lines.push('');
  for (const c of report.cannibal_in_master) {
    lines.push(`- \`${c.path}\` → tier=${c.tier}, money_role=${c.money_role}, target_class=${c.target_class || '—'}`);
  }
  lines.push('');
  lines.push('## Parity vs live consumers');
  lines.push('');
  lines.push(`| Class | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| EXPECTED diffs | ${report.parity.expected_count} |`);
  lines.push(`| UNEXPECTED diffs | ${report.parity.unexpected_count} |`);
  lines.push(`| Total diffs | ${report.parity.diff_count} |`);
  lines.push('');
  lines.push('### UNEXPECTED (investigate before Phase 2)');
  lines.push('');
  if (!report.parity.unexpected.length) lines.push('_None_');
  for (const d of report.parity.unexpected.slice(0, 50)) {
    lines.push(`- \`${d.path}\` ${d.field}: live=\`${d.live}\` master=\`${d.pages_master}\` (${d.rule || ''})`);
  }
  lines.push('');
  lines.push('### EXPECTED sample (first 40)');
  lines.push('');
  for (const d of report.parity.expected.slice(0, 40)) {
    lines.push(`- \`${d.path}\` ${d.field}: live=\`${d.live}\` → master=\`${d.pages_master}\` — ${d.rule}`);
  }
  lines.push('');
  lines.push('### Tier F sample (first 80)');
  lines.push('');
  for (const p of report.tierF_sample) lines.push(`- \`${p}\``);
  lines.push('');
  lines.push('## Consumers compared (shadow — not rewired)');
  lines.push('');
  for (const c of report.consumers_compared) lines.push(`- ${c}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const segText = fs.readFileSync(SEG_CSV, 'utf8');
  const siteText = fs.readFileSync(SITE_06, 'utf8');
  const segByPath = parseSegmentation(segText);
  const site06 = parse06(siteText);
  const overrides = await fetchOverrides();
  const rows = buildMaster(segByPath, site06, overrides);
  const report = buildParity(rows, segByPath);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PARITY, JSON.stringify(report, null, 2), 'utf8');
  const md = writeMd(report, site06.size, segByPath.size, overrides.length);
  fs.writeFileSync(OUT_MD, md, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'pages-master-parity-report-LATEST.md'), md, 'utf8');

  console.log('rows', rows.length);
  console.log('tier counts', report.counts.tier);
  console.log('money_role counts', report.counts.money_role);
  console.log('parity expected/unexpected', report.parity.expected_count, report.parity.unexpected_count);
  console.log('wrote', OUT_PARITY);
  console.log('wrote', OUT_MD);

  if (!apply) {
    console.log('\nDry run — pass --apply for merge (new paths only), or --apply --overwrite-classifications (last resort)');
    return;
  }
  if (overwrite) {
    await overwriteRows(rows);
    console.log('✓ pages_master overwritten (full rebuild)');
  } else {
    const n = await mergeRows(rows);
    console.log(`✓ pages_master merge complete (${n} new rows)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
