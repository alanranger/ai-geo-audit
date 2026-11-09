/**
 * Strategy & Actions → Quarter plan (replaces the Q1–Q4 task cards in the same place). Reads summary.quarter_plan
 * (lib/strategy-initiatives.mjs): quarters reference initiatives; each initiative opens its campaigns, deliveries,
 * assets and tasks (quarter actions, ticked through window.stTickAction). Marketing campaign records and campaign steps
 * show their initiative with window.stInitiativePill(refType, key). Edits POST /api/aigeo/strategy-initiatives (admin
 * key). Nothing is sent, scheduled or published from here.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PURPOSES = ['sell', 'educate', 'inspire', 'nurture'];
  const PLABEL = { sell: 'Sell', educate: 'Educate', inspire: 'Inspire', nurture: 'Nurture' };
  const OWNERS = ['Claude', 'GPT', 'Alan'];
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (n) => (n == null ? '—' : `£${Math.round(Number(n)).toLocaleString('en-GB')}`);
  const utc = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const dm = (iso) => (iso ? `${utc(iso).getUTCDate()} ${MON[utc(iso).getUTCMonth()]}` : '—');
  const dmy = (iso) => (iso ? `${dm(iso)} ${String(iso).slice(0, 4)}` : '—');
  const wdm = (iso) => (iso ? `${utc(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${dm(iso)}` : '—');
  const stamp = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '');
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const data = () => (window.stLastData ? window.stLastData() : null);
  const planOf = (d) => (d?.quarter_plan && !d.quarter_plan.error ? d.quarter_plan : null);
  const openState = { inis: new Set(), quarters: new Set() };
  const rendered = new Set();
  let liveActions = new Map();
  /** Tick state from the summary's action rows (updated in place by window.stTickAction), not the plan snapshot. */
  function live(a) {
    const r = liveActions.get(String(a.id));
    return r ? { ...a, is_ticked: !!r.is_ticked, ticked_at: r.ticked_at || null, due: String(r.due_week_start || a.due || '').slice(0, 10), label: r.label || a.label, evidence: r.evidence || null } : a;
  }

  const CSS = `
    .qp-wrap{container-type:inline-size}
    .qp-intro{font-size:.78rem;color:#94a3b8;margin:.1rem 0 .6rem;line-height:1.35}
    .qp-grid{display:grid;gap:.6rem;align-items:start;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,.58fr) minmax(0,.58fr)}
    @container (max-width:1100px){.qp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @container (max-width:640px){.qp-grid{grid-template-columns:1fr}}
    .qp-card{background:#0f1622;border:1px solid #1f2937;border-radius:8px;padding:.7rem .75rem;font-size:.8rem;line-height:1.35;min-width:0}
    .qp-card.is-current{border-color:#f59e0b}
    .qp-h{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:0}
    .qp-h b{font-size:1.02rem;color:#f8fafc}
    .qp-badge{font-size:.62rem;font-weight:800;letter-spacing:.04em;padding:.1rem .4rem;border-radius:4px;background:#78350f;color:#fde68a;text-transform:uppercase}
    .qp-badge.next{background:#1e3a8a;color:#bfdbfe}
    .qp-dates{color:#94a3b8;font-size:.72rem;margin:.1rem 0 .35rem}
    .qp-theme{margin:.2rem 0 .5rem}.qp-theme b{color:#f59e0b}
    .qp-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem;margin-bottom:.55rem}
    .qp-kpi{background:#0b1118;border:1px solid #1f2937;border-radius:6px;padding:.35rem .45rem;min-width:0}
    .qp-kl{font-size:.66rem;color:#94a3b8}.qp-kv{font-size:1.05rem;font-weight:800;color:#f8fafc}.qp-ks{font-size:.64rem;color:#94a3b8;overflow-wrap:anywhere}
    .qp-gp{color:#cbd5e1}
    .qp-ini{border-top:1px solid #1f2937;padding:.45rem 0 .35rem}
    .qp-ini.qp-flash{background:rgba(245,158,11,.12)}
    .qp-ih{display:flex;justify-content:space-between;gap:.4rem;align-items:baseline}
    .qp-it{background:none;border:0;padding:0;color:#f8fafc;font-weight:700;font-size:.84rem;text-align:left;cursor:pointer}
    .qp-it:hover{text-decoration:underline}
    .qp-chip{flex:none;font-size:.6rem;font-weight:800;letter-spacing:.03em;padding:.08rem .35rem;border-radius:4px;text-transform:uppercase;white-space:nowrap}
    .qp-chip.grey{background:#1e293b;color:#cbd5e1}.qp-chip.green{background:#14532d;color:#bbf7d0}.qp-chip.amber{background:#78350f;color:#fde68a}.qp-chip.red{background:#7f1d1d;color:#fecaca}
    .qp-p{color:#cbd5e1;margin:.15rem 0}.qp-m{color:#94a3b8;font-size:.72rem;margin:.12rem 0}
    .qp-m b{color:#e5e7eb;font-weight:600}
    .qp-target{background:#0b1118;border:1px solid #1f2937;border-radius:6px;padding:.3rem .45rem;margin:.25rem 0;font-size:.72rem}
    .qp-target .ok{color:#fbbf24;font-weight:700}.qp-ref{color:#94a3b8}
    .qp-meta{color:#cbd5e1;font-size:.72rem;margin:.2rem 0}
    .qp-late{color:#fbbf24}
    .qp-links{margin:.2rem 0 0}.qp-links>summary{cursor:pointer;color:#93c5fd;font-size:.72rem}
    .qp-sub{margin:.3rem 0 .1rem;font-size:.68rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
    .qp-row{font-size:.72rem;padding:.12rem 0;border-bottom:1px dashed #1f2937;display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
    .qp-row select,.qp-edit input,.qp-edit select,.qp-edit textarea{font-size:.7rem;background:#0b1118;color:#e5e7eb;border:1px solid #334155;border-radius:4px}
    .qp-tag{font-size:.6rem;padding:0 .3rem;border-radius:3px;background:#1e293b;color:#cbd5e1}
    .qp-prog{border:1px solid #334155;border-radius:6px;padding:.4rem .5rem;margin:.45rem 0;background:#0b1118}
    .qp-hk{color:#94a3b8;font-size:.72rem;margin-top:.4rem}.qp-hk summary{cursor:pointer}
    .qp-compact>summary{list-style:none;cursor:pointer}.qp-compact>summary::-webkit-details-marker{display:none}
    .qp-more{color:#93c5fd;font-size:.72rem}
    .qp-edit{margin:.25rem 0}.qp-edit>summary{cursor:pointer;color:#93c5fd;font-size:.7rem}
    .qp-edit label{display:block;font-size:.68rem;color:#94a3b8;margin:.2rem 0}.qp-edit textarea{width:100%}
    .qp-foot{font-size:.68rem;color:#94a3b8;margin-top:.6rem;border-top:1px dashed #334155;padding-top:.4rem}
    .st-ini-line{font-size:.7rem;color:#94a3b8;margin-top:.15rem}
    .st-ini-pill{color:#fbbf24 !important;text-decoration:underline}
    .qp-pur{font-size:.6rem;padding:0 .3rem;border-radius:3px;background:#1e293b;color:#cbd5e1;margin-left:.25rem}
    .qp-ini{position:relative}.qp-ini > .qp-ih{padding-right:4.6rem}
    .qp-ini > .qp-links{margin:0;border:0;padding:0}
    .qp-ini > .qp-links > summary{position:absolute;top:.45rem;right:0;font-size:.7rem;color:#93c5fd;cursor:pointer;list-style:none;white-space:nowrap}
    .qp-ini > .qp-links > summary::-webkit-details-marker{display:none}
    .qp-ini > .qp-links[open]{margin-top:.35rem;border-top:1px dashed #334155;padding-top:.3rem}
    .qp-l{font-size:.74rem;color:#cbd5e1;margin:.1rem 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .qp-det{margin-bottom:.35rem}.qp-info{cursor:help;font-size:.8rem;color:#94a3b8;font-weight:400}
    .qp-ini > .qp-ih .qp-it{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qp-ini > .qp-ih .qp-chip{flex-shrink:0}
    .qp-compact summary .qp-p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`;
  function ensureCss() {
    if (document.getElementById('qp-css')) return;
    const el = document.createElement('style');
    el.id = 'qp-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /* ---------- small pieces ---------- */

  const chip = (s) => (s ? `<span class="qp-chip ${esc(s.rag || 'grey')}" title="${esc([s.reason, s.benchmark && `benchmark: ${s.benchmark}`].filter(Boolean).join(' · '))}">${esc(s.label)}</span>` : '');
  /**
   * "Sales still needed · Nov + Dec": the months this forward figure covers, so it reads apart from the Q1 card's
   * "Q1 Oct–Dec incl. October shortfall" figure. The months come from the box's own breakdown; targets are unchanged.
   */
  const MONTH_PART = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) £/g;
  function kpiLabel(k) {
    if (k.key !== 'sales' || !/still needed/.test(k.label || '')) return k.label;
    const months = [...String(k.sub || '').matchAll(MONTH_PART)].map((m) => m[1]);
    return months.length ? `${k.label} · ${months.join(' + ')}` : k.label;
  }
  function kpiHtml(k) {
    return `<div class="qp-kpi" title="${esc(k.window || '')}"><div class="qp-kl">${esc(kpiLabel(k))}</div><div class="qp-kv">${esc(k.value)}</div><div class="qp-ks">${esc(k.sub || '')}</div>${k.gp ? `<div class="qp-ks qp-gp" title="${esc(k.gp.basis || '')}">${esc(k.gp.line)}</div>` : ''}</div>`;
  }
  const purposeTxt = (p) => (p ? `${PLABEL[p.primary]}${p.secondary?.length ? ` + ${p.secondary.map((x) => PLABEL[x]).join(', ')}` : ''}` : '');
  /** Evidence lines: label + value on the card, the window / source as hover text. */
  function linesHtml(lines) {
    return lines?.length ? `<div class="qp-m">${lines.map((l) => `<span title="${esc(l.sub || '')}">${esc(l.label)}: <b>${esc(l.value)}</b></span>`).join(' · ')}</div>` : '';
  }
  function giftActual(l) {
    if (l.actual != null) return `${esc(l.label.toLowerCase())} ${gbp(l.actual)}${l.units != null ? ` (${l.units})` : ''}${l.gap != null ? `, gap ${gbp(l.gap)}` : ''}`;
    return `${esc(l.label.toLowerCase())} unknown${l.tagged != null ? ` (at least ${gbp(l.tagged)} tagged)` : ''} — ${esc(l.evidence_basis)}`;
  }
  function baselineTxt(b) {
    return `${esc(b.label)}: ${(b.values || []).slice().reverse().map((v) => `${v.year} ${gbp(v.amount)}${v.units != null ? ` (${v.units})` : ''}`).join(' · ')} <i>(${esc(b.note)})</i>`;
  }
  function targetHtml(m) {
    if (m?.kind !== 'gift' || !m.target_total) return '';
    const a = m.approved;
    const lines = m.target_lines || [];
    const stretch = m.stretch?.lines?.length ? `<div class="qp-ref">${esc(m.stretch.label)}: ${m.stretch.lines.map((l) => gbp(l.amount)).join(' + ')}</div>` : '';
    return `<div class="qp-target"><span class="ok">Approved base target ${gbp(m.target_total)}</span>, ${dmy(m.window?.start)} – ${dmy(m.window?.end)}: ${lines.map((l) => `${esc(l.label.toLowerCase())} ${gbp(l.amount)}`).join(' + ')}`
      + `${a ? ` <span class="qp-ref">· approved by ${esc(a.by)}, ${esc(stamp(a.at))}</span>` : ''}`
      + `<div>Actual so far: ${lines.map(giftActual).join(' · ')}</div>${stretch}`
      + `<div class="qp-ref">Context only: ${(m.baselines || []).map(baselineTxt).join(' · ')}</div></div>`;
  }
  const NEXT_SRC = { plan: 'from the plan', recommended: 'recommended (plan rule, not a delivery yet)', manual: 'manual (nothing linked still to come)' };
  /** The shared delivery status line from the server ("🕒 Scheduled Tue 10 Nov 10:00am"); red / amber tones stand out. */
  const stHtml = (nx) => `<span class="${['red', 'amber'].includes(nx.status?.tone) ? 'qp-late' : ''}" data-status="${esc(nx.status?.code || '')}">${esc(nx.status_line)}</span>`;
  /** The title follows the actual delivery status: never "draft" once the platform has it or Alan approved it. */
  const NOT_DRAFT = new Set(['scheduled', 'checking', 'late', 'published', 'sent', 'done', 'waiting_window', 'on_hold']);
  const nextText = (nx) => (NOT_DRAFT.has(nx?.status?.code) || nx?.status?.approved ? String(nx.text || '').replace(/ draft: /, ': ') : nx?.text);
  /** Next action from the server (linked deliveries first; stored text only as "manual"). */
  function nextHtml(ini) {
    const nx = ini.next || (ini.next_action ? { source: 'manual', text: ini.next_action, day: ini.next_action_date } : null);
    if (!nx) return 'next: —';
    const late = nx.day && nx.day < todayIso();
    const then = nx.then ? ` <span class="qp-ref">then ${esc(nextText(nx.then))}${nx.then.status_line ? ` · ${esc(nx.then.status_line)}` : ` ${esc(dm(nx.then.day))}`}</span>` : '';
    const when = nx.status_line ? stHtml(nx) : `<span class="${late ? 'qp-late' : ''}">${esc(dm(nx.day))}</span>`;
    return `next: ${esc(nextText(nx))} · ${when} <span class="qp-ref">(${esc(NEXT_SRC[nx.source] || nx.source)})</span>${then}`;
  }
  function unknownHtml(u) {
    return u ? ` · <span class="qp-ref" title="no target is invented">target unknown: owner ${esc(u.owner)} · next step ${esc(u.next_step)}${u.due ? ` · due ${esc(dm(u.due))}` : ''}</span>` : '';
  }
  /** Revenue target / actual / gap (server revenueOf): only where a revenue target exists, else "—" with the owner. */
  function revenueHtml(r) {
    if (!r) return '';
    if (r.target == null) return `<div class="qp-meta qp-rev">Revenue: ${r.proposal_line ? esc(r.proposal_line) : 'target —'} · actual — · gap — <span class="qp-ref">(no revenue target yet · owner ${esc(r.owner)})</span></div>`;
    const part = r.actual_complete ? '' : ' at least';
    const unk = r.unknown?.length ? ` <span class="qp-ref" title="unknown is not £0">(${esc(r.unknown.join(', '))} unknown)</span>` : '';
    return `<div class="qp-meta qp-rev">Revenue: target <b>${gbp(r.target)}</b> · actual${part} <b>${gbp(r.actual)}</b> · gap${r.actual_complete ? '' : ' at most'} <b>${gbp(r.gap)}</b>${r.window?.end ? ` <span class="qp-ref">by ${esc(dmy(r.window.end))}</span>` : ''}${unk}</div>`;
  }
  function metaHtml(ini) {
    return `${revenueHtml(ini.revenue)}<div class="qp-meta">${ini.delivery_plan ? `▸ ${esc(ini.delivery_plan)} · ` : ''}owner ${esc(ini.owner_detail || ini.owner)} · ${nextHtml(ini)} · review <span class="${ini.review_overdue ? 'qp-late' : ''}">${esc(dm(ini.review_date))}</span>${unknownHtml(ini.unknown_target)}</div>`;
  }
  /* ---------- the three visible lines (correction 2): title + chip · Target / Actual / Gap · Next ---------- */

  const gbpK = (n) => (Math.abs(n) >= 1000 ? `£${(Math.round(Math.abs(n) / 100) / 10).toLocaleString('en-GB')}k` : `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`);
  const UNIT = { plans: ['plan', 'plans'], beginners: ['beginner', 'beginners'] };
  /** A roadmap KPI amount in its unit: "3 plans", "17 beginners", "£16k" (the KPI box's own format). */
  function kpiAmount(v, unit, withUnit) {
    if (v == null) return '—';
    if (unit === 'gbp') return gbpK(v);
    const u = UNIT[unit];
    return withUnit && u ? `${v} ${Number(v) === 1 ? u[0] : u[1]}` : String(v);
  }
  /** "Target 3 plans · Actual 0 · Gap 3 (by 31 Dec)": the same roadmap target and actual as the quarter card's KPI box. */
  function kpiLine(r) {
    const also = r.also?.length ? ` · also: ${r.also.join(', ')}` : '';
    const tip = `${r.label} · ${r.milestone || ''} milestone (Targets panel roadmap)${also}`;
    return `<div class="qp-l" title="${esc(tip)}">Target <b>${kpiAmount(r.target, r.unit, true)}</b> · Actual <b>${kpiAmount(r.actual, r.unit)}</b> · Gap <b>${kpiAmount(r.gap, r.unit)}</b>${r.window?.end ? ` <span class="qp-ref">(by ${esc(dm(r.window.end))})</span>` : ''}</div>`;
  }
  /** "Target £2,100 · Actual ≥ £0 · Gap ≤ £2,100", a roadmap KPI line, or "—" with the owner where no target exists. */
  function moneyLine(r) {
    if (r?.kind === 'kpi') return kpiLine(r);
    if (r?.proposal_line) return `<div class="qp-l" title="no dated target yet: the owner proposes one from actuals for Alan to approve">${esc(r.proposal_line)} · Actual — · Gap —</div>`;
    if (!r || r.target == null) return `<div class="qp-l" title="no revenue target set">Target — · Actual — · Gap — <span class="qp-ref">· owner ${esc(r?.owner || '—')}</span></div>`;
    const ge = r.actual_complete ? '' : '≥ ';
    const le = r.actual_complete ? '' : '≤ ';
    const tip = `${r.unknown?.length ? `${r.unknown.join(', ')} unknown (not £0)` : 'all actuals known'}${r.window?.end ? ` · by ${dmy(r.window.end)}` : ''}`;
    return `<div class="qp-l" title="${esc(tip)}">Target <b>${gbp(r.target)}</b> · Actual <b>${ge}${gbp(r.actual)}</b> · Gap <b>${le}${gbp(r.gap)}</b></div>`;
  }
  /** "Next: {delivery} · {date} → Marketing" from the linked deliveries (stored text only when nothing is linked). */
  function nextLine(ini) {
    const nx = ini.next || (ini.next_action ? { source: 'manual', text: ini.next_action, day: ini.next_action_date } : null);
    if (!nx) return '<div class="qp-l">Next: —</div>';
    const late = nx.day && nx.day < todayIso();
    const link = nx.source === 'manual' ? ` <span class="qp-ref">(${nx.data_source ? `data: ${esc(nx.data_source)}` : 'manual'})</span>` : ` ${onMarketing.replace('→ on Marketing', '→ Marketing')}`;
    const when = nx.status_line ? stHtml(nx) : `<span class="${late ? 'qp-late' : ''}">${esc(wdm(nx.day))}</span>`;
    return `<div class="qp-l" title="${esc(`${nextText(nx)} · ${nx.status?.evidence || nx.status?.blocker || NEXT_SRC[nx.source] || nx.source}`)}">Next: ${esc(nextText(nx))} · ${when}${link}</div>`;
  }

  /* ---------- linked records ---------- */

  function allDeliveries(p) {
    return Object.values(p.initiatives).flatMap((i) => i.deliveries || []);
  }
  function deliveryState(d) {
    if (!d) return '';
    if (d.reserved_sends != null || d.scheduled_for) {
      const when = d.scheduled_for ? new Date(d.scheduled_for).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '') : wdm(d.day);
      return d.sent ? `sent ${wdm(d.day)} · ${d.actual_sends ?? '?'} sends` : `${esc(d.status)} ${esc(when)} · ${d.reserved_sends ?? d.recipients ?? '?'} sends reserved · not sent`;
    }
    return `${esc(String(d.status).replace(/_/g, ' '))}`;
  }
  function taskState(a) {
    if (a.evidence) return a.evidence.state === 'done' ? `done from evidence ${a.ticked_at ? dm(a.ticked_at) : ''}` : `waiting for evidence: ${esc(a.evidence.label)}`;
    if (a.is_ticked) return `ticked ${a.ticked_at ? dm(a.ticked_at) : ''}`;
    return a.status === 'waiting' ? `waiting on ${esc(a.waiting_on || 'a trigger')}` : `due ${dm(a.due)}`;
  }
  /** Evidence-ruled tasks tick themselves (lib/strategy-action-evidence.mjs): no hand checkbox. */
  function tickControl(a) {
    if (a.evidence) return `<span class="qp-tag" title="Ticks itself from evidence">${a.evidence.state === 'done' ? '✓ auto' : 'auto'}</span>`;
    return `<input type="checkbox" class="qp-tick" data-id="${esc(a.id)}" ${a.is_ticked ? 'checked' : ''} aria-label="Done">`;
  }
  function actionRow(row, p) {
    const a = live(row);
    const late = !a.is_ticked && !a.evidence && a.status !== 'waiting' && a.due && a.due < todayIso();
    const rel = a.related_ref ? allDeliveries(p).find((d) => d.key === a.related_ref) : null;
    return `<div class="qp-row">${tickControl(a)} ${esc(a.label)} <span class="qp-tag${late ? ' qp-late' : ''}">${late ? 'past due' : taskState(a)}</span>${rel ? ` <span class="qp-tag">delivery: ${deliveryState(rel)}</span>` : ''}</div>`;
  }
  function purposeSelect(d) {
    const opts = PURPOSES.map((x) => `<option value="${x}" ${d.purpose?.primary === x ? 'selected' : ''}>${PLABEL[x]}</option>`).join('');
    return `<select class="qp-purpose" data-ref="${esc(d.alias || d.key)}" data-ini="${esc(d.initiative_key)}" aria-label="Primary purpose">${opts}</select>${d.purpose_source === 'rule' ? ' <span class="qp-tag">rule</span>' : ''}`;
  }
  /** The delivery itself lives on Marketing's schedule: a link, never a copy. */
  const onMarketing = '<a href="#marketing" class="qp-mk" data-goto-marketing title="Open it on the Marketing schedule">→ on Marketing</a>';
  function deliveryRow(d) {
    return `<div class="qp-row">${esc(wdm(d.day))} · ${esc(d.channel)} · ${esc(d.title)} <span class="qp-tag">${deliveryState(d)}</span> ${purposeSelect(d)}${(d.assets || []).length ? ` <span class="qp-tag">assets: ${d.assets.length}</span>` : ''} ${onMarketing}</div>`;
  }
  function moveSelect(c, p) {
    const opts = Object.values(p.initiatives).filter((i) => i.kind !== 'housekeeping').map((i) => `<option value="${esc(i.key)}" ${i.key === c.initiative_key ? 'selected' : ''}>${esc(i.title)}</option>`).join('');
    return `<select class="qp-move" data-ref="${esc(c.campaign_key)}" aria-label="Primary initiative">${opts}</select>`;
  }
  const KIND = { weekly_email: 'weekly email', event: 'event', theme: 'theme' };
  function campaignRow(c, p) {
    return `<div class="qp-row">${esc(c.title)} <span class="qp-tag">${esc(KIND[c.kind] || c.kind)} · ${esc(c.stage)}</span>${c.source === 'rule' ? ' <span class="qp-tag">rule</span>' : ''} ${moveSelect(c, p)}</div>`;
  }
  function assetRow(a) {
    const t = a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title);
    return `<div class="qp-row">${t} <span class="qp-tag">${esc(a.kind)} · ${esc(a.status)}${a.reuse ? ' · reuse' : ''}</span></div>`;
  }
  function editHtml(ini) {
    const own = OWNERS.map((o) => `<option ${o === ini.owner ? 'selected' : ''}>${o}</option>`).join('');
    const f = (name, label, value, type = 'text') => `<label>${label} <input type="${type}" data-f="${name}" value="${esc(value || '')}"></label>`;
    return `<details class="qp-edit"><summary>Edit</summary><div data-edit="${esc(ini.key)}">`
      + `<label>Owner <select data-f="owner">${own}</select></label>${f('owner_detail', 'Owner detail', ini.owner_detail)}`
      + `${f('next_action', 'Next action', ini.next_action)}${f('next_action_date', 'Next action date', ini.next_action_date, 'date')}${f('review_date', 'Review date', ini.review_date, 'date')}`
      + `${f('status_label', 'Status label (grey)', ini.status_label)}<label>Summary <textarea rows="3" data-f="summary">${esc(ini.summary || '')}</textarea></label>`
      + `<button type="button" class="rf-btn rf-btn-secondary qp-save" data-ini="${esc(ini.key)}">Save</button> <span class="rt-sub qp-save-status"></span></div></details>`;
  }
  function section(title, rows) {
    return rows.length ? `<div class="qp-sub">${title} (${rows.length})</div>${rows.join('')}` : '';
  }
  /** Everything that used to be visible (description, target detail, stretch, context, baselines, approval, GP, owner). */
  function detailsHtml(ini) {
    const m = ini.measure || {};
    return `<div class="qp-p">${esc(ini.summary || '')}</div>${targetHtml(m)}${linesHtml(m.lines)}${m.gp ? `<div class="qp-m">GP: ${esc(m.gp)}</div>` : ''}${metaHtml(ini)}`;
  }
  function linksHtml(ini, p) {
    const n = ini.campaigns.length + ini.deliveries.length + ini.actions.length;
    const open = openState.inis.has(ini.key) ? ' open' : '';
    const body = section('Campaigns', ini.campaigns.map((c) => campaignRow(c, p))) + section('Deliveries (next 4 weeks)', ini.deliveries.map(deliveryRow))
      + section('Content assets', ini.assets.map(assetRow)) + section('Tasks', ini.actions.map((a) => actionRow(a, p)));
    const why = ini.why_now ? `<div class="qp-m">Why now: ${esc(ini.why_now)}</div>` : '';
    const through = ini.measure?.data_through ? `<div class="qp-m">Evidence: Booking Sheet to ${esc(stamp(ini.measure.data_through))} · live diary, campaign records and Targets panel</div>` : '';
    return `<details class="qp-links" data-ini="${esc(ini.key)}"${open}><summary title="Details · campaigns, deliveries &amp; tasks">details ▾ <span class="qp-ref">${ini.campaigns.length} · ${ini.deliveries.length} · ${ini.actions.length}</span></summary><div class="qp-det">${detailsHtml(ini)}</div>${why}${through}${n || ini.assets.length ? body : '<div class="qp-m">Nothing linked yet.</div>'}${editHtml(ini)}</details>`;
  }

  /* ---------- initiative / programme / housekeeping ---------- */

  function anchor(key) {
    if (rendered.has(key)) return '';
    rendered.add(key);
    return ` id="qp-ini-${esc(key)}"`;
  }
  function initiativeHtml(ini, n, p) {
    return `<div class="qp-ini"${anchor(ini.key)}><div class="qp-ih"><button type="button" class="qp-it" data-ini-toggle="${esc(ini.key)}" title="${esc(ini.title)}">${n} · ${esc(ini.title)}</button>${chip(ini.status)}</div>`
      + `${moneyLine(ini.revenue)}${nextLine(ini)}${linksHtml(ini, p)}</div>`;
  }
  function programmeHtml(ini, p) {
    if (!ini) return '';
    return `<div class="qp-prog qp-ini"${anchor(ini.key)}><div class="qp-ih"><button type="button" class="qp-it" data-ini-toggle="${esc(ini.key)}" title="${esc(ini.title)}">${esc(ini.title)}</button>${chip(ini.status)}</div>${moneyLine(ini.revenue)}${nextLine(ini)}${linksHtml(ini, p)}</div>`;
  }
  function housekeepingHtml(q, p) {
    const hk = p.initiatives[q.housekeeping_key];
    const acts = (hk?.actions || []).filter((a) => a.quarter_key === q.key).map(live);
    if (!acts.length) return '<div class="qp-hk">Housekeeping: none this quarter.</div>';
    const done = acts.filter((a) => a.is_ticked).length;
    const open = openState.quarters.has(`hk|${q.key}`) ? ' open' : '';
    const names = acts.slice(0, 5).map((a) => esc(a.label.split(/[(:]/)[0].trim())).join(', ');
    return `<details class="qp-hk" data-hk="${esc(q.key)}"${open}><summary>Housekeeping (${done} of ${acts.length} done): ${names}${acts.length > 5 ? '…' : ''} <span class="qp-more">show</span></summary>${acts.map((a) => actionRow(a, p)).join('')}</details>`;
  }
  function fullBody(q, p) {
    const inis = q.initiative_keys.map((k) => p.initiatives[k]).filter(Boolean);
    return `<div class="qp-kpis">${q.kpis.map(kpiHtml).join('')}</div>${inis.map((i, n) => initiativeHtml(i, n + 1, p)).join('')}`
      + `${programmeHtml(p.initiatives[q.programme_key], p)}${housekeepingHtml(q, p)}`;
  }

  /* ---------- quarter cards ---------- */

  function badge(q, p) {
    if (q.state === 'current') return `<span class="qp-badge">Now · ${Math.max(0, Math.floor((Date.parse(`${q.end_date}T00:00:00Z`) - Date.parse(`${p.as_of}T00:00:00Z`)) / 6048e5))} weeks left</span>`;
    const next = p.quarters.find((x) => x.state === 'future');
    return next && next.key === q.key ? `<span class="qp-badge next">Next${q.selling_started ? ' · selling starts now' : ''}</span>` : '';
  }
  function headHtml(q, p) {
    return `<div class="qp-h"><b>${esc(q.label)}</b>${badge(q, p)}</div><div class="qp-dates">${esc(dmy(q.start_date).replace(/ \d{4}$/, ''))} – ${esc(dmy(q.end_date))} · ${esc(q.review_note || '')}</div>`
      + `<div class="qp-theme">Theme: <b>${esc(q.theme)}</b></div>`;
  }
  function compactLine(q, p) {
    const titles = q.initiative_keys.map((k) => p.initiatives[k]?.title).filter(Boolean).join(' · ');
    const ms = q.kpis.filter((k) => k.key === 'plans' || k.key === 'returning').map((k) => (k.key === 'plans' ? `Plans ${String(k.value).split(' ')[0]}` : `Returning ${k.value}`)).join(' · ');
    const text = `${titles}${ms ? ` · ${ms}` : ''}`;
    return `<div class="qp-p" title="${esc(text)}">${esc(text)}</div>`;
  }
  function quarterCard(q, p) {
    const cls = `qp-card${q.state === 'current' ? ' is-current' : ''}`;
    if (q.display === 'full') return `<div class="${cls}" data-q="${esc(q.key)}">${headHtml(q, p)}${fullBody(q, p)}</div>`;
    const open = openState.quarters.has(q.key) ? ' open' : '';
    return `<div class="${cls}" data-q="${esc(q.key)}"><details class="qp-compact" data-qc="${esc(q.key)}"${open}><summary>${headHtml(q, p)}${compactLine(q, p)}<span class="qp-more">expand ▾</span></summary>${fullBody(q, p)}</details></div>`;
  }
  const INTRO = 'Objective → initiative (with target, actual, gap, owner, next action, review date) → campaigns and channel deliveries (linked, not copied). Selling windows follow each product\'s lead time, so next quarter\'s initiatives can start now. One ongoing <b>Learning &amp; client relationships</b> programme runs through every quarter. RAG = against a dated target or pace, never because a task is unticked.';
  const FOOT = '<b>Records:</b> objective + KPI → initiative (can span quarters) → campaign → channel delivery → content asset, with stable IDs; one weekly email = one delivery even with several campaigns in it; revenue is attributed once, never summed across initiatives. <b>Roles:</b> Claude = actuals, targets, cause/effect insight · GPT = audiences, channels, content, timing · Alan = targets, offers, decisions · Cursor = builds. Measures are labelled by window (sales to a date; plans / beginners cumulative; returning £ rolling 12 months).';
  function mappingNote(p) {
    const m = p.action_mapping;
    if (!m) return '';
    const parts = Object.entries(m.by_quarter).map(([k, v]) => `${k.split('-')[0].toUpperCase()} ${v.mapped}/${v.old}`).join(' · ');
    return ` Quarter actions mapped (old → new): ${esc(parts)}${m.unmapped.length ? ` · <span class="qp-late">${m.unmapped.length} not mapped</span>` : ''}.`;
  }

  window.stQuarterPlanHtml = function stQuarterPlanHtml(d) {
    const p = planOf(d);
    if (!p || !p.quarters?.length) return null;
    ensureCss();
    rendered.clear();
    liveActions = new Map((d.actions || []).map((a) => [String(a.id), a]));
    const through = p.data_through ? ` Booking Sheet to ${esc(stamp(p.data_through))}.` : '';
    const info = `${INTRO} ${FOOT}${through}${mappingNote(p)}`.replace(/<[^>]+>/g, '');
    return `<h3>Quarter plan <span class="qp-info" title="${esc(info)}" tabindex="0" aria-label="How the quarter plan works">ⓘ</span></h3><div class="qp-wrap"><div class="qp-grid">${p.quarters.map((q) => quarterCard(q, p)).join('')}</div></div>`;
  };

  /** "Initiative: Pick n Mix plans & repeat clients" under a Marketing campaign record or campaign step. */
  function linkFor(p, refType, key) {
    if (refType !== 'action-id') return p?.links?.[`${refType}|${key}`];
    const a = (data()?.actions || []).find((x) => String(x.id) === String(key));
    const ik = a ? p?.action_initiative?.[a.action_key] : null;
    return ik ? { initiative_key: ik, title: p.initiatives[ik]?.title, source: 'set' } : null;
  }
  window.stInitiativePill = function stInitiativePill(refType, key) {
    const l = linkFor(planOf(data()), refType, key);
    if (!l?.initiative_key) return '';
    ensureCss();
    const pur = l.purpose ? `<span class="qp-pur" title="${l.purpose_source === 'rule' ? 'channel rule (no stored tag yet)' : 'stored tag'}">${esc(purposeTxt(l.purpose))}${l.purpose_source === 'rule' ? ' · rule' : ''}</span>` : '';
    return `<div class="st-ini-line">Initiative: <a href="#" class="st-ini-pill" data-ini-open="${esc(l.initiative_key)}">${esc(l.title || l.initiative_key)}</a>${l.source === 'rule' ? ' <span class="qp-tag">rule</span>' : ''}${pur}</div>`;
  };

  /* ---------- interaction ---------- */

  function openInitiative(key) {
    if (!document.querySelector('.aigeo-panel[data-panel="strategy"].is-active')) document.querySelector('.aigeo-nav-item[data-panel="strategy"]')?.click();
    let tries = 0;
    const go = () => {
      const el = document.getElementById(`qp-ini-${key}`);
      if (!el) { tries += 1; if (tries < 40) setTimeout(go, 250); return; }
      openState.inis.add(key);
      el.closest('details.qp-compact')?.setAttribute('open', '');
      el.querySelector('details.qp-links')?.setAttribute('open', '');
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('qp-flash');
      setTimeout(() => el.classList.remove('qp-flash'), 1800);
    };
    go();
  }
  async function post(body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) throw new Error('Not saved: no admin key in this browser (Configuration & Reporting → "Optimisation Tracking Security").');
    const r = await fetch('/api/aigeo/strategy-initiatives', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: JSON.stringify({ propertyUrl: PROP, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `Not saved (${r.status})`);
    return j;
  }
  async function saveInitiative(btn) {
    const box = btn.closest('[data-edit]');
    const status = box.querySelector('.qp-save-status');
    const body = { type: 'initiative', initiative_key: btn.dataset.ini };
    box.querySelectorAll('[data-f]').forEach((el) => { body[el.dataset.f] = el.value; });
    btn.disabled = true;
    try {
      status.textContent = 'Saving…';
      await post(body);
      status.textContent = 'Saved. Updating…';
      await window.stRefreshSummary?.();
    } catch (e) { status.textContent = e.message || String(e); btn.disabled = false; }
  }
  async function saveLink(el, body) {
    el.disabled = true;
    try { await post(body); await window.stRefreshSummary?.(); } catch (e) { el.disabled = false; el.insertAdjacentHTML('afterend', `<span class="st-err">${esc(e.message || String(e))}</span>`); }
  }
  async function tick(box) {
    if (typeof window.stTickAction !== 'function') return;
    box.disabled = true;
    try { await window.stTickAction(box.dataset.id, box.checked); } catch (_e) { box.checked = !box.checked; box.disabled = false; }
  }
  document.addEventListener('click', (e) => {
    const open = e.target.closest?.('[data-ini-open]');
    if (open) { e.preventDefault(); openInitiative(open.dataset.iniOpen); return; }
    const t = e.target.closest?.('[data-ini-toggle]');
    if (t) {
      const det = t.closest('.qp-ini, .qp-prog')?.querySelector('details.qp-links');
      if (det) det.open = !det.open;
      return;
    }
    const save = e.target.closest?.('.qp-save');
    if (save) saveInitiative(save);
  });
  document.addEventListener('change', (e) => {
    const box = e.target.closest?.('.qp-tick');
    if (box) { tick(box); return; }
    const pur = e.target.closest?.('.qp-purpose');
    if (pur) { saveLink(pur, { type: 'link', ref_type: 'delivery', ref_key: pur.dataset.ref, initiative_key: pur.dataset.ini, role: 'primary', purpose_primary: pur.value }); return; }
    const mv = e.target.closest?.('.qp-move');
    if (mv) saveLink(mv, { type: 'link', ref_type: 'campaign', ref_key: mv.dataset.ref, initiative_key: mv.value, role: 'primary' });
  });
  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLDetailsElement)) return;
    const key = el.dataset.ini || el.dataset.qc || (el.dataset.hk ? `hk|${el.dataset.hk}` : null);
    if (!key) return;
    const set = el.dataset.ini ? openState.inis : openState.quarters;
    if (el.open) set.add(key); else set.delete(key);
  }, true);
})();
