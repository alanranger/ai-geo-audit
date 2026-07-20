import fs from 'fs';
let t = fs.readFileSync('audit-dashboard.html', 'utf8');
const old = `const stepResult = await stepDef.runner();
          if (stepResult && typeof stepResult === 'object' && stepResult.success === false) {
            throw new Error(stepResult.error || stepResult.message || 'Step reported failure');
          }
          const elapsed = formatGlobalRunElapsed(Date.now() - stepStartTime);
          stepState.status = 'Done';
          stepState.elapsedTime = elapsed;`;
const neu = `${old}
          stepState.result = stepResult;`;
if (!t.includes(old)) throw new Error('missing stepResult block');
t = t.replace(old, neu);
t = t.replace(
  "['ranking_ai','llm_visibility','dfs_full_index','ke_topup'].includes(s.key) && s.status === 'OK'",
  "['ranking_ai','llm_visibility','dfs_full_index','ke_topup'].includes(s.key) && (s.status === 'OK' || s.status === 'Done')"
);
fs.writeFileSync('audit-dashboard.html', t);
console.log('ok');
