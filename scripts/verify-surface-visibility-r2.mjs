import fs from 'fs';
const h = fs.readFileSync('audit-dashboard.html', 'utf8');
const checks = [
  ['hero', 'Overall Surface Visibility'],
  ['dials', 'ranking-ai-hero-class-dials'],
  ['diag', 'Diagnostics (citation composite)'],
  ['A', '(100 - surfaceScore) / 100'],
  ['brand', 'citationRows = list.filter'],
  ['spark', 'surfaceVisibility?.overall'],
  ['kpi', 'surfaceOverall'],
  ['classHdr', 'data-sort="keywordClass"'],
  ['attach', 'attachSurfaceVisibilityToPillarScores'],
  ['csv', "'Class'"],
  ['schema2', 'SURFACE_VISIBILITY_SCHEMA_VERSION = 2'],
];
for (const [n, s] of checks) console.log(h.includes(s) ? 'OK' : 'MISS', n);
console.log('surfaceVisibility count', (h.match(/surfaceVisibility/g) || []).length);
