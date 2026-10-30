/**
 * Traditional SEO rendered-audit client.
 * ① starts a checkpointed run; ticks continue if the tab is closed (cron + resume).
 */
(function () {
  const API = '/api/aigeo/traditional-seo-render';
  const RUN_KEY = 'trad_seo_render_run_id';
  const SAMPLE_KEY = 'trad_seo_sample_urls';
  const FORCE_KEY = 'trad_seo_force_not_checked';

  function api(p) {
    return typeof window.apiUrl === 'function' ? window.apiUrl(p) : p;
  }

  async function fetchJson(path, init) {
    const res = await fetch(api(path), init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function readJsonList(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function sampleUrls() {
    return readJsonList(SAMPLE_KEY).filter((u) => /^https:\/\/(www\.)?alanranger\.com/i.test(String(u)));
  }

  function sourceName() {
    return sampleUrls().length ? 'trad_seo_playwright' : 'trad_seo';
  }

  function forceNotChecked() {
    return /playwright/i.test(sourceName()) ? readJsonList(FORCE_KEY) : [];
  }

  function applySnapshot(body) {
    if (typeof window.tradSeoApplyRenderSnapshot === 'function') {
      window.tradSeoApplyRenderSnapshot(body);
    }
    return body;
  }

  window.tradSeoRenderLoad = async function tradSeoRenderLoad(opts = {}) {
    const runId = opts.runId || localStorage.getItem(RUN_KEY) || '';
    const q = new URLSearchParams();
    if (runId) q.set('runId', runId);
    if (opts.health) q.set('health', '1');
    const body = await fetchJson(`${API}?${q.toString()}`);
    if (body.run?.run_id) localStorage.setItem(RUN_KEY, body.run.run_id);
    return applySnapshot(body);
  };

  window.tradSeoRenderStart = async function tradSeoRenderStart() {
    const urls = sampleUrls();
    const body = await fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        source: sourceName(),
        urls,
        forceNotChecked: forceNotChecked()
      })
    });
    if (body.run_id) localStorage.setItem(RUN_KEY, body.run_id);
    return body;
  };

  window.tradSeoRenderTick = async function tradSeoRenderTick(runId) {
    const id = runId || localStorage.getItem(RUN_KEY);
    return fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'tick',
        runId: id,
        source: sourceName(),
        urls: sampleUrls(),
        forceNotChecked: forceNotChecked(),
        budgetMs: 200000
      })
    });
  };

  window.tradSeoBrokenTick = async function tradSeoBrokenTick(runId) {
    const id = runId || localStorage.getItem(RUN_KEY);
    return fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'broken-tick',
        runId: id,
        source: sourceName(),
        forceNotChecked: forceNotChecked(),
        budgetMs: 180000
      })
    });
  };

  window.tradSeoRecheckUrl = async function tradSeoRecheckUrl(pageUrl) {
    return fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recheck', url: pageUrl })
    });
  };

  window.tradSeoRenderLoop = async function tradSeoRenderLoop(onProgress, existingRunId) {
    let runId = existingRunId || localStorage.getItem(RUN_KEY);
    let tick = runId
      ? await window.tradSeoRenderTick(runId)
      : await window.tradSeoRenderStart();
    runId = tick.run_id || runId;
    if (runId) localStorage.setItem(RUN_KEY, runId);
    while (!tick.done && !tick.idle) {
      if (typeof onProgress === 'function') onProgress(tick.summary || tick);
      tick = await window.tradSeoRenderTick(runId);
      runId = tick.run_id || runId;
    }
    if (typeof onProgress === 'function') onProgress({ ...(tick.summary || tick), phase: 'broken_links' });
    let broken = { done: false };
    while (!broken.done) {
      broken = await window.tradSeoBrokenTick(runId);
      if (typeof onProgress === 'function') onProgress({ ...broken, phase: 'broken_links' });
    }
    return window.tradSeoRenderLoad({ runId, health: true });
  };
})();
