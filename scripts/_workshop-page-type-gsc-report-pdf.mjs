// Generate printable PDF report for workshop page-type GSC comparison.
// Usage: node scripts/_workshop-page-type-gsc-report-pdf.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'Docs');
const HTML_PATH = path.join(OUT_DIR, 'WORKSHOP-PAGE-TYPE-GSC-COMPARISON-2026-05-28.html');
const PDF_PATH = path.join(OUT_DIR, 'WORKSHOP-PAGE-TYPE-GSC-COMPARISON-2026-05-28.pdf');

const VERIFICATION = [
  ['E1', 'event', '/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes', 'photographic-workshops-near-me/hartland-quay-photography-devon-seascapes', 163, '2025-06-29', '2026-05-25', 272, 7],
  ['E1', 'product', '/photo-workshops-uk/landscape-photography-devon-hartland-quay', 'photo-workshops-uk/landscape-photography-devon-hartland-quay', 482, '2025-01-13', '2026-05-25', 2869, 21],
  ['E1', 'type-hub', '/photography-workshops-near-me', 'photography-workshops-near-me', 498, '2025-01-13', '2026-05-25', 10710, 68],
  ['E1', 'all-hub', '/photography-workshops', 'photography-workshops', 313, '2025-01-19', '2026-05-25', 56320, 506],
  ['E2', 'event', '/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21', 'photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21', 60, '2025-09-27', '2026-04-26', 41, 1],
  ['E2', 'product', '/photo-workshops-uk/bluebell-woodlands-photography-workshops', 'photo-workshops-uk/bluebell-woodlands-photography-workshops', 416, '2025-01-13', '2026-05-23', 1902, 21],
  ['E2', 'type-hub', '/landscape-photography-workshops', 'landscape-photography-workshops', 498, '2025-01-13', '2026-05-25', 110874, 704],
  ['E2', 'all-hub', '/photography-workshops', 'photography-workshops', 313, '2025-01-19', '2026-05-25', 56320, 506],
  ['E3', 'event', '/photographic-workshops-near-me/peak-district-photography-workshops-autumn', 'photographic-workshops-near-me/peak-district-photography-workshops-autumn', 102, '2025-06-27', '2026-05-20', 102, 4],
  ['E3', 'product', '/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire', 'photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire', 471, '2025-01-14', '2026-05-25', 8729, 163],
  ['E3', 'type-hub', '/one-day-landscape-photography-workshops', 'one-day-landscape-photography-workshops', 428, '2025-01-13', '2026-05-25', 7218, 24],
  ['E3', 'all-hub', '/photography-workshops', 'photography-workshops', 313, '2025-01-19', '2026-05-25', 56320, 506]
];

const SUMMARY = {
  E1: [
    ['event', '/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes', 'photographic-workshops-near-me/hartland-quay-photography-devon-seascapes', 272, 7, 2.57, 14.69, 12],
    ['product', '/photo-workshops-uk/landscape-photography-devon-hartland-quay', 'photo-workshops-uk/landscape-photography-devon-hartland-quay', 2869, 21, 0.73, 28.52, 17],
    ['type-hub', '/photography-workshops-near-me', 'photography-workshops-near-me', 10710, 68, 0.63, 25.08, 17],
    ['all-hub', '/photography-workshops', 'photography-workshops', 56320, 506, 0.90, 18.78, 12]
  ],
  E2: [
    ['event', '/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21', 'photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21', 41, 1, 2.44, 17.22, 7],
    ['product', '/photo-workshops-uk/bluebell-woodlands-photography-workshops', 'photo-workshops-uk/bluebell-woodlands-photography-workshops', 1902, 21, 1.10, 25.36, 17],
    ['type-hub', '/landscape-photography-workshops', 'landscape-photography-workshops', 110874, 704, 0.63, 29.84, 17],
    ['all-hub', '/photography-workshops', 'photography-workshops', 56320, 506, 0.90, 18.78, 12]
  ],
  E3: [
    ['event', '/photographic-workshops-near-me/peak-district-photography-workshops-autumn', 'photographic-workshops-near-me/peak-district-photography-workshops-autumn', 102, 4, 3.92, 34.77, 10],
    ['product', '/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire', 'photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire', 8729, 163, 1.87, 22.02, 17],
    ['type-hub', '/one-day-landscape-photography-workshops', 'one-day-landscape-photography-workshops', 7218, 24, 0.33, 29.39, 17],
    ['all-hub', '/photography-workshops', 'photography-workshops', 56320, 506, 0.90, 18.78, 12]
  ]
};

const EXAMPLE_LABELS = {
  E1: 'Example 1 — Hartland Quay (residential)',
  E2: 'Example 2 — Bluebells (half-day)',
  E3: 'Example 3 — Peak District (one-day)'
};

const QUERIES = {
  'E1|event': { rows: 3, url: 'https://www.alanranger.com/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes', data: [
    ['photography courses devon', 6, 0, 0, 22.5], ['site:www.alanranger.com', 2, 0, 0, 209.5], ['north devon commercial photographer', 1, 0, 0, 68]
  ]},
  'E1|product': { rows: 84, url: 'https://www.alanranger.com/photo-workshops-uk/landscape-photography-devon-hartland-quay', data: [
    ['devon landscape photography', 302, 2, 0.66, 22.85], ['landscape photography courses near me', 78, 1, 1.28, 32.33], ['alan ranger photography', 14, 1, 7.14, 10],
    ['devon photography', 290, 0, 0, 6.68], ['landscape photography workshops', 284, 0, 0, 42.87], ['landscape photography course', 190, 0, 0, 47.56],
    ['landscape photography workshop', 145, 0, 0, 41.06], ['landscape photography courses', 81, 0, 0, 56.77], ['landscape workshops', 54, 0, 0, 20.83], ['photography courses devon', 54, 0, 0, 31.76]
  ]},
  'E1|type-hub': { rows: 229, url: 'https://www.alanranger.com/photography-workshops-near-me', data: [
    ['photography retreats', 278, 6, 2.16, 8.45], ['photography retreat', 153, 6, 3.92, 11.44], ['residential photography courses uk', 643, 4, 0.62, 12.66],
    ['photography retreats uk', 114, 4, 3.51, 8.48], ['photography retreat 2025', 8, 2, 25, 4.63], ['landscape photography workshops', 411, 1, 0.24, 33.21],
    ['photography workshop near me', 91, 1, 1.1, 36.03], ['photography weekend', 46, 1, 2.17, 23.37], ['photography retreat uk', 24, 1, 4.17, 3.42], ['residential photography course', 23, 1, 4.35, 12.61]
  ]},
  'E1|all-hub': { rows: 767, url: 'https://www.alanranger.com/photography-workshops', data: [
    ['landscape photography course', 976, 36, 3.69, 12], ['landscape photography workshops uk', 850, 33, 3.88, 3.8], ['alan ranger photography', 681, 19, 2.79, 2.14],
    ['photography workshops uk', 1327, 14, 1.06, 6.58], ['landscape photography workshop', 1332, 13, 0.98, 5.85], ['uk photography workshops', 826, 13, 1.57, 3.56],
    ['landscape photography courses', 682, 13, 1.91, 14.33], ['landscape photography workshops', 2960, 12, 0.41, 9.89], ['landscape photography courses uk', 177, 9, 5.08, 1.55], ['photography workshops', 2829, 7, 0.25, 27.52]
  ]},
  'E2|event': { rows: 2, url: 'https://www.alanranger.com/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21', data: [
    ['bluebell woodlands photography workshops warwickshire', 2, 0, 0, 5], ['site:www.alanranger.com', 1, 0, 0, 294]
  ]},
  'E2|product': { rows: 46, url: 'https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops', note: 'Top 10 by impressions; all 0 clicks.', data: [
    ['woodlands photographers', 309, 0, 0, 34.25], ['photography course woodland', 165, 0, 0, 43.3], ['woodlands photographer', 113, 0, 0, 32.05],
    ['woodlands photography', 94, 0, 0, 23.14], ['photography in the woodlands', 82, 0, 0, 39.56], ['bluebell photographer northamptonshire', 67, 0, 0, 33.19],
    ['woodland photography course', 47, 0, 0, 51.3], ['bluebell woodlands photography workshops warwickshire', 40, 0, 0, 2.85], ['woodland photography workshops', 33, 0, 0, 60.33], ['bluebell woods for filming and photoshoots', 26, 0, 0, 65.42]
  ]},
  'E2|type-hub': { rows: 939, url: 'https://www.alanranger.com/landscape-photography-workshops', data: [
    ['alan ranger photography', 3861, 133, 3.44, 1.48], ['landscape photography course', 2971, 46, 1.55, 14.41], ['landscape photography courses', 800, 25, 3.13, 36.05],
    ['landscape photography workshops uk', 1512, 21, 1.39, 2.39], ['alan ranger', 1640, 19, 1.16, 1.55], ['photography workshops uk', 1475, 17, 1.15, 7.4],
    ['landscape photography workshops', 3638, 13, 0.36, 4.76], ['photography workshops', 6743, 12, 0.18, 12.65], ['uk photography workshops', 797, 11, 1.38, 7.36], ['photography workshops near me', 1301, 9, 0.69, 14.17]
  ]},
  'E2|all-hub': { rows: 767, url: 'https://www.alanranger.com/photography-workshops', note: 'Same page URL as E1 all-hub.', data: [
    ['landscape photography course', 976, 36, 3.69, 12], ['landscape photography workshops uk', 850, 33, 3.88, 3.8], ['alan ranger photography', 681, 19, 2.79, 2.14],
    ['photography workshops uk', 1327, 14, 1.06, 6.58], ['landscape photography workshop', 1332, 13, 0.98, 5.85], ['uk photography workshops', 826, 13, 1.57, 3.56],
    ['landscape photography courses', 682, 13, 1.91, 14.33], ['landscape photography workshops', 2960, 12, 0.41, 9.89], ['landscape photography courses uk', 177, 9, 5.08, 1.55], ['photography workshops', 2829, 7, 0.25, 27.52]
  ]},
  'E3|event': { rows: 17, url: 'https://www.alanranger.com/photographic-workshops-near-me/peak-district-photography-workshops-autumn', note: 'Top 10 by impressions; all 0 clicks.', data: [
    ['bolehill quarry photos', 14, 0, 0, 72.57], ['peak district photography workshops', 10, 0, 0, 19.8], ['beginner photography workshop derbyshire', 4, 0, 0, 84],
    ['new homes in upper padley', 3, 0, 0, 44.33], ['peak district', 2, 0, 0, 3], ['photography events near me', 2, 0, 0, 1], ['s32 2ja', 2, 0, 0, 56],
    ['dave dale peak district', 1, 0, 0, 3], ['derbyshire beauty spots', 1, 0, 0, 3], ['landscape photography workshops', 1, 0, 0, 8]
  ]},
  'E3|product': { rows: 212, url: 'https://www.alanranger.com/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire', data: [
    ['peak district photography workshops', 235, 13, 5.53, 10.2], ['photography courses derbyshire', 446, 3, 0.67, 7.79], ['photography workshops', 254, 3, 1.18, 13.72],
    ['photography workshops near me', 91, 2, 2.2, 12.31], ['photography courses near me', 78, 2, 2.56, 9.29], ['landscape photography courses near me', 37, 2, 5.41, 13.57],
    ['photography courses derby', 84, 1, 1.19, 44.61], ['photography course derbyshire', 56, 1, 1.79, 8.95], ['photography lessons near me', 39, 1, 2.56, 9.64], ['photography classes near me', 22, 1, 4.55, 8.77]
  ]},
  'E3|type-hub': { rows: 118, url: 'https://www.alanranger.com/one-day-landscape-photography-workshops', data: [
    ['one day photography workshops', 407, 1, 0.25, 20.32], ['1 day photography workshop', 153, 1, 0.65, 20.49], ['one day photography course', 56, 1, 1.79, 27.59],
    ['photo workshops 2025', 1, 1, 100, 18], ['landscape photography workshops', 791, 0, 0, 30.46], ['landscape photography workshop', 610, 0, 0, 26.86],
    ['one day photography courses', 433, 0, 0, 28.17], ['landscape photography tours', 418, 0, 0, 44.3], ['electriclandscape photography tuition', 411, 0, 0, 4.88], ['one day photography workshop', 381, 0, 0, 13.75]
  ]},
  'E3|all-hub': { rows: 767, url: 'https://www.alanranger.com/photography-workshops', note: 'Same page URL as E1 all-hub.', data: [
    ['landscape photography course', 976, 36, 3.69, 12], ['landscape photography workshops uk', 850, 33, 3.88, 3.8], ['alan ranger photography', 681, 19, 2.79, 2.14],
    ['photography workshops uk', 1327, 14, 1.06, 6.58], ['landscape photography workshop', 1332, 13, 0.98, 5.85], ['uk photography workshops', 826, 13, 1.57, 3.56],
    ['landscape photography courses', 682, 13, 1.91, 14.33], ['landscape photography workshops', 2960, 12, 0.41, 9.89], ['landscape photography courses uk', 177, 9, 5.08, 1.55], ['photography workshops', 2829, 7, 0.25, 27.52]
  ]}
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseMonthlyFile() {
  const raw = fs.readFileSync(path.join(ROOT, 'logs/d1-monthly-formatted.txt'), 'utf8')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const sections = [];
  for (const block of raw.split(/^### /m).filter(Boolean)) {
    const lines = block.trim().split('\n');
    const example = lines.shift().trim();
    const current = { example, pages: [] };
    let page = null;
    for (const line of lines) {
      const clean = line.trim();
      if (!clean) continue;
      const pm = clean.match(/^(EVENT|PRODUCT|TYPE-HUB|ALL-HUB): (.+?)  ->  (.+)$/);
      if (pm) {
        page = { title: pm[1], path: pm[2], slug: pm[3], rows: [] };
        current.pages.push(page);
        continue;
      }
      if (clean.startsWith('year\t')) continue;
      const cols = clean.split('\t');
      if (page && cols.length >= 5) page.rows.push(cols);
    }
    sections.push(current);
  }
  return sections;
}

function table(headers, rows, small = false, numericFrom = null) {
  const cls = small ? ' class="small"' : '';
  const head = headers.map((h, i) => {
    const num = numericFrom != null && i >= numericFrom ? ' class="num"' : '';
    return `<th${num}>${esc(h)}</th>`;
  }).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => {
    const num = numericFrom != null && i >= numericFrom ? ' class="num"' : '';
    return `<td${num}>${esc(c)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table${cls}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildHtml(monthlySections) {
  const css = `
    @page { size: A4 portrait; margin: 16mm 14mm 18mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 10pt; color: #1a1a1a; line-height: 1.4; margin: 0; }
    .cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; padding: 12mm 0; }
    .cover h1 { font-size: 24pt; margin: 0 0 12pt; color: #0f2d52; line-height: 1.15; }
    .cover .subtitle { font-size: 12pt; color: #444; margin-bottom: 24pt; }
    .cover dl { margin: 0; display: grid; grid-template-columns: 130px 1fr; gap: 6pt 10pt; font-size: 10pt; }
    .cover dt { font-weight: 700; color: #333; }
    .cover dd { margin: 0; color: #222; }
    h2 { font-size: 14pt; margin: 0 0 10pt; page-break-after: avoid; color: #0f2d52; border-bottom: 2px solid #0f2d52; padding-bottom: 5pt; }
    h3 { font-size: 11.5pt; margin: 16pt 0 8pt; page-break-after: avoid; color: #163a61; }
    h4 { font-size: 10pt; margin: 10pt 0 4pt; page-break-after: avoid; color: #333; font-weight: 700; }
    p, .meta { margin: 0 0 8pt; color: #333; }
    .toc { page-break-after: always; }
    .toc ol { margin: 0; padding-left: 18pt; }
    .toc li { margin: 4pt 0; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 12pt; page-break-inside: auto; }
    table.small { font-size: 8pt; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid #999; padding: 4pt 6pt; text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #e8eef4; font-weight: 700; color: #0f2d52; }
    tr:nth-child(even) td { background: #f7f9fb; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .slug { font-family: Consolas, "Courier New", monospace; font-size: 8pt; color: #555; margin-bottom: 6pt; word-break: break-all; }
    .page-break { page-break-before: always; }
    .section-block { page-break-inside: avoid; margin-bottom: 14pt; }
    .note { font-size: 9pt; color: #555; font-style: italic; margin: 0 0 6pt; }
    code { font-family: Consolas, monospace; font-size: 9pt; background: #f0f0f0; padding: 1pt 3pt; }
  `;

  let body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Workshop Page-Type GSC Comparison</title><style>${css}</style></head><body>`;

  body += `<section class="cover">`;
  body += `<h1>Workshop Page-Type GSC Comparison</h1>`;
  body += `<p class="subtitle">Alan Ranger Photography · AI GEO Audit · Evidence-only analysis</p>`;
  body += `<dl>`;
  body += `<dt>Primary source</dt><dd><code>public.gsc_page_timeseries</code> (SQL + <code>normalize_gsc_page_slug()</code>)</dd>`;
  body += `<dt>Query source</dt><dd>GSC Search Analytics API (<code>dataState: final</code>, page-filtered)</dd>`;
  body += `<dt>Date window</dt><dd>2025-01-13 to 2026-05-26 · 17 calendar months (2025-01 … 2026-05)</dd>`;
  body += `<dt>Examples</dt><dd>Hartland Quay (residential) · Bluebells (half-day) · Peak District (one-day)</dd>`;
  body += `<dt>Generated</dt><dd>2026-05-28</dd>`;
  body += `</dl></section>`;

  body += `<section class="toc"><h2>Contents</h2><ol>`;
  body += `<li>Verification — slug resolution</li>`;
  body += `<li>Deliverable 2 — Summary comparison</li>`;
  body += `<li>Deliverable 1 — Monthly GSC metrics (12 pages)</li>`;
  body += `<li>Deliverable 3 — Top queries (GSC API)</li>`;
  body += `</ol></section>`;

  body += `<h2>Verification — slug resolution</h2>`;
  body += `<p>All 12 pages matched <code>gsc_page_timeseries</code>. None returned zero data across the full window.</p>`;
  body += table(
    ['Ex', 'Role', 'Path', 'Normalized slug', 'Daily rows', 'First', 'Last', 'Total imp', 'Total clicks'],
    VERIFICATION.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7].toLocaleString('en-GB'), r[8]]),
    true, 4
  );

  body += `<div class="page-break"></div><h2>Deliverable 2 — Summary comparison</h2>`;
  body += `<p>Full-window totals from <code>gsc_page_timeseries</code>, <code>date &gt;= 2025-01-13</code>.</p>`;
  for (const ex of ['E1', 'E2', 'E3']) {
    body += `<div class="section-block"><h3>${EXAMPLE_LABELS[ex]}</h3>`;
    body += table(
      ['Role', 'Path', 'Slug', 'Total imp', 'Total clicks', 'CTR %', 'Avg pos', 'Months w/ data'],
      SUMMARY[ex].map((r) => [r[0], r[1], r[2], r[3].toLocaleString('en-GB'), r[4], r[5], r[6], r[7]]),
      true, 3
    );
    body += `</div>`;
  }

  body += `<div class="page-break"></div><h2>Deliverable 1 — Monthly GSC metrics</h2>`;
  body += `<p>CTR = clicks/impressions×100 (recomputed monthly). Position = impression-weighted. Blank avg position = zero impressions that month.</p>`;
  for (const sec of monthlySections) {
    body += `<div class="page-break"></div><h3>${esc(sec.example)}</h3>`;
    for (const page of sec.pages) {
      body += `<div class="section-block">`;
      body += `<h4>${esc(page.title)}: ${esc(page.path)}</h4>`;
      body += `<p class="slug">slug: ${esc(page.slug)}</p>`;
      body += table(['Year', 'Month', 'Impressions', 'Clicks', 'CTR %', 'Avg position'], page.rows, true, 2);
      body += `</div>`;
    }
  }

  body += `<div class="page-break"></div><h2>Deliverable 3 — Top queries (GSC API)</h2>`;
  body += `<p>Top 10 queries per page by clicks (by impressions where clicks = 0). Date range: 2025-01-13 to 2026-05-26.</p>`;
  for (const ex of ['E1', 'E2', 'E3']) {
    body += `<div class="page-break"></div><h3>${EXAMPLE_LABELS[ex]}</h3>`;
    for (const role of ['event', 'product', 'type-hub', 'all-hub']) {
      const q = QUERIES[`${ex}|${role}`];
      body += `<div class="section-block">`;
      body += `<h4>${role.toUpperCase()}</h4>`;
      body += `<p class="slug">${esc(q.url)}</p>`;
      body += `<p>Query rows returned: ${q.rows}${q.note ? ` · <span class="note">${esc(q.note)}</span>` : ''}</p>`;
      body += table(['Query', 'Impressions', 'Clicks', 'CTR %', 'Position'], q.data, true, 1);
      body += `</div>`;
    }
  }

  body += `</body></html>`;
  return body;
}

function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function htmlToPdf(browser, htmlPath, pdfPath) {
  const url = 'file:///' + htmlPath.replace(/\\/g, '/');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=10000',
    `--print-to-pdf=${pdfPath}`,
    '--no-pdf-header-footer',
    url
  ];
  const r = spawnSync(browser, args, { encoding: 'utf8', timeout: 120000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'Browser PDF failed').slice(0, 500));
  if (!fs.existsSync(pdfPath)) throw new Error('PDF file was not created');
}

const monthlySections = parseMonthlyFile();
const html = buildHtml(monthlySections);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log('Wrote HTML:', HTML_PATH);

const browser = findBrowser();
if (!browser) throw new Error('No Chrome/Edge found for PDF generation');
htmlToPdf(browser, HTML_PATH, PDF_PATH);
console.log('Wrote PDF:', PDF_PATH);
console.log('Size:', (fs.statSync(PDF_PATH).size / 1024).toFixed(1), 'KB');
