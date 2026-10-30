/**
 * Traditional SEO system-health rows: group D-check faults by cause.
 */
import { CHECKS } from './monitor-config.js';

function isDFault(f) {
  return f && f.status === 'fault' && /^D[1-6]$/.test(f.check || f.check_id || '');
}

function shortPath(u) {
  return String(u || '').replace(/^https?:\/\/(www\.)?alanranger\.com/i, '') || String(u || '');
}

export function urlsOfFinding(f) {
  const d = f?.detail || {};
  const failed = Array.isArray(d.failed) ? d.failed.map((x) => x?.url || x).filter(Boolean) : [];
  const list = [f?.url, ...(f?.urls || []), ...(d.urls || []), ...(d.missing || []), ...(d.extra || []), ...failed];
  return [...new Set(list.filter(Boolean))];
}

function toRow(f, extra = {}) {
  const id = extra.check || f.check || f.check_id;
  const meta = CHECKS[id] || {};
  const auto = extra.auto_clears === true;
  return {
    check: id,
    label: extra.label || String(meta.label || '').replace(/^D\d\s+/, '') || f.title,
    severity: (extra.severity || f.severity) === 'red' ? 'critical' : 'high',
    title: extra.title || f.title,
    fix: auto ? '' : (extra.fix || f.fix || meta.fix || ''),
    auto_clears: auto,
    url: extra.url === undefined ? (f.url || null) : extra.url,
    urls: extra.urls || urlsOfFinding(f)
  };
}

const D4_FIX = 'Click Export 09 keywords in Traditional SEO run controls — it saves and commits by itself. Or run: node scripts/export-09-url-target-keywords.mjs';

export function groupHealthRows(findings) {
  const faults = (findings || []).filter(isDFault);
  const missing = [];
  const stale = [];
  const rest = [];
  for (const f of faults) {
    const id = f.check || f.check_id;
    const t = String(f.title || '');
    if (id === 'D5' && /^No page_entities row/i.test(t)) missing.push(f);
    else if (id === 'D5' && /page_entities row not refreshed/i.test(t)) stale.push(f);
    else rest.push(f);
  }
  const out = [];
  if (missing.length) {
    out.push(toRow(missing[0], {
      title: `${missing.length} pages in your CSV lists no longer exist (404) — they'll be removed from the lists automatically`,
      label: 'CSV lists include pages that no longer exist',
      auto_clears: true,
      urls: missing.map((f) => f.url).filter(Boolean),
      url: null
    }));
  }
  if (stale.length) {
    out.push(toRow(stale[0], {
      title: `${stale.length} pages have a page record ingest has not refreshed — re-run ingest for those lists`,
      label: 'Stale page records',
      auto_clears: false,
      fix: 'Re-import the matching CSV in the ingest app, then wait for ingest to refresh page_entities.',
      urls: stale.map((f) => f.url).filter(Boolean),
      url: null
    }));
  }
  for (const f of rest) {
    const extra = { urls: urlsOfFinding(f), auto_clears: Boolean(f.auto_clears) };
    if ((f.check || f.check_id) === 'D4') extra.fix = D4_FIX;
    if (!extra.urls.length && f.url) extra.title = `${f.title} — ${shortPath(f.url)}`;
    out.push(toRow(f, extra));
  }
  return out;
}
