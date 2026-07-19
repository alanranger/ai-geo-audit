/**
 * Config integrity checks (Phase 3 GO unification).
 * Pure check functions — shared by API + CLI.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { normalizePagePath } from '../pagesMaster.js';
import {
  includeInMoneyHeadline,
  excludeFromImpactScale,
  pathOnly
} from '../audit/moneyPageRoles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCKED_CSV = path.join(ROOT, 'config/keyword-tracking-locations-and-class-LOCKED-v6.csv');
const CSV09 = path.join(ROOT, 'config/09-url-target-keywords.csv');

const STRUCTURAL_CHECKS = new Set([1, 4, 6]);

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; continue; }
      if (c === ',' && !q) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    const o = {};
    headers.forEach((h, i) => { o[h] = (cols[i] || '').trim(); });
    return o;
  });
}

function normKw(kw) {
  return String(kw || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function lockedTargetPath(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return pathOnly(s);
  return normalizePagePath(s.startsWith('/') ? s : `/${s}`);
}

function loadLocked151() {
  const rows = parseCsv(fs.readFileSync(LOCKED_CSV, 'utf8'));
  const byKw = new Map();
  for (const r of rows) {
    const kw = String(r.keyword || '').trim();
    if (!kw) continue;
    byKw.set(normKw(kw), {
      keyword: kw,
      target_page: lockedTargetPath(r.target_page),
      class: r.class || ''
    });
  }
  return byKw;
}

function pagesByPath(pages) {
  const m = new Map();
  for (const p of pages || []) {
    const key = normalizePagePath(p.path || p.url);
    if (key) m.set(key, p);
  }
  return m;
}

function isCommercialCompatible(page) {
  if (!page) return false;
  const tier = String(page.tier || '').toLowerCase();
  const role = String(page.money_role || '').toLowerCase();
  if (role === 'funnel') return true;
  if (tier === 'f_unmapped' || tier === 'unmapped') return false;
  if (role === 'utility' || role === 'event_admin') return false;
  if (tier === 'c_event' || tier === 'e_academy') return false;
  if (tier === 'a_landing' && (role === 'commercial' || !role)) return true;
  if (role === 'commercial') return true;
  if (tier === 'b_product' && role === 'product') return true;
  return false;
}

function finding(check, severity, subject, detail, extra = {}) {
  return {
    check,
    severity,
    subject: String(subject || ''),
    detail: String(detail || ''),
    ...extra
  };
}

/** Check 1 — LOCKED target_page exists + commercial-compatible tier. */
export function checkLockedTargetPages(lockedByKw, pagesMap) {
  const out = [];
  for (const [, row] of lockedByKw) {
    const tp = row.target_page;
    if (!tp) continue;
    const page = pagesMap.get(tp);
    if (!page) {
      out.push(finding(1, 'red', row.keyword, `target_page ${tp} missing from pages_master`));
      continue;
    }
    if (!isCommercialCompatible(page)) {
      out.push(finding(1, 'red', row.keyword,
        `target_page ${tp} tier=${page.tier} money_role=${page.money_role || '—'} not commercial-compatible`));
    }
  }
  return out;
}

/** Check 2 — tracked pages_master rows vs LOCKED inverse map. */
export function checkTrackedCannibal(pages, lockedByKw) {
  const out = [];
  for (const page of pages || []) {
    if (String(page.target_class || '').toLowerCase() !== 'tracked') continue;
    const kw = String(page.target_keyword || '').trim();
    const nk = normKw(kw);
    const pagePath = normalizePagePath(page.path || page.url);
    if (!nk) {
      out.push(finding(2, 'amber', pagePath, 'target_class=tracked but no target_keyword'));
      continue;
    }
    const locked = lockedByKw.get(nk);
    if (!locked) {
      out.push(finding(2, 'amber', pagePath, `tracked keyword "${kw}" not in LOCKED-151`));
      continue;
    }
    if (locked.target_page && locked.target_page !== pagePath) {
      out.push(finding(2, 'amber', pagePath,
        `CANNIBAL: keyword "${kw}" LOCKED target_page=${locked.target_page} not this page`));
    }
  }
  return out;
}

function bestUrlPath(raw) {
  if (!raw) return '';
  return pathOnly(raw);
}

/** Check 3 — tracked keywords where Google prefers a different URL. */
export function checkGooglePrefers(lockedByKw, overridesByPath, keywordRows) {
  const krByKw = new Map();
  for (const r of keywordRows || []) {
    const k = normKw(r.keyword);
    if (k && !krByKw.has(k)) krByKw.set(k, r);
  }
  const out = [];
  for (const [nk, locked] of lockedByKw) {
    const assigned = locked.target_page;
    if (!assigned) continue;
    const kr = krByKw.get(nk);
    if (!kr?.best_url) continue;
    const best = bestUrlPath(kr.best_url);
    if (best && best !== assigned) {
      out.push(finding(3, 'amber', locked.keyword,
        `Google prefers ${best}; assigned page ${assigned}`));
    }
  }
  for (const [p, ov] of overridesByPath) {
    if (String(ov.target_class || '').toLowerCase() !== 'cannibal_candidate') continue;
    out.push(finding(3, 'amber', p, `cannibal_candidate override: ${ov.notes || 'see notes'}`));
  }
  return out;
}

/** Check 4 — structural tier/utility/funnel rules. */
export function checkStructural(pages, moneyRows) {
  const out = [];
  const tierByPath = new Map();
  for (const page of pages || []) {
    const p = normalizePagePath(page.path || page.url);
    const tier = String(page.tier || '');
    if (tierByPath.has(p) && tierByPath.get(p) !== tier) {
      out.push(finding(4, 'red', p, `URL in two tiers: ${tierByPath.get(p)} vs ${tier}`));
    } else {
      tierByPath.set(p, tier);
    }
  }
  for (const page of pages || []) {
    const p = normalizePagePath(page.path || page.url);
    const cls = String(page.target_class || '').toLowerCase();
    const role = String(page.money_role || '').toLowerCase();
    if (cls !== 'none_utility' && role !== 'utility') continue;
    const hit = (moneyRows || []).find((r) => normalizePagePath(r.url || r.page_url) === p);
    if (hit && includeInMoneyHeadline(page.money_role)) {
      out.push(finding(4, 'red', p, 'utility/none_utility page contributing to money headline input'));
    }
  }
  for (const page of pages || []) {
    const p = normalizePagePath(page.path || page.url);
    if (!excludeFromImpactScale(page.money_role)) continue;
    const hit = (moneyRows || []).find((r) => {
      const rp = normalizePagePath(r.url || r.page_url);
      return rp === p && r.includeInImpactScale === true;
    });
    if (hit) {
      out.push(finding(4, 'red', p, 'funnel page marked includeInImpactScale in money metrics input'));
    }
  }
  return out;
}

/** Check 5 — Tier F rows. */
export function checkTierF(pages) {
  const fRows = (pages || []).filter((p) => {
    const t = String(p.tier || '').toLowerCase();
    return t === 'f_unmapped' || t === 'unmapped';
  });
  if (!fRows.length) return [];
  return [finding(5, 'amber', `${fRows.length} pages`, `Tier F count=${fRows.length}`, {
    paths: fRows.slice(0, 50).map((p) => normalizePagePath(p.path || p.url))
  })];
}

function csvHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function buildCsv09Body(overrides, lockedByKw) {
  const header = ['url', 'target_keyword', 'target_class', 'keyword_class', 'tracked_in_151', 'notes'];
  const lines = [header.join(',')];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const row of overrides) {
    const kw = String(row.target_keyword || '').trim();
    const hit = kw ? lockedByKw.get(normKw(kw)) : null;
    lines.push([
      esc(row.page_url),
      esc(kw),
      esc(row.target_class || ''),
      esc(hit?.class || ''),
      esc(hit ? 'Y' : 'N'),
      esc(row.notes || '')
    ].join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

/** Check 6 — repo CSV09 hash vs DB-generated export. */
export function checkStaleExport(overrides, lockedByKw) {
  const generated = buildCsv09Body(overrides, lockedByKw);
  let disk = '';
  try {
    disk = fs.readFileSync(CSV09, 'utf8');
  } catch {
    return [finding(6, 'red', CSV09, 'STALE EXPORT: config/09-url-target-keywords.csv missing')];
  }
  const genHash = csvHash(generated);
  const diskHash = csvHash(disk);
  if (genHash === diskHash) return [];
  return [finding(6, 'red', '09-url-target-keywords.csv',
    `STALE EXPORT: repo hash ${diskHash.slice(0, 12)} ≠ DB hash ${genHash.slice(0, 12)}`)];
}

export function runAllChecks(ctx) {
  const lockedByKw = ctx.lockedByKw || loadLocked151();
  const pages = ctx.pages || [];
  const pagesMap = pagesByPath(pages);
  const overridesByPath = ctx.overridesByPath || new Map();
  const findings = [
    ...checkLockedTargetPages(lockedByKw, pagesMap),
    ...checkTrackedCannibal(pages, lockedByKw),
    ...checkGooglePrefers(lockedByKw, overridesByPath, ctx.keywordRows || []),
    ...checkStructural(pages, ctx.moneyRows || []),
    ...checkTierF(pages),
    ...checkStaleExport(ctx.overrides || [], lockedByKw)
  ];
  const structuralCount = findings.filter((f) => STRUCTURAL_CHECKS.has(f.check)).length;
  let chipRag = 'green';
  if (findings.length) chipRag = structuralCount ? 'red' : 'amber';
  return {
    findings,
    stats: {
      findingCount: findings.length,
      structuralCount,
      advisoryCount: findings.length - structuralCount,
      pagesCount: pages.length,
      lockedCount: lockedByKw.size
    },
    chipRag,
    lockedByKw
  };
}

export { loadLocked151, parseCsv, normKw, normalizePagePath, csvHash, buildCsv09Body, STRUCTURAL_CHECKS };
