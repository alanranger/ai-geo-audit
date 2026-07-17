import fs from 'fs';

const path = 'audit-dashboard.html';
let t = fs.readFileSync(path, 'utf8');

const marker = "if (summary.llm) {";
const i = t.indexOf(marker);
if (i < 0) throw new Error('summary.llm block missing');

// Find the broken fragment and the next intact statement after it
const fragStart = t.indexOf("const llmLine = llm.ok === false", i);
if (fragStart < 0) throw new Error('llmLine missing');

// Find where the broken string ends - look for next clear marker after fragStart
const afterHint = t.indexOf('// Row 1', fragStart);
const altHint = t.indexOf('if (summary.totalKeywords', fragStart);
const end = afterHint > 0 ? afterHint : altHint;
if (end < 0) throw new Error('end marker missing');

const before = t.slice(0, fragStart);
const after = t.slice(end);

const replacement = `const llmLine = llm.ok === false
            ? ('LLM visibility failed: ' + (llm.error || 'unknown'))
            : ('named ' + (llm.named || '-') + ' · mentions ' + (llm.mentions ?? '-') + ' · $' + (llm.cost_usd ?? '-'));
          summaryItems.push('<div style="padding: 0.75rem; background: #f8fafc; border-radius: 6px; border-left: 3px solid #0f766e; margin-bottom: 1rem;"><strong style="color: #0f766e;">ChatGPT / LLM visibility</strong><br><span style="font-size: 1rem;">' + llmLine + '</span></div>');
        }

        `;

t = before + replacement + after;
fs.writeFileSync(path, t);
console.log('repaired showSummary llm block');
console.log(JSON.stringify(t.slice(fragStart, fragStart + 450)));
