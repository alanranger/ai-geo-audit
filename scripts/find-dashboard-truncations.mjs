import fs from 'fs';
const t = fs.readFileSync('audit-dashboard.html', 'utf8');

function lineOf(idx) {
  return t.slice(0, idx).split(/\n/).length;
}

const needles = [
  'function buildGlobalRunSummaryHtml',
  'LLM step ',
  "foot.textContent = 'Manual only",
  'if (summary.llm)',
  'includeLlm',
];
for (const n of needles) {
  let idx = 0;
  let c = 0;
  while (true) {
    const i = t.indexOf(n, idx);
    if (i < 0) break;
    c += 1;
    console.log(n, '#' + c, 'line', lineOf(i));
    console.log(JSON.stringify(t.slice(i, i + 160)));
    idx = i + n.length;
  }
  if (!c) console.log(n, 'NONE');
}

// Find unclosed template literals heuristically: ` then newline then blank then async/function without closing `
const re = /`[^`]*$/gm;
// Better: positions of `LLM step` followed soon by newline without closing backtick
let i = 0;
while ((i = t.indexOf('LLM step', i)) >= 0) {
  const window = t.slice(i, i + 80);
  console.log('LLM step window line', lineOf(i), JSON.stringify(window));
  i += 8;
}
