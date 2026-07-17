import fs from 'fs';

const path = 'audit-dashboard.html';
let t = fs.readFileSync(path, 'utf8');

const start = t.indexOf('function buildGlobalRunSummaryHtml');
const end = t.indexOf('async function postGlobalRunRefresh');
if (start < 0 || end < 0) throw new Error(`markers missing start=${start} end=${end}`);

const fixed = `function buildGlobalRunSummaryHtml(steps, failedKeys) {
        const failed = steps.filter(s => s.status === 'Failed');
        const skipped = steps.filter(s => s.status === 'Skipped');
        const llmStep = steps.find(s => s.key === 'llm_visibility');
        const llm = llmStep?.result || window.__llmVisibilityLastCollect || null;
        const parts = [];
        if (!failed.length && !skipped.length) {
          parts.push('<div>Saved a new global run snapshot.</div>');
        } else {
          parts.push('<div><strong>Saved a partial global run snapshot.</strong>');
          if (failed.length) {
            parts.push('<div style="margin-top:0.4rem;">Failed: ' + failed.map(s => s.key + ': ' + (s.errorMessage || 'unknown error')).join(' | ') + '</div>');
          }
          if (skipped.length) {
            parts.push('<div style="margin-top:0.4rem; color: var(--dark-text-muted);">Skipped: ' + skipped.map(s => s.key + ' (' + (s.errorMessage || 'dependency failed') + ')').join(' | ') + '</div>');
          }
          parts.push('</div>');
        }
        if (llm && llm.ok !== false) {
          parts.push('<div style="margin-top:0.55rem;">ChatGPT / LLM visibility: named <strong>' + (llm.named || '-') + '</strong> · domain mentions <strong>' + (llm.mentions ?? '-') + '</strong> · DFS cost <strong>$' + (llm.cost_usd ?? '-') + '</strong></div>');
        } else if (llmStep && llmStep.status === 'Failed') {
          parts.push('<div style="margin-top:0.55rem;">ChatGPT / LLM visibility: failed (' + (llmStep.errorMessage || 'unknown') + ')</div>');
        }
        const dfsish = steps.filter(s => ['ranking_ai','llm_visibility','dfs_full_index','ke_topup'].includes(s.key) && (s.status === 'OK' || s.status === 'Done'));
        if (dfsish.length) {
          const llmCost = Number(llm?.cost_usd);
          parts.push('<div style="margin-top:0.35rem;color:var(--dark-text-muted);font-size:0.9em;">DFS-heavy steps in this run: ' + dfsish.map(s => s.key).join(', ') + (Number.isFinite(llmCost) ? (' · LLM step $' + llmCost) : '') + '. Full refresh typically ~$0.24 hyperlocal + ~$0.48 AI Mode + ~$0.87 LLM when those steps run.</div>');
        }
        return parts.join('');
      }

      `;

t = t.slice(0, start) + fixed + t.slice(end);

// Also ensure footnote string is intact
const brokenFoot = /foot\.textContent = 'Manual only \(Full refresh \+ Ranking & AI check\) · flagged subset of tracked keywords · last collect\s*\n/;
if (brokenFoot.test(t)) {
  t = t.replace(
    brokenFoot,
    "foot.textContent = 'Manual only (Full refresh + Ranking & AI check) · flagged subset of tracked keywords · last collect $'\n          + (s.cost_usd != null ? s.cost_usd : '-')\n          + '. This is NOT Google AI Overviews.';\n"
  );
}

fs.writeFileSync(path, t);

// Verify markers
const i2 = t.indexOf('function buildGlobalRunSummaryHtml');
const j2 = t.indexOf('async function postGlobalRunRefresh');
const between = t.slice(i2, j2);
if (!between.includes('return parts.join')) throw new Error('repair incomplete');
if (between.includes("LLM step \n")) throw new Error('still truncated');
console.log('OK repaired summary length', between.length);

// Extract main inline script(s) and check for obvious unterminated template near known hotspots
const hotspots = [
  t.indexOf("foot.textContent = 'Manual only"),
  t.indexOf('function buildGlobalRunSummaryHtml'),
  t.indexOf('includeLlm'),
];
for (const h of hotspots) {
  console.log('hotspot', h, JSON.stringify(t.slice(h, h + 180)).slice(0, 200));
}
