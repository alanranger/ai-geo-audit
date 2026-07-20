import fs from 'fs';
const t = fs.readFileSync('audit-dashboard.html', 'utf8');
function lineOf(i) { return t.slice(0, i).split(/\n/).length; }
const terms = [
  'Surface Visibility',
  'surfaceVisibility',
  'Organic top-10',
  'organic top-10',
  'surfaceOutcomes',
  'surface-outcomes',
  'computeSurfaceVisibilityRollup',
  'Top of page',
  'brandScore',
  'needle',
  'drawNeedle',
  'heroGauge',
  'ai-health',
];
for (const term of terms) {
  let idx = 0, n = 0;
  while ((idx = t.indexOf(term, idx)) >= 0 && n < 5) {
    console.log(`${term} @ ${lineOf(idx)}`);
    idx += term.length;
    n += 1;
  }
}
