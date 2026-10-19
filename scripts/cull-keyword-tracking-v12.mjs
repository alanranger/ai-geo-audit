/**
 * Money-page keyword cull: 155 → ~85–95.
 * Courses/workshops/mentoring/gifts (local+national); services local/regional only.
 * Writes config/...LOCKED-v12.csv + KEEP/DROP report + rebuilds locked JSON mirrors.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcCsv = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v11.csv');
const outCsv = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v12.csv');
const outReport = join(root, 'Docs/KEYWORD-CULL-KEEP-DROP-v12.md');
const outbox = 'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude';

function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Explicit KEEP set (lowercase). Everything else from v11 is DROP. */
const KEEP = new Set([
  // Brand
  'alan ranger',
  'alan ranger photography',

  // Core courses (primary + one near-me / beginner variant cluster)
  'photography courses',
  'photography course',
  'photography classes',
  'photography courses near me',
  'photography course near me',
  'photography classes near me',
  'photography lessons',
  'photography lessons near me',
  'photography courses for beginners',
  'beginners photography classes',
  'beginners photography courses',
  'beginners photography class near me',
  'beginners photography course near me',
  'camera courses for beginners',
  'camera courses near me',
  'basic photography course',
  'evening photography classes',
  'photography evening classes',
  'photography training',
  'photography tuition',
  'photography tutor',
  'photography masterclasses',
  'private photography lessons',
  'private photography tuition',
  'photo editing course',
  'photo editing classes',
  'lightroom courses',
  'portrait photography course',

  // Local course geos
  'photography courses coventry',
  'photography classes coventry',
  'photography lessons coventry',
  'photography workshops coventry',
  'photography courses solihull',
  'photography courses gloucestershire',

  // Workshops / holidays (money)
  'photography workshops',
  'photography workshop',
  'photography workshops near me',
  'photography workshops uk',
  'landscape photography workshops',
  'landscape photography workshops uk',
  'landscape photography courses',
  'landscape photography course',
  'landscape photography workshop',
  'residential photography workshops',
  'one day photography workshops',
  'macro photography workshops',
  'macro photography course',
  'nature photography workshops',
  'portrait photography workshop',
  'photography holidays uk',
  'outdoor photography training',
  'architectural photography course',
  'corporate photography training',

  // Online courses (money)
  'online photography courses',
  'online photography courses uk',
  'photography courses online',
  'photography lessons online',

  // Free → paid funnel (thin: 2)
  'free photography courses',
  'free online photography course',

  // Mentoring / gifts (1 mentor form + voucher + experience + gift card)
  'photography mentoring',
  'photography gift vouchers',
  'photography experience gifts',
  'photography gift card',

  // Academy
  'rps courses',
  'rps distinctions',

  // Thin LOCAL/REGIONAL services only
  'photographer near me',
  'photographer coventry',
  'photographer in coventry',
  'professional photographer near me',
  'professional photographer coventry',
  'professional headshots near me',
  'headshot photographer near me',
  'property photographer near me',
  'property photographer',
  'real estate photographer near me',
  'real estate photographer',
  'product photographer near me',
  'product photography near me',
  'commercial photographer near me',
  'commercial photographer coventry',
  'hire a photographer',
  'hire a professional photographer',
  'hire a professional photographer coventry',
  'photographer hire',
  'photographer for hire',
]);

const DROP_REASON = {
  'alan ranger photography reviews': 'brand vanity — not a money page',
  'still life photographer': 'off-brief national service head',
  'product photography': 'national service head — keep local near-me forms only',
  'professional headshots': 'national service head — keep near-me only',
  'corporate headshots': 'national service head',
  'linkedin headshots': 'national service head',
  'team headshots': 'national service head',
  'business headshots': 'national service head',
  'headshot photographer': 'national service head — keep near-me only',
  'food photographer': 'no dedicated money-page priority',
  'food photography': 'no dedicated money-page priority',
  'food photographer near me': 'no dedicated money-page priority',
  'hotel photographer': 'thin niche service — out of scope',
  'airbnb photographer': 'thin niche service — out of scope',
  'graduation photographer': 'thin niche service — out of scope',
  'packshot photography': 'national service head',
  'ecommerce product photography': 'national service head',
  'interior photographer': 'national service head',
  'portrait photographer': 'national service head',
  'local photographer': 'too generic; covered by photographer near me / coventry',
  'freelance photographer': 'too generic',
  'freelance photographer near me': 'too generic vs professional photographer near me',
  'commercial photographer': 'national service head — keep near-me / coventry',
  'commercial photography services': 'national service head',
  'professional commercial photography': 'national service head',
  'professional photographer': 'national service head — keep near-me / coventry',
  'property photography': 'national service head — keep photographer forms',
  'product photographer': 'national service head — keep near-me',
  'estate agent photographer': 'synonym of property/real estate — drop',
  'hire a photographer coventry': 'hire synonym — keep hire a photographer + professional coventry',
  'corporate photography': 'national service head — keep corporate photography training',
  'best photography workshops': 'weak qualifier stack',
  'best photography workshops uk': 'vol 0 / weak qualifier',
  'best photography classes': 'weak qualifier stack',
  'best photography course': 'weak qualifier stack',
  'photography presents': 'gift synonym — keep vouchers/experience/gift card',
  'photography gift voucher': 'gift synonym — keep gift vouchers plural',
  'photography vouchers': 'synonym of gift vouchers',
  'photography mentor': 'synonym of mentoring',
  'photography mentorship': 'synonym of mentoring',
  'photo workshops': 'synonym of photography workshops',
  'photographic workshops': 'synonym of photography workshops',
  'uk photography workshops': 'synonym of photography workshops uk',
  'landscape workshops': 'weak / below-floor national',
  'photography course online': 'synonym of online / courses online',
  'online photography course': 'synonym — keep online photography courses',
  'online photography classes': 'synonym / below-floor',
  'online photography lesson': 'synonym / below-floor',
  'photography classes online': 'synonym / below-floor',
  'free online photography courses': 'free stack — keep two free funnel terms',
  'free photography classes': 'free stack cull',
  'free photography courses online': 'free stack cull',
  'free photography classes near me': 'free stack cull',
  'photography courses online free': 'free stack cull',
  'free online photography courses with certificates': 'free stack cull',
  'beginners photography class': 'beginner synonym stack',
  'beginners photography course': 'beginner synonym stack',
  'beginner photography courses': 'beginner synonym stack',
  'beginner photography classes': 'beginner synonym stack',
  'beginning photography lessons': 'beginner synonym stack',
  'beginners photography classes coventry': 'vol 0',
  'beginners photography courses coventry': 'vol 0',
  'beginners photography lessons coventry': 'vol 0',
  'camera courses coventry': 'vol 0',
  'lightroom courses coventry': 'vol 0',
  'basic photography lessons': 'synonym of basic photography course',
  'photography class for beginners': 'beginner synonym stack',
  'lightroom editing course': 'synonym of lightroom courses',
};

const lines = readFileSync(srcCsv, 'utf8').trim().split(/\r?\n/);
const header = lines[0];
const rows = [];
for (const line of lines.slice(1)) {
  const r = parseLine(line);
  if (!r[0]) continue;
  rows.push({
    keyword: r[0].trim(),
    tracking_location: (r[1] || '').trim(),
    location_name_dfs: (r[2] || '').trim(),
    class: (r[3] || '').trim(),
    target_page: (r[4] || '').trim(),
    llm_prompt: (r[5] || 'false').trim(),
    line,
  });
}

const keepRows = [];
const dropRows = [];
for (const row of rows) {
  const key = row.keyword.toLowerCase();
  if (KEEP.has(key)) keepRows.push(row);
  else {
    dropRows.push({
      ...row,
      reason: DROP_REASON[key] || 'not in money-page keep set (synonym / national service / weak long-tail)',
    });
  }
}

keepRows.sort((a, b) => a.keyword.localeCompare(b.keyword));
dropRows.sort((a, b) => a.keyword.localeCompare(b.keyword));

const csvOut = [
  header,
  ...keepRows.map((r) => [
    csvEscape(r.keyword),
    csvEscape(r.tracking_location),
    csvEscape(r.location_name_dfs),
    csvEscape(r.class),
    csvEscape(r.target_page),
    csvEscape(r.llm_prompt || 'false'),
  ].join(',')),
].join('\n') + '\n';

writeFileSync(outCsv, csvOut, 'utf8');

const report = `# Keyword cull KEEP/DROP — v12

**Source:** \`config/keyword-tracking-locations-and-class-LOCKED-v11.csv\` (${rows.length} keywords)  
**Output:** \`config/keyword-tracking-locations-and-class-LOCKED-v12.csv\` (**${keepRows.length} keep** / ${dropRows.length} drop)

## Scope

- Courses / workshops / mentoring / gifts: local + national money pages
- Services: **local/regional only** (near me / Coventry etc.)
- Drop: brand reviews, vol 0, national service heads, synonym stacks, off-brief terms

## KEEP (${keepRows.length})

| Keyword | Class | Location | Target page |
|---------|-------|----------|-------------|
${keepRows.map((r) => `| ${r.keyword} | ${r.class} | ${r.tracking_location} | ${r.target_page || '—'} |`).join('\n')}

## DROP (${dropRows.length})

| Keyword | Class | Reason |
|---------|-------|--------|
${dropRows.map((r) => `| ${r.keyword} | ${r.class} | ${r.reason} |`).join('\n')}
`;

writeFileSync(outReport, report, 'utf8');
if (existsSync(outbox)) {
  writeFileSync(join(outbox, 'KEYWORD-CULL-KEEP-DROP-v12-LATEST.md'), report, 'utf8');
}

console.log(JSON.stringify({
  source: rows.length,
  keep: keepRows.length,
  drop: dropRows.length,
  outCsv,
  outReport,
}, null, 2));

if (keepRows.length < 70 || keepRows.length > 100) {
  console.warn(`WARN: keep count ${keepRows.length} outside ~85–95 target band`);
}
