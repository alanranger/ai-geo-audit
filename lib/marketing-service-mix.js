/**
 * Marketing & Campaigns → Overview, the row under row 1 (mock-up service-mix-tiles-v1, Alan 12 Nov 00:08):
 *  - 6c "Next 12 weeks: what we're promoting, by service" (wide): per service tier, items by channel, % of promotion,
 *    % of target and a flag (gap / under-promoted / in line / well covered);
 *  - 6d "Service × channel coverage": tiers × channels counts, amber 0 = no coverage.
 * Items = exactly the by-channel tile's (window.mkChannels.build): Sched + Waiting counted, drafts in the hover only,
 * sent never. Each item's tier comes from the server (s.service_mix.tags by the item's ref, lib/marketing/service-mix.mjs);
 * % of target = the Survival Cockpit tier targets (s.service_mix.targets). Clicking a row / cell filters the schedule to
 * those items (window.mkScheduleFilterRefs). Read-only.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => Number(v || 0).toLocaleString('en-GB');
  const ukDay = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '') : '—');
  const gbpK = (v) => (v >= 1000 ? `£${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `£${n(v)}`);
  const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : (many || `${one}s`)}`;

  /** The by-channel tile's channels, in its order; short headers for the matrix; bar colours as the mock. */
  const CH = { email: ['Email', 'em'], facebook: ['FB', 'fb'], instagram: ['IG', 'ig'], instagram_story: ['Story', 'st'], linkedin: ['LI', 'li'], gbp: ['GBP', 'gb'], youtube: ['YT', 'yt'] };
  const COUNTED = new Set(['sched', 'waiting']);
  const BUCKET = { sched: 'Sched', waiting: 'Waiting', drafts: 'Draft' };
  const FLAG = { gap: ['gap', 'none'], under: ['under-promoted', 'under'], ok: ['in line', 'ok'], over: ['well covered', 'over'] };

  /* ---------- model ---------- */

  const rowOf = (i) => i.tag?.row || 'none';
  function itemsOf(ch, tags) {
    return ch.rows.flatMap((r) => (r.items || []).map((i) => ({ ...i, channel: r.key, channel_label: r.label, tag: tags[i.ref] || null })));
  }
  function byChannel(items) {
    const out = Object.fromEntries(Object.keys(CH).map((k) => [k, 0]));
    for (const i of items) out[i.channel] = (out[i.channel] || 0) + 1;
    return out;
  }
  /** Whole-number % that add up to exactly 100 (largest remainder). */
  function pctOf(values) {
    const total = values.reduce((t, v) => t + v, 0);
    if (!total) return values.map(() => 0);
    const raw = values.map((v) => (v / total) * 100);
    const out = raw.map(Math.floor);
    const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
    const left = 100 - out.reduce((t, v) => t + v, 0);
    for (let k = 0; k < left; k += 1) out[order[k][1]] += 1;
    return out;
  }
  /**
   * Judged on the percentages shown (GPT correction 12 Nov, item 3): ratio = % of promotion ÷ % of target; under-promoted
   * at ≤ the stored "under" ratio (half or less), well covered above the "over" ratio, else in line.
   */
  const ratioOf = (r) => (r.target_pct ? r.promo_pct / r.target_pct : null);
  function flagOf(r, th) {
    if (r.key === 'none') return null;
    if (!r.n) return 'gap';
    const ratio = ratioOf(r);
    if (ratio == null) return null;
    if (ratio <= th.under + 1e-9) return 'under';
    return ratio > th.over + 1e-9 ? 'over' : 'ok';
  }
  function shares(rows, sm) {
    const promoTotal = rows.filter((r) => r.key !== 'none').reduce((t, r) => t + r.n, 0);
    const targeted = rows.filter((r) => sm.targets?.[r.key]);
    const monthly = targeted.map((r) => sm.targets[r.key].monthly || 0);
    const sum = monthly.reduce((t, v) => t + v, 0);
    const shown = pctOf(monthly);
    targeted.forEach((r, i) => Object.assign(r, { target: sm.targets[r.key], target_share: sum ? monthly[i] / sum : null, target_pct: shown[i] }));
    for (const r of rows) {
      r.promo_share = promoTotal && r.key !== 'none' ? r.n / promoTotal : null;
      r.promo_pct = r.promo_share == null ? null : Math.round(r.promo_share * 100);
    }
    return { promoTotal, targetTotal: sum };
  }

  function build(s, board, today, nowMs = Date.now()) {
    const sm = s?.service_mix;
    if (!sm || sm.error) return { missing: sm?.error || 'service tiers not available' };
    const ch = typeof window.mkChannels?.build === 'function' ? window.mkChannels.build(s, board, today, nowMs) : null;
    if (!ch) return { missing: 'content-mix list not available' };
    const waitingFor = ch.rows.filter((r) => r.missing).map((r) => r.label);
    if (waitingFor.length) return { missing: board === undefined ? 'Loading…' : `delivery-status board not available (${waitingFor.join(', ')})` };
    const all = itemsOf(ch, sm.tags || {});
    const counted = all.filter((i) => COUNTED.has(i.bucket));
    const rows = sm.rows.map((r) => {
      const items = counted.filter((i) => rowOf(i) === r.key);
      return { ...r, items, n: items.length, by: byChannel(items), drafts: all.filter((i) => i.bucket === 'drafts' && rowOf(i) === r.key) };
    });
    const totals = shares(rows, sm);
    for (const r of rows) r.flag = flagOf(r, sm.thresholds);
    return { win: ch.win, rows, total: counted.length, drafts: all.filter((i) => i.bucket === 'drafts').length, ...totals, sm };
  }

  /* ---------- hovers ---------- */

  const itemLine = (i) => `${ukDay(i.day)} · ${i.channel_label} · "${i.tag?.title || i.ref}" (${BUCKET[i.bucket] || i.bucket})`;
  const secondaryLine = (i) => (i.tag?.secondary?.length ? `\n    also: ${i.tag.secondary.map((x) => x.label).join(', ')} (secondary, not counted)` : '');
  const sortByDay = (xs) => [...xs].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.channel).localeCompare(String(b.channel)));
  /** "9% of promotion vs 18% of target = 0.50× · under-promoted at ≤ 0.5×, well covered above 1.5×". */
  function compareLine(r, th) {
    const ratio = ratioOf(r);
    if (ratio == null) return '';
    return `\n${r.promo_pct}% of promotion vs ${r.target_pct}% of target = ${ratio.toFixed(2)}× · under-promoted at ≤ ${th.under}×, well covered above ${th.over}×, in line between (${th.source})`;
  }
  const subtypeLine = (i) => (i.tag?.subtype ? `\n    subtype: ${i.tag.subtype} (${i.tag.subtype_via})` : '');
  /** Hire / Commercial social posts by business subtype: "property 2 · product 1" (property / product / portrait / unspecified). */
  function subtypesOf(r) {
    const counts = {};
    for (const i of r.items.filter((x) => x.tag?.subtype)) counts[i.tag.subtype] = (counts[i.tag.subtype] || 0) + 1;
    return Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ');
  }
  function rowTip(r, m) {
    const head = `${r.label}: ${plural(r.n, 'item')} (Sched + Waiting), ${ukDay(m.win.from)} → ${ukDay(m.win.to)} · click → the schedule filtered to these items${compareLine(r, m.sm.thresholds)}`;
    const subs = r.key === 'hire' ? `\nSocial posts by subtype: ${subtypesOf(r) || 'none scheduled'} (property / product / portrait, from each post's stored subtype, links and title)` : '';
    const why = r.key === 'none' ? (i) => `\n    why: ${i.tag?.via || 'no tag'}` : (i) => `\n    via ${i.tag?.via || '—'}`;
    const lines = sortByDay(r.items).map((i) => `${itemLine(i)}${why(i)}${secondaryLine(i)}${subtypeLine(i)}`).join('\n');
    const drafts = r.drafts.length ? `\n\nDrafts (not counted): ${r.drafts.length}\n${sortByDay(r.drafts).map(itemLine).join('\n')}` : '';
    const fix = r.key === 'none' && r.n ? '\n\nTo fix: give the post a product link, store the campaign\'s Booking Sheet categories (strategy_campaigns.categories) or a target category on its initiative.' : '';
    return `${head}${subs}\n${lines || '(none)'}${drafts}${fix}`;
  }
  function targetTip(r, m) {
    if (r.key === 'gift_vouchers') {
      const g = m.sm.gift;
      return g ? `Gift vouchers are not in the monthly tier targets: they carry the separate ${gbpK(g.total)} ${ukDay(g.from)} → ${ukDay(g.to)} target ("${g.title}").` : 'Gift vouchers are not in the monthly tier targets.';
    }
    if (r.key === 'prints') return 'Prints & royalties have no tier target of their own: the Survival Cockpit counts them inside Hire / Commercial (Booking Sheet 10 + 11).';
    if (!r.target) return '';
    return `${r.target.label}: ${gbpK(r.target.monthly)} this month ÷ ${gbpK(m.targetTotal)} (the six Survival Cockpit tiers) = ${(r.target_share * 100).toFixed(1)}% · Booking Sheet ${r.target.categories.join(' + ')}`;
  }
  function titleTip(m) {
    const th = m.sm.thresholds;
    return `Scheduled + approved-waiting emails and posts, ${ukDay(m.win.from)} → ${ukDay(m.win.to)}: the same ${n(m.total)} items as "Next 12 weeks: by channel" (drafts in the row hover only, sent items not counted).\n`
      + `% of promotion = the tier's items ÷ the ${n(m.promoTotal)} service-specific items. % of target = the tier's monthly target ÷ the total of the six Survival Cockpit tiers (${gbpK(m.targetTotal)}).\n`
      + `Flags (on the percentages shown): gap = nothing scheduled · under-promoted = % of promotion at or below ${th.under}× the % of target (half or less) · well covered = above ${th.over}× · in line = between (${th.source}).\n`
      + `Tier per item: ${m.sm.basis}. An email with several modules counts once, under its primary tier; secondary modules are named in the hover.`;
  }

  /* ---------- render ---------- */

  const tierName = (r) => {
    const sub = [r.sub, r.key === 'hire' ? subtypesOf(r) : ''].filter(Boolean).join(' · ');
    return `${esc(r.label)}${sub ? ` <span class="mksv-m"${r.key === 'hire' ? ' data-mksv-subtypes' : ''}>(${esc(sub)})</span>` : ''}`;
  };
  function barHtml(r, max) {
    const seg = Object.entries(r.by).filter(([, v]) => v).map(([k, v]) => `<i class="${CH[k][1]}" style="width:${((v / max) * 100).toFixed(1)}%" title="${esc(`${k === 'email' ? 'Squarespace email' : k}: ${v}`)}"></i>`).join('');
    return `<div class="mksv-bar">${seg}</div>`;
  }
  const pctCell = (v) => (v == null ? '<td class="mksv-m">—</td>' : `<td>${v}%</td>`);
  function targetCell(r, m) {
    const tip = targetTip(r, m);
    if (r.target_pct == null) return `<td class="mksv-m" title="${esc(tip)}">${r.key === 'gift_vouchers' ? '—*' : '—'}</td>`;
    return `<td title="${esc(tip)}">${r.target_pct}%</td>`;
  }
  const flagHtml = (f) => (f ? `<span class="mksv-flag ${FLAG[f][1]}" data-mksv-flag="${f}">${FLAG[f][0]}</span>` : '');
  function rowAHtml(r, m, max) {
    const none = r.key === 'none';
    const cls = none ? ' class="mksv-m"' : '';
    return `<tr class="mksv-r${none ? ' mksv-none' : ''}" data-mksv-open="row:${r.key}" data-mksv-row="${r.key}" title="${esc(rowTip(r, m))}">`
      + `<td${cls}>${tierName(r)}</td><td class="left">${barHtml(r, max)}</td><td class="${r.n ? '' : 'z'}${none ? ' mksv-m' : ''}">${n(r.n)}</td>`
      + `${none ? '<td class="mksv-m">—</td>' : pctCell(r.promo_pct)}${none ? '<td class="mksv-m">—</td>' : targetCell(r, m)}<td>${flagHtml(r.flag)}</td></tr>`;
  }
  const keyHtml = () => `<div class="mksv-key">${(window.mkChannels?.ROWS || []).map(([k, l]) => `<span><b class="${CH[k]?.[1] || ''}"></b>${esc(l)}</span>`).join('')}</div>`;
  /** Bars share one scale: the largest service tier fills the bar (a longer "Not service-specific" bar is squeezed to fit). */
  function tileA(m) {
    const max = Math.max(1, ...m.rows.filter((r) => r.key !== 'none').map((r) => r.n));
    const rag = m.rows.some((r) => r.flag === 'gap' || r.flag === 'under') ? 'amber' : 'green';
    return `<div class="mko-tile mksv mksv-a r-${rag}" id="mk-service-a"><div class="mko-num">6c</div><div class="mko-title" title="${esc(titleTip(m))}">Next 12 weeks: what we're promoting, by service</div>`
      + '<div class="mksv-sub">Scheduled emails and posts per service tier, by channel · compared with each tier\'s share of the monthly sales target</div>'
      + `${keyHtml()}<table class="mksv-t"><thead><tr><th class="left">Service tier</th><th class="left">Items by channel</th><th>Items</th><th>% of promotion</th><th>% of target</th><th></th></tr></thead><tbody>${m.rows.map((r) => rowAHtml(r, m, max)).join('')}</tbody></table>`
      + `<div class="mko-src">% of target = tier monthly target ÷ total commercial target (Survival Cockpit). * Gift vouchers carry the separate ${m.sm.gift ? gbpK(m.sm.gift.total) : ''} Nov–Dec target. Flags: gap = nothing scheduled · under-promoted = share of promotion ${m.sm.thresholds.under}× share of target or less · well covered = more than ${m.sm.thresholds.over}×. Hover a row → items and dates; click → schedule filtered to that tier.</div></div>`;
  }
  function cellHtml(r, k) {
    const items = r.items.filter((i) => i.channel === k);
    const tip = items.length ? `${r.label} · ${CH[k][0]}: ${plural(items.length, 'item')} · click → these items in the schedule\n${sortByDay(items).map(itemLine).join('\n')}` : `${r.label} · ${CH[k][0]}: no coverage in the next 12 weeks`;
    return `<td class="${items.length ? '' : 'z'}" data-mksv-open="cell:${r.key}:${k}" data-mksv-cell="${r.key}:${k}" title="${esc(tip)}">${n(items.length)}</td>`;
  }
  function tileB(m) {
    const rows = m.rows.filter((r) => r.key !== 'none');
    const none = m.rows.find((r) => r.key === 'none');
    const gaps = rows.some((r) => Object.values(r.by).some((v) => !v));
    return `<div class="mko-tile mksv mksv-b r-${gaps ? 'amber' : 'green'}" id="mk-service-b"><div class="mko-num">6d</div><div class="mko-title" title="${esc(`Same items, tagging and window as tile 6c: each row total = that tier's Items there. ${titleTip(m)}`)}">Service × channel coverage</div>`
      + '<div class="mksv-sub">Count of scheduled items, next 12 weeks · amber 0 = no coverage on that channel</div>'
      + `<table class="mksv-t mksv-mx"><thead><tr><th class="left">Tier</th>${Object.values(CH).map(([h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
      + `${rows.map((r) => `<tr class="mksv-r" data-mksv-row="${r.key}"><td class="left">${esc(r.label)}</td>${Object.keys(CH).map((k) => cellHtml(r, k)).join('')}</tr>`).join('')}</tbody></table>`
      + `<div class="mko-src">Click a cell → those items. Same tagging and window as tile A, so the two always agree${none?.n ? ` · + ${plural(none.n, 'item')} not service-specific (tile A)` : ''}.</div></div>`;
  }
  const loadingTiles = (why) => ['a', 'b'].map((k, i) => `<div class="mko-tile mksv mksv-${k} r-grey" id="mk-service-${k}"><div class="mko-num">6${'cd'[i]}</div><div class="mko-title">${i ? 'Service × channel coverage' : 'Next 12 weeks: what we\'re promoting, by service'}</div><div class="mko-head"><span class="mko-loading">${esc(why)}</span></div></div>`).join('');

  let last = null;
  window.mkServiceMixTilesHtml = function mkServiceMixTilesHtml(s, board, today, nowMs = Date.now()) {
    if (!s) return loadingTiles('Loading…');
    const m = build(s, board, today, nowMs);
    last = m.missing ? null : m;
    return m.missing ? loadingTiles(m.missing) : tileA(m) + tileB(m);
  };
  /** A row ("row:<tier>") or a cell ("cell:<tier>:<channel>"): the schedule, filtered to exactly those items. */
  function refsFor(key) {
    const [kind, tier, ch] = key.split(':');
    const r = last?.rows.find((x) => x.key === tier);
    if (!r) return null;
    const items = kind === 'cell' ? r.items.filter((i) => i.channel === ch) : r.items;
    return { refs: [...new Set(items.map((i) => i.ref))], label: kind === 'cell' ? `${r.label} · ${CH[ch][0]}` : r.label };
  }
  window.mkServiceMixOpen = function mkServiceMixOpen(key) {
    const f = refsFor(key);
    if (!f) return false;
    if (typeof window.mkScheduleFilterRefs === 'function') window.mkScheduleFilterRefs(f.refs, f.label);
    document.getElementById('mk-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  };

  window.mkServiceMixStyle = `<style>
    .mksv { cursor: default; } .mksv:hover { background: #111827; } .mksv .mko-title { cursor: help; }
    .mksv-sub { color: #94a3b8; font-size: 0.76rem; margin: 0.1rem 0 0.4rem; }
    .mksv-t { width: 100%; border-collapse: collapse; font-size: 0.8rem; line-height: 1.25; }
    .mksv-t th { color: #94a3b8; font-weight: 400; text-align: right; padding: 3px 5px; border-bottom: 1px solid var(--dark-border); white-space: nowrap; }
    .mksv-t td { text-align: right; padding: 5px 5px; border-bottom: 1px solid #1f283a; color: #fff; vertical-align: middle; }
    .mksv-t th:first-child, .mksv-t td:first-child, .mksv-t .left { text-align: left; }
    .mksv-mx td { text-align: center; } .mksv-mx td:first-child { text-align: left; } .mksv-mx th { text-align: center; } .mksv-mx th:first-child { text-align: left; }
    .mksv-r { cursor: pointer; } .mksv-r:hover td { background: #142033; } .mksv-mx td[data-mksv-open] { cursor: pointer; }
    .mksv-t .z { color: #fbbf24; font-weight: 700; } .mksv-t .mksv-m, .mksv-m { color: #94a3b8; }
    .mksv-bar { display: flex; height: 14px; border-radius: 3px; overflow: hidden; width: 100%; min-width: 8rem; background: #10151f; }
    .mksv-bar i { display: block; height: 100%; }
    .mksv .em { background: #f0b429; } .mksv .fb { background: #6ea8fe; } .mksv .ig { background: #c79bf0; } .mksv .st { background: #e58ac0; } .mksv .li { background: #4fc3c7; } .mksv .gb { background: #5fd38d; } .mksv .yt { background: #ff8a65; }
    .mksv-key { display: flex; flex-wrap: wrap; gap: 0.6rem; font-size: 0.72rem; color: #aab2c0; margin: 0.2rem 0 0.3rem; }
    .mksv-key b { display: inline-block; width: 11px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
    .mksv-flag { font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
    .mksv-flag.none { background: #3a1d1d; color: #ff9b9b; } .mksv-flag.under { background: #2a2412; color: #f0b429; } .mksv-flag.ok { background: #132a1e; color: #5fd38d; } .mksv-flag.over { background: #132038; color: #6ea8fe; }
  </style>`;

  window.mkServiceMix = { build, pctOf, flagOf, refsFor, subtypesOf, compareLine };
})();
