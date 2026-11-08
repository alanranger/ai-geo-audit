/**
 * AR-social-v1 side-panel section and placement chips for the Marketing schedule (browser, read-only HTML).
 * Data from window.SocialStandard.panelFor (lib/social-standard/schedule-social.js). Exposes window.SocialPanel.
 * The only action is "Render" (queues the PC render job; the schedule's progress window polls the run).
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (v) => (v == null ? '—' : `£${Number(v).toLocaleString('en-GB')}`);
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '') : '');
  const ukDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const kv = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const link = (u) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/www\./, ''))}</a>` : '<span class="mks-amber">missing</span>');

  /** Placement chips on a card: one per placement, each with its own status (never inferred from another). */
  function chips(placements) {
    if (!placements?.length) return '';
    return `<span class="sps-chips">${placements.map((p) => `<span class="sps-chip st-${esc(p.stage)}" title="${esc(`${p.label}: ${p.stage_label}${p.in_app ? ' (planned in app)' : ''} · ${p.source}`)}">${esc(p.label)}</span>`).join('')}</span>`;
  }

  function seriesText(f) {
    if (!f.series) return '';
    return `first session ${esc(ukDate(f.series.first.date))}${f.series.later.length ? `; later sessions ${f.series.later.map((x) => esc(ukDate(x.date))).join(', ')}` : ''}`;
  }
  function priceText(f) {
    const claims = (f.price.claims || []).map((c) => `${esc(c.source)} ${gbp(c.gbp)}`).join(' · ');
    return `${gbp(f.price.live)} (live page)${claims ? ` · ${claims}` : ''}`;
  }
  function offerText(f) {
    const a = f.offer.approved;
    const parts = [f.offer.text ? esc(f.offer.text) : '', f.offer.code ? `code <b>${esc(f.offer.code)}</b>` : '', f.offer.deadline ? `book by ${esc(f.offer.deadline)}` : ''];
    const appr = a?.code || a?.note ? ` · approved offer: ${esc([a.note, a.code, a.ends ? `ends ${a.ends}` : ''].filter(Boolean).join(' · '))}` : '';
    return `${parts.filter(Boolean).join(' · ') || 'no offer'}${appr}`;
  }
  function factsHtml(f) {
    const rows = kv('Event', `${esc(f.display_title || f.title || f.event_id)}${f.title && f.display_title ? ` <span class="mks-dim">(${esc(f.title)})</span>` : ''}`)
      + kv('Event dates', `${esc(f.dates_text || '—')}${f.start_time ? ` · ${esc(f.start_time)}–${esc(f.end_time || '')}` : ''}`) + kv('Series', seriesText(f))
      + kv('Location', esc(f.location || '')) + kv('Outcome', esc(f.outcome || '')) + kv('Inclusions', esc(f.inclusions || ''))
      + kv('Price', priceText(f)) + kv('Offer', offerText(f))
      + kv('Availability', `${f.availability.sold_out ? '<b class="mks-red">sold out</b>' : `${f.availability.places_left ?? '—'} left (website)`} · checked ${esc(stamp(f.availability.checked_at))}`)
      + kv('Booking URL', link(f.booking_url)) + kv('Event page', link(f.event_url)) + kv('Original photo', f.photo_path ? esc(f.photo_path) : '');
    const problems = [...f.missing.map((m) => `<li>missing: ${esc(m)}</li>`), ...f.contradictions.map((m) => `<li class="sps-contra">${esc(m)}</li>`)].join('');
    return `<div class="sps-fact"><table class="mks-kv">${rows}</table>${problems ? `<ul class="sps-miss">${problems}</ul>` : '<p class="sps-ok">All required facts present.</p>'}</div>`;
  }
  function placementRow(p) {
    const ev = (p.evidence || [])[0];
    const prov = [p.provider_id ? `id ${esc(p.provider_id)}` : '', p.provider_url ? link(p.provider_url) : ''].filter(Boolean).join(' · ');
    return `<tr><td>${esc(p.label)}</td><td><span class="sps-chip st-${esc(p.stage)}">${esc(p.stage_label)}</span>${p.in_app ? ' <span class="mks-dim">planned in app</span>' : ''}</td>`
      + `<td>${prov || '<span class="mks-dim">—</span>'}</td><td>${esc(stamp(p.actual_at)) || '<span class="mks-dim">—</span>'}</td><td>${ev ? `${esc(ev.by || ev.kind || '')} ${esc(stamp(ev.at))}<br><span class="mks-dim">${esc(String(ev.text || '').slice(0, 140))}</span>` : '<span class="mks-dim">none</span>'}</td></tr>`;
  }
  function previewHtml(placements) {
    const imgs = [];
    for (const p of placements) for (const [fmt, a] of Object.entries(p.assets || {})) if (a?.url && !imgs.some((x) => x.fmt === fmt)) imgs.push({ fmt, url: a.url, a });
    if (!imgs.length) return '<p class="mks-dim">No rendered preview yet.</p>';
    return `<div class="sps-prev">${imgs.map((x) => `<figure><img src="${esc(x.url)}" alt="${esc(x.fmt)} preview"><figcaption>${esc(x.fmt)} ${x.a.width || ''}×${x.a.height || ''}${x.a.photo_check ? ` · photo ${esc(x.a.photo_check)}` : ''}</figcaption></figure>`).join('')}</div>`;
  }
  function linksHtml(l, placements) {
    const has = (p) => placements.some((x) => x.placement === p);
    return `<table class="mks-kv">${has('facebook_feed') ? kv('FB first comment', link(l.facebook_first_comment)) : ''}${has('instagram_feed') ? kv('IG written URL', `${link(l.instagram_written)}${l.instagram_written_in_caption ? '' : ' <span class="mks-amber">not written in the caption yet</span>'}`) : ''}`
      + `${has('instagram_story') ? kv('IG Story sticker', link(l.story_sticker)) : ''}${has('linkedin_feed') ? kv('LinkedIn body link', `${link(l.linkedin_body)}${l.linkedin_in_body ? '' : ' <span class="mks-amber">not in the body yet</span>'}`) : ''}</table>`;
  }
  const readinessHtml = (list) => `<ul class="sps-ready">${list.map((r) => `<li class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'} ${esc(r.label)}${r.detail.length ? `<br><span class="mks-dim">${r.detail.map(esc).join('<br>')}</span>` : ''}</li>`).join('')}</ul>`;
  function renderHtml(facts, stepKey) {
    const f = facts.find((r) => r.photo_path) || facts[0];
    if (!f) return '';
    return `<div class="mks-ctl"><button type="button" class="rf-btn rf-btn-secondary" data-mks-render="${esc(f.event_id)}" data-mks-render-step="${esc(stepKey)}">Render ${esc(f.display_title || f.event_id)} (feed, Story, LinkedIn)</button> <span class="mks-dim">runs on Alan's PC within 5 min; the original photo is embedded unchanged</span><div id="mks-render-prog"></div></div>`;
  }

  const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');
  /** Planned time and purpose: the stored structured fields, or a visible "needs time / purpose". */
  function planHtml(p) {
    const when = p.plan ? `${esc(stamp(p.plan.planned_at))} <span class="mks-dim">(${esc(p.plan.planned_tz)} · ${esc(p.plan.source)})</span>` : '<span class="mks-amber">needs time</span> <span class="mks-dim">(no planned time stored)</span>';
    const pur = p.purpose?.primary ? `${esc([p.purpose.primary, ...p.purpose.secondary].map(cap).join(' + '))} <span class="mks-dim">(${p.purpose.source === 'stored' ? 'stored' : 'channel rule'})</span>` : '';
    const purpose = p.purpose?.source === 'stored' ? pur || 'stored' : `${pur} <span class="mks-amber">needs purpose</span>`;
    return `<table class="mks-kv">${kv('Planned', when)}${kv('Purpose', purpose)}</table>`;
  }

  /** The social section of a card's side panel. */
  function html(p, stepKey) {
    const quota = p.quota && p.placements.some((x) => x.placement === 'facebook_feed') ? `<p class="${p.quota.exhausted ? 'mks-amber' : 'mks-dim'}">Facebook caption links this month: ${p.quota.used} of ${p.quota.limit} used${p.quota.exhausted ? ': put the booking link in the first comment' : ''} · ${esc(p.quota.basis)}</p>` : '';
    return `<div class="sps"><h5>Plan</h5>${planHtml(p)}<h5>Readiness</h5>${readinessHtml(p.readiness)}${quota}`
      + `<h5>Placements (each with its own status)</h5><table class="sps-pl"><tr><th>Placement</th><th>Status</th><th>Provider</th><th>Actual</th><th>Evidence</th></tr>${p.placements.map(placementRow).join('')}</table>`
      + `<h5>Event facts</h5>${p.facts.length ? p.facts.map(factsHtml).join('') : '<p class="mks-amber">No event facts record linked to this post (education / nurture posts may not need one).</p>'}`
      + `${p.coverage.length ? `<p class="mks-dim">Event cards in this post: ${p.coverage.map(esc).join(' · ')}</p>` : ''}`
      + `<h5>Rendered preview</h5>${previewHtml(p.placements)}${renderHtml(p.facts, stepKey)}`
      + `<h5>Final caption</h5>${p.caption ? `<pre class="sps-cap">${esc(p.caption)}</pre>` : '<p class="mks-amber">No final caption yet.</p>'}`
      + `<h5>Links</h5>${linksHtml(p.links, p.placements)}</div>`;
  }

  const CSS = `
  .sps h5 { margin: 10px 0 4px; color: #fff; font-size: 12.5px; }
  .sps-chips { display: inline-flex; flex-wrap: wrap; gap: 2px; margin-left: 2px; }
  .sps-chip { font-size: 9.5px; padding: 0 3px; border-radius: 3px; border: 1px dashed #8b93a3; color: #cbd5e1; white-space: nowrap; }
  .sps-chip.st-factual_review, .sps-chip.st-preview_review { border-color: #a78bfa; color: #ddd6fe; }
  .sps-chip.st-platform_draft { border-style: solid; border-color: #94a3b8; }
  .sps-chip.st-scheduled { border: 1px solid #6ea8fe; background: #132038; color: #bfdbfe; }
  .sps-chip.st-published, .sps-chip.st-live_check, .sps-chip.st-measured { border: 1px solid #5fd38d; background: #11251a; color: #bbf7d0; }
  .sps-chip.st-skipped { text-decoration: line-through; opacity: 0.7; }
  .sps-pl { width: 100%; border-collapse: collapse; font-size: 11.5px; } .sps-pl th, .sps-pl td { border-bottom: 1px solid #263045; padding: 3px 4px; text-align: left; vertical-align: top; } .sps-pl th { color: #8b93a3; font-weight: 400; }
  .sps-fact { border: 1px solid #263045; border-radius: 6px; padding: 6px 8px; margin: 4px 0 6px; }
  .sps-miss { margin: 4px 0 0; padding-left: 18px; color: #fde68a; font-size: 12px; } .sps-miss .sps-contra { color: #fca5a5; } .sps-ok { color: #86efac; font-size: 12px; margin: 4px 0 0; }
  .sps-ready { list-style: none; padding: 0; margin: 0; font-size: 12px; } .sps-ready .ok { color: #86efac; } .sps-ready .no { color: #fde68a; }
  .sps-cap { white-space: pre-wrap; background: #0f131b; border: 1px solid #334155; border-radius: 6px; padding: 6px 8px; font-size: 12px; color: #e5e7eb; max-height: 260px; overflow: auto; }
  .sps-prev { display: flex; gap: 6px; flex-wrap: wrap; } .sps-prev figure { margin: 0; width: 31%; } .sps-prev img { width: 100%; border: 1px solid #334155; border-radius: 4px; } .sps-prev figcaption { font-size: 10.5px; color: #8b93a3; }
  `;
  if (typeof document !== 'undefined' && document.head && !document.getElementById('sps-style')) {
    const st = document.createElement('style');
    st.id = 'sps-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  window.SocialPanel = { html, chips };
})();
