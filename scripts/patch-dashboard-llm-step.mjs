import fs from 'fs';

const path = 'audit-dashboard.html';
let t = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const backups = [];

function mustReplace(label, oldStr, newStr) {
  if (!t.includes(oldStr)) throw new Error('MISSING: ' + label);
  t = t.replace(oldStr, newStr);
  backups.push(label);
}

mustReplace(
  'ranking steps',
  `      steps: [
        { id: 'init', label: 'Initializing', narrative: 'Preparing to fetch ranking and AI data...' },
        { id: 'serp', label: "Fetching SERP + Google's AI answer", narrative: "Retrieving organic ranks, search volume, and Google's AI answer citations (single DFS call)..." },
        { id: 'ai', label: 'Fetching Google AI Mode', narrative: 'Checking Google AI Mode (udm=50) presence and citations...' },
        { id: 'process', label: 'Processing Results', narrative: 'Combining SERP, AIO and AI Mode data into per-engine slots and calculating metrics...' },
        { id: 'save', label: 'Saving Data', narrative: 'Storing results to database...' },
        { id: 'complete', label: 'Complete', narrative: 'Ranking & AI check completed successfully!' }
      ],`,
  `      steps: [
        { id: 'init', label: 'Initializing', narrative: 'Preparing to fetch ranking and AI data...' },
        { id: 'serp', label: "Fetching SERP + Google's AI answer", narrative: "Retrieving organic ranks, search volume, and Google's AI answer citations (single DFS call)..." },
        { id: 'ai', label: 'Fetching Google AI Mode', narrative: 'Checking Google AI Mode (udm=50) presence and citations...' },
        { id: 'process', label: 'Processing Results', narrative: 'Combining SERP, AIO and AI Mode data into per-engine slots and calculating metrics...' },
        { id: 'save', label: 'Saving Data', narrative: 'Storing results to database...' },
        { id: 'llm', label: 'ChatGPT / LLM visibility (mentions + prompt bank)', narrative: 'Running ChatGPT naming checks on the flagged tracked-keyword subset + domain mentions...' },
        { id: 'complete', label: 'Complete', narrative: 'Ranking & AI check completed successfully!' }
      ],`
);

mustReplace(
  'loadRankingAiData sig',
  "async function loadRankingAiData(force = false) {\n      debugLog('📊 loadRankingAiData called with force=' + force, 'info');",
  "async function loadRankingAiData(force = false, options = {}) {\n      const includeLlm = options?.includeLlm === true && !window._dashboardGlobalRunActive;\n      debugLog('📊 loadRankingAiData called with force=' + force + ' includeLlm=' + includeLlm, 'info');"
);

mustReplace(
  'success complete block',
  `        RankingAiProgressModal.updateProgress(98, 4);
        RankingAiProgressModal.updateCounts(\`✓ Data saved successfully\`);
        
        // Step 5: Complete (only reached if save succeeded)
        RankingAiProgressModal.updateProgress(100, 5);
        RankingAiProgressModal.setActiveStep(5, true); // Mark as complete (green) not active (amber)
        
        // Show completion summary
        RankingAiProgressModal.showSummary({
          warning: saveWarning || null,
          totalKeywords,
          keywordsWithRank: withRank,
          avgPositionVolumeWeighted: summary.avg_position_volume_weighted,
          keywordsWithVolume: summary.keywords_with_volume,
          surfaces: computeScanSurfaceSummary(combined),
          aiFetchError: aiFetchError || null
        });`,
  `        RankingAiProgressModal.updateProgress(90, 4);
        RankingAiProgressModal.updateCounts(\`✓ Data saved successfully\`);

        let llmCollectMeta = null;
        if (includeLlm) {
          RankingAiProgressModal.updateProgress(92, 5);
          RankingAiProgressModal.setActiveStep(5);
          RankingAiProgressModal.updateCounts('Running ChatGPT / LLM visibility…');
          try {
            const llmResp = await fetch(apiUrl('/api/aigeo/llm-visibility-collect'), { method: 'POST' });
            const llmJson = await llmResp.json().catch(() => ({}));
            if (!llmResp.ok || llmJson?.ok === false) throw new Error(llmJson?.error || ('HTTP ' + llmResp.status));
            llmCollectMeta = llmJson;
            if (typeof window.fetchLlmVisibility === 'function') {
              try { await window.fetchLlmVisibility(); } catch (_e) { /* non-fatal */ }
            }
            RankingAiProgressModal.updateCounts(\`✓ LLM visibility done (named \${llmJson.named || '?'} · $\${llmJson.cost_usd ?? '?'})\`);
          } catch (llmErr) {
            llmCollectMeta = { ok: false, error: llmErr?.message || String(llmErr) };
            debugLog('LLM visibility collect failed: ' + (llmErr?.message || llmErr), 'warn');
            RankingAiProgressModal.updateCounts('⚠ LLM visibility failed — SERP/AI Mode data still saved');
          }
        } else {
          RankingAiProgressModal.setActiveStep(5, true);
        }
        
        // Step 6: Complete (only reached if save succeeded)
        RankingAiProgressModal.updateProgress(100, 6);
        RankingAiProgressModal.setActiveStep(6, true); // Mark as complete (green) not active (amber)
        
        // Show completion summary
        RankingAiProgressModal.showSummary({
          warning: saveWarning || null,
          totalKeywords,
          keywordsWithRank: withRank,
          avgPositionVolumeWeighted: summary.avg_position_volume_weighted,
          keywordsWithVolume: summary.keywords_with_volume,
          surfaces: computeScanSurfaceSummary(combined),
          aiFetchError: aiFetchError || null,
          llm: llmCollectMeta
        });`
);

mustReplace(
  'button loadRankingAiData true',
  `await loadRankingAiData(true); // force re-run
              } else if (typeof window.loadRankingAiData === 'function') {
                debugLog('✓ Calling loadRankingAiData (window)', 'info');
                await window.loadRankingAiData(true); // force re-run`,
  `await loadRankingAiData(true, { includeLlm: true }); // force re-run + LLM layer
              } else if (typeof window.loadRankingAiData === 'function') {
                debugLog('✓ Calling loadRankingAiData (window)', 'info');
                await window.loadRankingAiData(true, { includeLlm: true }); // force re-run + LLM layer`
);

mustReplace(
  'dashboardRunRankingAiScan',
  `await window.loadRankingAiData(true);
          if (typeof window.renderDashboardTab === 'function') window.renderDashboardTab();`,
  `await window.loadRankingAiData(true, { includeLlm: true });
          if (typeof window.renderDashboardTab === 'function') window.renderDashboardTab();`
);

mustReplace(
  'catalog ranking_ai',
  `{ key: 'ranking_ai', label: 'Ranking & AI scan (tracked keywords)', tiers: ['standard','full'], dependsOn: [], runner: runGlobalStepRankingAi },
          { key: 'revenue_sync', label: 'Revenue sync (Squarespace + Stripe)', tiers: ['quick','standard','full'], dependsOn: [], runner: runGlobalStepRevenueSync },`,
  `{ key: 'ranking_ai', label: 'Ranking & AI scan (tracked keywords)', tiers: ['standard','full'], dependsOn: [], runner: runGlobalStepRankingAi },
          { key: 'llm_visibility', label: 'ChatGPT / LLM visibility (mentions + prompt bank)', tiers: ['full'], dependsOn: ['ranking_ai'], runner: runGlobalStepLlmVisibility },
          { key: 'revenue_sync', label: 'Revenue sync (Squarespace + Stripe)', tiers: ['quick','standard','full'], dependsOn: [], runner: runGlobalStepRevenueSync },`
);

mustReplace(
  'after ranking runner',
  `      async function runGlobalStepRankingAi() {
        debugLog('[Global Run] [Ranking & AI Scan] Starting...', 'info');
        if (typeof window.loadRankingAiData !== 'function') throw new Error('loadRankingAiData function not available');
        const result = await window.loadRankingAiData(true);
        debugLog(\`[Global Run] [Ranking & AI Scan] Data loaded. Result: \${JSON.stringify(result || 'undefined')}\`, 'info');
        const savedRankingData = localStorage.getItem('rankingAiData');
        if (savedRankingData) {
          try {
            const parsed = JSON.parse(savedRankingData);
            debugLog(\`[Global Run] [Ranking & AI Scan] ✓ localStorage ok (\${parsed.combinedRows?.length || 0} keywords)\`, 'success');
          } catch (_e) {
            debugLog('[Global Run] [Ranking & AI Scan] ⚠ Warning: Could not parse saved data', 'warn');
          }
        }
        debugLog('[Global Run] [Ranking & AI Scan] Waiting for data to be saved to Supabase...', 'info');
        await verifyRankingAiSavedToSupabase();
        if (typeof window.renderRankingAiTab === 'function') {
          await new Promise(resolve => setTimeout(resolve, 500));
          window.renderRankingAiTab();
        }
        return result;
      }

      async function runGlobalStepMoneyPages() {`,
  `      async function runGlobalStepRankingAi() {
        debugLog('[Global Run] [Ranking & AI Scan] Starting...', 'info');
        if (typeof window.loadRankingAiData !== 'function') throw new Error('loadRankingAiData function not available');
        const result = await window.loadRankingAiData(true); // LLM is a separate Full-tier step
        debugLog(\`[Global Run] [Ranking & AI Scan] Data loaded. Result: \${JSON.stringify(result || 'undefined')}\`, 'info');
        const savedRankingData = localStorage.getItem('rankingAiData');
        if (savedRankingData) {
          try {
            const parsed = JSON.parse(savedRankingData);
            debugLog(\`[Global Run] [Ranking & AI Scan] ✓ localStorage ok (\${parsed.combinedRows?.length || 0} keywords)\`, 'success');
          } catch (_e) {
            debugLog('[Global Run] [Ranking & AI Scan] ⚠ Warning: Could not parse saved data', 'warn');
          }
        }
        debugLog('[Global Run] [Ranking & AI Scan] Waiting for data to be saved to Supabase...', 'info');
        await verifyRankingAiSavedToSupabase();
        if (typeof window.renderRankingAiTab === 'function') {
          await new Promise(resolve => setTimeout(resolve, 500));
          window.renderRankingAiTab();
        }
        return result;
      }

      async function runGlobalStepLlmVisibility() {
        debugLog('[Global Run] [LLM visibility] Starting...', 'info');
        const resp = await fetch(apiUrl('/api/aigeo/llm-visibility-collect'), { method: 'POST' });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || json?.ok === false) throw new Error(json?.error || ('HTTP ' + resp.status));
        window.__llmVisibilityLastCollect = json;
        if (typeof window.fetchLlmVisibility === 'function') {
          try { await window.fetchLlmVisibility(); } catch (_e) { /* non-fatal */ }
        }
        debugLog(\`[Global Run] [LLM visibility] named \${json.named || '?'} cost $\${json.cost_usd ?? '?'}\`, 'success');
        return json;
      }

      async function runGlobalStepMoneyPages() {`
);

mustReplace(
  'buildGlobalRunSummaryHtml',
  `      function buildGlobalRunSummaryHtml(steps, failedKeys) {
        const failed = steps.filter(s => s.status === 'Failed');
        const skipped = steps.filter(s => s.status === 'Skipped');
        if (!failed.length && !skipped.length) {
          return '<div>Saved a new global run snapshot.</div>';
        }
        const parts = ['<div><strong>Saved a partial global run snapshot.</strong>'];
        if (failed.length) {
          parts.push(\`<div style="margin-top:0.4rem;">Failed: \${failed.map(s => \`\${s.key}: \${s.errorMessage || 'unknown error'}\`).join(' | ')}</div>\`);
        }
        if (skipped.length) {
          parts.push(\`<div style="margin-top:0.4rem; color: var(--dark-text-muted);">Skipped: \${skipped.map(s => \`\${s.key} (\${s.errorMessage || 'dependency failed'})\`).join(' | ')}</div>\`);
        }
        parts.push('</div>');
        return parts.join('');
      }`,
  `      function buildGlobalRunSummaryHtml(steps, failedKeys) {
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
            parts.push(\`<div style="margin-top:0.4rem;">Failed: \${failed.map(s => \`\${s.key}: \${s.errorMessage || 'unknown error'}\`).join(' | ')}</div>\`);
          }
          if (skipped.length) {
            parts.push(\`<div style="margin-top:0.4rem; color: var(--dark-text-muted);">Skipped: \${skipped.map(s => \`\${s.key} (\${s.errorMessage || 'dependency failed'})\`).join(' | ')}</div>\`);
          }
          parts.push('</div>');
        }
        if (llm && llm.ok !== false) {
          parts.push(\`<div style="margin-top:0.55rem;">ChatGPT / LLM visibility: named <strong>\${llm.named || '—'}</strong> · domain mentions <strong>\${llm.mentions ?? '—'}</strong> · DFS cost <strong>$\${llm.cost_usd ?? '—'}</strong></div>\`);
        } else if (llmStep && llmStep.status === 'Failed') {
          parts.push(\`<div style="margin-top:0.55rem;">ChatGPT / LLM visibility: failed (\${llmStep.errorMessage || 'unknown'})</div>\`);
        }
        const dfsish = steps.filter(s => ['ranking_ai','llm_visibility','dfs_full_index','ke_topup'].includes(s.key) && s.status === 'OK');
        if (dfsish.length) {
          const llmCost = Number(llm?.cost_usd);
          parts.push(\`<div style="margin-top:0.35rem;color:var(--dark-text-muted);font-size:0.9em;">DFS-heavy steps in this run: \${dfsish.map(s => s.key).join(', ')}\${Number.isFinite(llmCost) ? ' · LLM step $' + llmCost : ''}. Full refresh typically ≈ $0.24 hyperlocal + $0.48 AI Mode + $0.87 LLM when those steps run.</div>\`);
        }
        return parts.join('');
      }`
);

mustReplace(
  'llm empty copy',
  "body.innerHTML = '<p style=\"margin:0;color:#64748b;\">No ChatGPT / LLM snapshot stored yet. Collect via <code>scripts/collect-llm-visibility.mjs</code> (weekly).</p>';",
  "body.innerHTML = '<p style=\"margin:0;color:#64748b;\">No ChatGPT / LLM snapshot stored yet. Runs on Full refresh or Ranking &amp; AI check (manual).</p>';"
);

mustReplace(
  'prompt rows',
  `      const promptRows = prompts.map((p) => {
        const flag = p.named ? '<span style="color:#166534;font-weight:700;">YES</span>' : '<span style="color:#b91c1c;">no</span>';
        const rivals = (p.rivals || []).slice(0, 3).join(', ') || '—';
        return '<tr><td style="text-align:left;padding:0.35rem 0.4rem;">' + String(p.prompt || '')
          + '</td><td style="padding:0.35rem 0.4rem;">' + flag
          + '</td><td style="text-align:left;padding:0.35rem 0.4rem;font-size:0.8rem;color:#475569;">' + rivals
          + '</td></tr>';
      }).join('');`,
  `      const promptRows = prompts.map((p) => {
        const flag = p.named ? '<span style="color:#166534;font-weight:700;">YES</span>' : '<span style="color:#b91c1c;">no</span>';
        const rivals = (p.rivals || []).slice(0, 3).join(', ') || '—';
        const kw = String(p.keyword || p.prompt || '');
        return '<tr><td style="text-align:left;padding:0.35rem 0.4rem;">' + kw
          + '</td><td style="padding:0.35rem 0.4rem;">' + flag
          + '</td><td style="text-align:left;padding:0.35rem 0.4rem;font-size:0.8rem;color:#475569;">' + rivals
          + '</td></tr>';
      }).join('');`
);

mustReplace(
  'llm table header',
  `        + '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;"><thead><tr>'
        + '<th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:0.35rem 0.4rem;">Prompt</th>'
        + '<th style="border-bottom:1px solid #cbd5e1;padding:0.35rem 0.4rem;">Named?</th>'
        + '<th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:0.35rem 0.4rem;">Rivals cited</th>'
        + '</tr></thead><tbody>' + promptRows + '</tbody></table>'`,
  `        + '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;"><thead><tr>'
        + '<th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:0.35rem 0.4rem;">Tracked keyword</th>'
        + '<th style="border-bottom:1px solid #cbd5e1;padding:0.35rem 0.4rem;">ChatGPT names me?</th>'
        + '<th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:0.35rem 0.4rem;">Rivals cited</th>'
        + '</tr></thead><tbody>' + promptRows + '</tbody></table>'`
);

mustReplace(
  'llm footnote',
  `        foot.textContent = 'Cadence: weekly domain + prompts · monthly historical refresh · est. $5–15/mo · last collect $'
          + (s.cost_usd != null ? s.cost_usd : '—')
          + '. This is NOT Google AI Overviews.';`,
  `        foot.textContent = 'Manual only (Full refresh + Ranking & AI check) · flagged subset of tracked keywords · last collect $'
          + (s.cost_usd != null ? s.cost_usd : '—')
          + '. This is NOT Google AI Overviews.';`
);

fs.writeFileSync(path, t);
console.log('Patched:', backups.join(', '));
