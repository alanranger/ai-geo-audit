/**
 * Strategy & Actions "Where we stand and why" tiles (top of the tab): one-line summary, then MONEY · DEMAND &
 * FULFILMENT · MIX & GROWTH (4 tiles each). Data: strategy-summary `insights` (lib/strategy-insights/*). Red only
 * when behind; every tile shows its window, source and freshness.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
  const ROWS = [['money', 'Money'], ['demand', 'Demand & fulfilment'], ['mix', 'Mix & growth']];

  const td = (c, i) => `<td class="${i === 0 ? 'left' : ''}${c.muted ? ' si-muted' : ''}${c.bold ? ' si-bold' : ''}"${c.title ? ` title="${esc(c.title)}"` : ''}>${c.rag && c.rag !== 'grey' ? `<span class="si-rag si-${c.rag}">${esc(c.v)}</span>` : esc(c.v)}</td>`;
  const tr = (r) => `<tr>${r.map(td).join('')}</tr>`;
  function tableHtml(t) {
    if (!t) return '';
    const head = `<thead><tr>${t.cols.map((c, i) => `<th class="${i === 0 ? 'left' : ''}">${esc(c)}</th>`).join('')}</tr></thead>`;
    const body = t.sections
      ? t.sections.map((s) => `${s.head ? `<tr class="si-sec"><td colspan="${t.cols.length}">${esc(s.head)}</td></tr>` : ''}${s.rows.map(tr).join('')}`).join('')
      : t.rows.map(tr).join('');
    return `<table class="si-table">${head}<tbody>${body}</tbody></table>${t.footnote ? `<div class="si-foot">${esc(t.footnote)}</div>` : ''}`;
  }
  const boxHtml = (b) => `<div class="si-box si-box-${esc(b.rag || 'grey')}"><div class="si-box-l">${esc(b.label)}${b.estimated ? ' <span class="si-est">estimate</span>' : ''}</div><div class="si-box-v">${esc(b.value)}</div><div class="si-box-s">${esc(b.sub)}</div></div>`;
  function linkHtml(l) {
    if (!l) return '';
    const attr = l.panel ? `data-si-panel="${esc(l.panel)}"` : `data-si-anchor="${esc(l.anchor)}"`;
    return `<a href="#" class="si-link" ${attr}>${esc(l.label)}</a>`;
  }
  function tileRag(t) {
    return t.headRag || t.headline?.delta?.rag || t.headline?.rag || 'grey';
  }
  function tileHtml(t) {
    const h = t.headline || {};
    const delta = h.delta ? ` <span class="si-delta si-${esc(h.delta.rag)}">${esc(h.delta.text)}</span>` : '';
    return `<div class="si-tile si-edge-${esc(tileRag(t))}" data-si-key="${esc(t.key)}">
      <h4 class="si-title">${esc(t.title)}</h4>
      <div class="si-head"><span class="si-val${h.rag ? ` si-${esc(h.rag)}` : ''}">${esc(h.value)}</span> <span class="si-lab">${esc(h.label || '')}</span>${delta}</div>
      <div class="si-cmp">${esc(t.comparison || '')}</div>
      ${t.boxes ? `<div class="si-boxes">${t.boxes.map(boxHtml).join('')}</div>` : ''}
      ${tableHtml(t.table)}${tableHtml(t.table2)}
      ${t.note ? `<p class="si-note">${esc(t.note)}</p>` : ''}
      ${t.foot ? `<div class="si-foot">${esc(t.foot)}</div>` : ''}
      ${linkHtml(t.link)}
      <div class="si-src">${esc(t.source || '')} · Booking Sheet imported ${esc(stamp(t.freshness))}</div>
    </div>`;
  }

  const STYLE = `<style>
    #st-insights .si-summary { background: #0b1118; border: 1px solid var(--dark-border); border-left: 4px solid var(--dark-brand); border-radius: 8px; padding: 0.7rem 1rem; margin-bottom: 1rem; font-size: 0.95rem; line-height: 1.5; color: var(--dark-text); }
    #st-insights .si-rowlab { font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dark-text-muted); margin: 0.9rem 0 0.4rem; }
    #st-insights .si-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.8rem; }
    @media (max-width: 1400px) { #st-insights .si-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { #st-insights .si-row { grid-template-columns: 1fr; } }
    #st-insights .si-tile { background: #111827; border: 1px solid var(--dark-border); border-left: 4px solid #475569; border-radius: 10px; padding: 0.85rem 0.95rem; min-width: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    #st-insights .si-edge-red { border-left-color: #ef4444; } #st-insights .si-edge-amber { border-left-color: #f59e0b; } #st-insights .si-edge-green { border-left-color: #22c55e; }
    #st-insights .si-title { margin: 0; font-size: 1.05rem; font-weight: 800; color: #ffffff; }
    #st-insights .si-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem; }
    #st-insights .si-val { font-size: 1.7rem; font-weight: 900; color: #ffffff; line-height: 1.1; }
    #st-insights .si-lab { font-size: 0.85rem; color: var(--dark-text-muted); }
    #st-insights .si-delta { font-size: 1.05rem; font-weight: 800; }
    #st-insights .si-red { color: #f87171; } #st-insights .si-amber { color: #fbbf24; } #st-insights .si-green { color: #4ade80; }
    #st-insights .si-cmp { font-size: 0.78rem; color: var(--dark-text-muted); line-height: 1.4; }
    #st-insights .si-table { width: 100%; border-collapse: collapse; font-size: 0.76rem; margin-top: 0.3rem; table-layout: auto; }
    #st-insights .si-table th { color: var(--dark-text-muted); font-weight: 700; text-align: right; padding: 3px 4px; border-bottom: 1px solid #1f2937; }
    #st-insights .si-table td { text-align: right; padding: 3px 4px; border-bottom: 1px solid #1f2937; white-space: normal; overflow-wrap: anywhere; }
    #st-insights .si-table .left { text-align: left; }
    #st-insights .si-table .si-muted { color: #64748b; } #st-insights .si-table .si-bold { font-weight: 800; }
    #st-insights .si-sec td { text-align: left; font-size: 0.68rem; letter-spacing: 0.05em; text-transform: uppercase; color: #94a3b8; padding-top: 6px; }
    #st-insights .si-rag { font-weight: 800; }
    #st-insights .si-boxes { display: grid; grid-template-columns: 1fr; gap: 0.4rem; }
    #st-insights .si-box { background: #0b1118; border: 1px solid #1f2937; border-radius: 6px; padding: 0.45rem 0.6rem; }
    #st-insights .si-box-red { border-color: #7f1d1d; } #st-insights .si-box-green { border-color: #14532d; }
    #st-insights .si-box-l { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; }
    #st-insights .si-box-v { font-size: 1.25rem; font-weight: 900; color: #fff; } #st-insights .si-box-red .si-box-v { color: #f87171; }
    #st-insights .si-box-s { font-size: 0.72rem; color: var(--dark-text-muted); line-height: 1.35; }
    #st-insights .si-est { font-size: 0.6rem; background: #1e3a8a; color: #bfdbfe; border-radius: 3px; padding: 0 4px; text-transform: none; }
    #st-insights .si-note { margin: 0.25rem 0 0; font-size: 0.86rem; color: var(--dark-text); line-height: 1.4; }
    #st-insights .si-foot { font-size: 0.7rem; color: #64748b; line-height: 1.35; }
    #st-insights .si-link { color: var(--dark-brand); font-size: 0.8rem; font-weight: 700; text-decoration: none; }
    #st-insights .si-src { margin-top: auto; font-size: 0.66rem; color: #64748b; }
  </style>`;

  window.stInsightsHtml = function stInsightsHtml(ins) {
    if (!ins) return `${STYLE}<h3>Where we stand and why</h3><p class="rt-sub">Loading…</p>`;
    if (ins.error) return `${STYLE}<h3>Where we stand and why</h3><p class="rt-sub">Could not build the tiles: ${esc(ins.error)}</p>`;
    return `${STYLE}<h3>Where we stand and why</h3><div class="si-summary">${esc(ins.summary)}</div>`
      + ROWS.map(([k, label]) => `<div class="si-rowlab">${esc(label)}</div><div class="si-row">${(ins.rows[k] || []).map(tileHtml).join('')}</div>`).join('')
      + `<p class="rt-sub" style="margin-top:.6rem">Built ${esc(stamp(ins.built_at))} · all figures calculated live; estimates are labelled.</p>`;
  };

  function goPanel(panel) {
    document.querySelector(`.aigeo-nav-item[data-panel="${panel}"]`)?.click();
  }
  document.addEventListener('click', (e) => {
    const p = e.target.closest?.('[data-si-panel]');
    const a = e.target.closest?.('[data-si-anchor]');
    if (!p && !a) return;
    e.preventDefault();
    if (p) { goPanel(p.dataset.siPanel); return; }
    document.getElementById(a.dataset.siAnchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
