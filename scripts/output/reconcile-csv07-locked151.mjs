import fs from 'fs';

// Prefer 09 DB export; fall back to frozen seospace archive.
const CSV09 = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/09-url-target-keywords.csv';
const CSV07 = fs.existsSync(CSV09)
  ? CSV09
  : 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/07-url-target-keywords-seospace.csv';
const LOCKED = 'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/config/keyword-tracking-locations-and-class-LOCKED-v4.csv';
const MONEY = 'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/scripts/output/money-pages-165.json';
const OVERRIDES = 'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/scripts/output/overrides-all.json';
const OUT = 'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/scripts/output/reconcile-csv07-locked151.json';

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === ',' && !q) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    cols.push(cur);
    const o = {};
    headers.forEach((h, i) => {
      o[h] = (cols[i] || '').trim();
    });
    return o;
  });
}

function pathKey(url) {
  if (!url) return '';
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  u = u.replace(/\/+$/, '');
  if (u === 'alanranger.com' || u === 'alanranger.com/home') return 'alanranger.com';
  return u;
}

function pathOnly(url) {
  const k = pathKey(url);
  const i = k.indexOf('/');
  return i < 0 ? '/' : k.slice(i);
}

function normKw(k) {
  return String(k || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(k) {
  return normKw(k)
    .replace(/\b(near me|uk|coventry|warwickshire)\b/g, '')
    .replace(/ies\b/g, 'y')
    .replace(/s\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(k) {
  return new Set(
    normKw(k)
      .split(/[^a-z0-9]+/)
      .filter((t) => t && t.length > 2 && !['the', 'and', 'for', 'with'].includes(t))
  );
}

function jaccard(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const csv07 = parseCsv(fs.readFileSync(CSV07, 'utf8'));
const locked = parseCsv(fs.readFileSync(LOCKED, 'utf8'));
const money = JSON.parse(fs.readFileSync(MONEY, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));

const csvByPath = new Map();
for (const r of csv07) {
  const pk = pathKey(r.url);
  if (!pk) continue;
  if (!csvByPath.has(pk)) csvByPath.set(pk, r.target_keyword || '');
}

const ovByPath = new Map();
for (const r of overrides) {
  ovByPath.set(pathKey(r.page_url), r.target_keyword || '');
}

const lockedByPath = new Map(); // pathOnly -> [keywords]
const lockedKwSet = new Map(); // normKw -> {keyword, target_page pathOnly}
for (const r of locked) {
  const kw = r.keyword;
  const tp = pathOnly(r.target_page.startsWith('http') ? r.target_page : `https://alanranger.com${r.target_page}`);
  if (!lockedByPath.has(tp)) lockedByPath.set(tp, []);
  lockedByPath.get(tp).push(kw);
  lockedKwSet.set(normKw(kw), { keyword: kw, target_page: tp });
}

function classifyMatch(effective, pagePath, lockedKwsForPage) {
  const eff = normKw(effective);
  if (!eff) {
    return lockedKwsForPage.length
      ? { match: 'gap-no-target', note: 'LOCKED has keywords for page but no effective target' }
      : { match: 'gap-both', note: 'no effective target and no LOCKED keywords for page' };
  }
  const inLocked = lockedKwSet.has(eff);
  const exactOnPage = lockedKwsForPage.some((k) => normKw(k) === eff);
  if (exactOnPage) return { match: 'clean', note: 'effective = LOCKED kw and maps to this page' };

  // near-miss: same stem or high jaccard among page's LOCKED kws
  let best = null;
  let bestScore = 0;
  for (const k of lockedKwsForPage) {
    const s = Math.max(stem(k) === stem(eff) ? 0.9 : 0, jaccard(k, eff));
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  }
  if (best && bestScore >= 0.55) {
    return {
      match: 'near-miss',
      note: `effective ~ "${best}" (score ${bestScore.toFixed(2)}); inverse maps to this page`,
    };
  }

  if (inLocked) {
    const mapped = lockedKwSet.get(eff).target_page;
    if (mapped === pagePath) {
      return { match: 'clean', note: 'effective in LOCKED; inverse maps here' };
    }
    return {
      match: 'mismatch-inverse',
      note: `effective in LOCKED but target_page=${mapped} not this page`,
    };
  }

  // effective not in LOCKED at all — stale strategy candidate
  if (lockedKwsForPage.length) {
    return {
      match: 'stale-not-in-locked',
      note: `effective target not in LOCKED 151; page has LOCKED kws: ${lockedKwsForPage.slice(0, 3).join(' | ')}`,
    };
  }
  return { match: 'stale-not-in-locked', note: 'effective target not in LOCKED 151; no LOCKED kws for page' };
}

const seedStamp = '2026-07-16 12:55:54';
const seedPaths = new Set(
  overrides
    .filter((o) => String(o.updated_at).startsWith('2026-07-16 12:55:54'))
    .map((o) => pathKey(o.page_url))
);

const results = money.map((m) => {
  const pk = pathKey(m.page_url);
  const pagePath = pathOnly(m.page_url);
  const csvKw = csvByPath.get(pk) || csvByPath.get(pathKey(m.page_url.replace('www.', ''))) || '';
  // try path-only match in csv (csv uses www)
  let csvHit = csvKw;
  if (!csvHit) {
    for (const [k, v] of csvByPath) {
      if (pathOnly(`https://${k}`) === pagePath) {
        csvHit = v;
        break;
      }
    }
  }
  const ovKw = ovByPath.get(pk) || '';
  // overrides often without www
  let ovHit = ovKw;
  if (!ovHit) {
    for (const [k, v] of ovByPath) {
      if (pathOnly(`https://${k}`) === pagePath) {
        ovHit = v;
        break;
      }
    }
  }
  const effective = ovHit || csvHit || '';
  const lockedKws = lockedByPath.get(pagePath) || [];
  // homepage aliases
  const lockedKws2 =
    pagePath === '/' || pagePath === '/home'
      ? [...new Set([...(lockedByPath.get('/') || []), ...(lockedByPath.get('/home') || [])])]
      : lockedKws;
  const { match, note } = classifyMatch(effective, pagePath === '/home' ? '/' : pagePath, lockedKws2);
  return {
    page_url: m.page_url,
    segment: m.segment,
    target_kw_csv07: csvHit || '',
    target_kw_override: ovHit || '',
    effective_target: effective,
    locked_151_keywords: lockedKws2,
    match,
    note,
    has_seed_override: seedPaths.has(pk) || [...seedPaths].some((s) => pathOnly(`https://${s}`) === pagePath),
  };
});

const landing = results.filter((r) => r.segment === 'landing');
const landingStats = {
  n: landing.length,
  with_override: landing.filter((r) => r.target_kw_override).length,
  csv_only: landing.filter((r) => !r.target_kw_override && r.target_kw_csv07).length,
  no_target: landing.filter((r) => !r.effective_target).length,
  clean: landing.filter((r) => r.match === 'clean').length,
  near_miss: landing.filter((r) => r.match === 'near-miss').length,
  stale: landing.filter((r) => r.match === 'stale-not-in-locked').length,
  mismatch_inverse: landing.filter((r) => r.match === 'mismatch-inverse').length,
  gaps: landing.filter((r) => String(r.match).startsWith('gap')).length,
};

const allStats = {
  n: results.length,
  with_override: results.filter((r) => r.target_kw_override).length,
  csv_only: results.filter((r) => !r.target_kw_override && r.target_kw_csv07).length,
  no_target: results.filter((r) => !r.effective_target).length,
  clean: results.filter((r) => r.match === 'clean').length,
  near_miss: results.filter((r) => r.match === 'near-miss').length,
  stale: results.filter((r) => r.match === 'stale-not-in-locked').length,
  mismatch_inverse: results.filter((r) => r.match === 'mismatch-inverse').length,
  gaps: results.filter((r) => String(r.match).startsWith('gap')).length,
};

const staleEffective = [
  ...new Set(
    results
      .filter((r) => r.match === 'stale-not-in-locked' && r.effective_target)
      .map((r) => normKw(r.effective_target))
  ),
].sort();

const csvStat = fs.statSync(CSV07);
const out = {
  csv07: {
    path: CSV07,
    last_modified: csvStat.mtime.toISOString(),
    data_rows: csv07.length,
  },
  locked151: {
    path: LOCKED,
    data_rows: locked.length,
    unique_keywords: lockedKwSet.size,
  },
  landing_stats: landingStats,
  all_165_stats: allStats,
  stale_effective_targets_not_in_locked: staleEffective,
  landing_table: landing,
  all_table: results,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ csv07: out.csv07, locked151: out.locked151, landing_stats: landingStats, all_165_stats: allStats, stale_count: staleEffective.length }, null, 2));
