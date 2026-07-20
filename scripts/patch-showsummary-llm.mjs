import fs from 'fs';
let t = fs.readFileSync('audit-dashboard.html', 'utf8');
const marker = `        if (summary.warning) {
          summaryItems.push(\`<div style="padding: 1rem; background: #fffbeb; border-radius: 6px; border-left: 3px solid #f59e0b; margin-bottom: 1rem;"><strong style="color: #b45309;">Note:</strong><br><span style="font-size: 1rem;">\${summary.warning}</span></div>\`);
        }

        // Row 1`;
const inject = `        if (summary.warning) {
          summaryItems.push(\`<div style="padding: 1rem; background: #fffbeb; border-radius: 6px; border-left: 3px solid #f59e0b; margin-bottom: 1rem;"><strong style="color: #b45309;">Note:</strong><br><span style="font-size: 1rem;">\${summary.warning}</span></div>\`);
        }
        if (summary.llm) {
          const llm = summary.llm;
          const llmLine = llm.ok === false
            ? ('LLM visibility failed: ' + (llm.error || 'unknown'))
            : ('named ' + (llm.named || '—') + ' · mentions ' + (llm.mentions ?? '—') + ' · $' + (llm.cost_usd ?? '—'));
          summaryItems.push(\`<div style="padding: 0.75rem; background: #f8fafc; border-radius: 6px; border-left: 3px solid #0f766e; margin-bottom: 1rem;"><strong style="color: #0f766e;">ChatGPT / LLM visibility</strong><br><span style="font-size: 1rem;">\${llmLine}</span></div>\`);
        }

        // Row 1`;
if (!t.includes(marker)) throw new Error('marker missing');
t = t.replace(marker, inject);
fs.writeFileSync('audit-dashboard.html', t);
console.log('ok');
