/**
 * Traditional SEO rendered-audit client.
 * ① starts a checkpointed full run; ticks continue if the tab is closed (cron + resume).
 * Playwright/sample runs never become the full-run resume target.
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

  function forceNotChecked() {
    return readJsonList(FORCE_KEY);
  }

  function isFullSource(source) {
    return String(source || '') === 'trad_seo';
  }

  function rememberFullRun(run) {
    const id = run?.run_id || run?.id;
    const source = run?.source || 'trad_seo';
    const status = run?.status || 'running';
    if (id && isFullSource(source) && status === 'running') {
      localStorage.setItem(RUN_KEY, id);
      return;
    }
    if (!isFullSource(source) || status !== 'running') {
      const kept = localStorage.getItem(RUN_KEY);
      if (kept && kept === id) localStorage.removeItem(RUN_KEY);
    }
  }

  function applySnapshot(body) {
    rememberFullRun(body.run || body);
    if (typeof window.tradSeoApplyRenderSnapshot === 'function') {
      window.tradSeoApplyRenderSnapshot(body);
    }
    return body;
  }

  window.tradSeoRenderLoad = async function tradSeoRenderLoad(opts = {}) {
    const runId = opts.runId || '';
    const q = new URLSearchParams();
    if (runId) q.set('runId', runId);
    if (opts.health) q.set('health', '1');
    const body = await fetchJson(`${API}?${q.toString()}`);
    return applySnapshot(body);
  };

  window.tradSeoRenderStart = async function tradSeoRenderStart(opts = {}) {
    const sample = opts.sample === true;
    const body = await fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        source: sample ? 'trad_seo_playwright' : 'trad_seo',
        urls: sample ? sampleUrls() : [],
        forceNotChecked: sample ? forceNotChecked() : []
      })
    });
    if (body.run_id && !sample) localStorage.setItem(RUN_KEY, body.run_id);
    return body;
  };

  window.tradSeoRenderTick = async function tradSeoRenderTick(runId) {
    const id = runId || localStorage.getItem(RUN_KEY);
    return fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tick', runId: id, budgetMs: 200000 })
    });
  };

  window.tradSeoRenderCancel = async function tradSeoRenderCancel(runId) {
    const id = runId || localStorage.getItem(RUN_KEY);
    const body = await fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', runId: id })
    });
    localStorage.removeItem(RUN_KEY);
    return body;
  };

  window.tradSeoBrokenTick = async function tradSeoBrokenTick(runId) {
    const id = runId || localStorage.getItem(RUN_KEY);
    return fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broken-tick', runId: id, budgetMs: 180000 })
    });
  };

  window.tradSeoRecheckUrl = async function tradSeoRecheckUrl(pageUrl) {
    return fetchJson(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recheck', url: pageUrl })
    });
  };

  function stopRequested() {
    return window.__tradSeoCancelRender === true;
  }

  async function haltIfStopped(runId, tick) {
    if (!stopRequested()) return null;
    await window.tradSeoRenderCancel(runId);
    return { cancelled: true, run_id: runId, summary: tick.summary || tick };
  }

  window.tradSeoRenderLoop = async function tradSeoRenderLoop(onProgress) {
    window.__tradSeoCancelRender = false;
    let tick = await window.tradSeoRenderStart();
    let runId = tick.run_id;
    if (runId) localStorage.setItem(RUN_KEY, runId);
    while (!tick.done && !tick.idle) {
      const stopped = await haltIfStopped(runId, tick);
      if (stopped) return stopped;
      if (typeof onProgress === 'function') onProgress(tick.summary || tick);
      tick = await window.tradSeoRenderTick(runId);
      runId = tick.run_id || runId;
    }
    const afterRender = await haltIfStopped(runId, tick);
    if (afterRender) return afterRender;
    if (typeof onProgress === 'function') onProgress({ ...(tick.summary || tick), phase: 'broken_links' });
    let broken = { done: false };
    while (!broken.done) {
      const stopped = await haltIfStopped(runId, tick);
      if (stopped) return stopped;
      broken = await window.tradSeoBrokenTick(runId);
      if (typeof onProgress === 'function') onProgress({ ...broken, phase: 'broken_links' });
    }
    return window.tradSeoRenderLoad({ runId, health: true });
  };
})();
