/**
 * Marketing & Campaigns → Overview: the 10 tiles at the top of the tab. Every figure is read from the same objects as
 * Strategy (strategy-summary insights, roadmap, quarter actions, campaign records) and the Marketing overview (meter,
 * identity, runs); nothing is copied or stored here. Tile 9's buyer split comes from the Client list health panel
 * (window.mkClientHealthSummary) when that script is loaded. Read-only: no tile sends, schedules or changes anything.
 */
(function () {
  const LONDON = 'Europe/London';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
  const ukDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const ukStamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }) : '—');
  const ukDayTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }).replace(',', '') : '—');
  const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;
  const gbpK = (v) => {
    if (v == null) return '—';
    const a = Math.abs(Number(v));
    const sign = Number(v) < 0 ? '−' : '';
    return a >= 1000 ? `${sign}£${(Math.round(a / 100) / 10).toLocaleString('en-GB')}k` : `${sign}£${Math.round(a).toLocaleString('en-GB')}`;
  };
  const cellTxt = (c) => (c && typeof c === 'object' ? (c.v ?? c.text) : c);
  const addDays = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
  const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : (many || `${one}s`)}`;
  function insightTile(s, key) {
    const r = s?.insights?.rows || {};
    return [...(r.money || []), ...(r.demand || []), ...(r.mix || [])].find((t) => t.key === key) || null;
  }

  function monthProgress(today, title) {
    const [y, m, d] = today.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const name = String(title || '').split('·')[1]?.trim() || new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    return { name, day: d, dim, left: dim - d };
  }
  /** Month-to-date sales against the straight-line pace of the month's target. */
  function ragPace(actual, pace) {
    if (actual >= pace) return 'green';
    return actual >= pace * 0.75 ? 'amber' : 'red';
  }

  const MONTH_KEY = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  /** Same rule as Strategy's returning tile: the next dated Roadmap milestone (e.g. "dec26" → by 31 Dec 2026). */
  function nextMilestone(roadmap, today) {
    return (roadmap || []).filter((r) => r.returning_r12 && /^[a-z]{3}\d{2}$/.test(r.key)).map((r) => {
      const by = new Date(Date.UTC(2000 + Number(r.key.slice(3)), MONTH_KEY[r.key.slice(0, 3)] + 1, 0)).toISOString().slice(0, 10);
      return { ...r, by };
    }).filter((r) => r.by >= today).sort((a, b) => a.by.localeCompare(b.by))[0] || null;
  }

  const unavailable = (num, title, why, go, goLabel) => ({ n: num, title, head: '<span class="mko-na">Not available</span>', lines: [esc(why)], src: 'Strategy summary', go, goLabel, rag: 'grey' });

  /* ---------- row A: the sales gap ---------- */

  function tileSalesNeeded(s) {
    const t = insightTile(s, 'money-next-3');
    if (!t?.numbers) return unavailable(1, 'Sales still needed', 'Strategy money figures not available', 'strategy', 'Strategy gap');
    const x = t.numbers;
    const m = insightTile(s, 'money-this-month');
    const lines = [esc(t.comparison || '')];
    let rag = 'grey';
    if (m?.numbers?.sales_target) {
      const mp = monthProgress(todayIso(), m.title);
      rag = ragPace(m.numbers.sales, (m.numbers.sales_target * mp.day) / mp.dim);
      lines.push(`${esc(mp.name)} so far: ${gbp(m.numbers.sales)} of ${gbp(m.numbers.sales_target)} (<span class="mko-t-${rag}">${n(m.numbers.of_target_pct)}%</span>, ${plural(mp.left, 'day')} left)`);
    }
    return { n: 1, title: 'Sales still needed', head: `${gbpK(x.required)} <span class="mko-unit">to ${ukDay(x.window_end)}</span>`, lines, src: `Targets panel · Booking Sheet to ${ukStamp(t.freshness)}`, go: 'strategy', goLabel: 'Strategy gap', rag };
  }

  function tileDated(s) {
    const t = insightTile(s, 'money-next-3');
    if (!t?.numbers) return unavailable(2, 'Dated places', 'Strategy money figures not available', 'diary', 'event breakdown');
    const x = t.numbers;
    const [pot, fc] = t.boxes || [];
    const events = /on (\d+) dated events?/.exec(pot?.sub || '')?.[1];
    const cover = /(\d+ of \d+ events)/.exec(fc?.sub || '')?.[1];
    return {
      n: 2, title: 'Dated places', badge: 'likely = estimate', rag: pot?.rag || 'grey', go: 'diary', goLabel: 'event breakdown',
      head: `${gbpK(x.potential)} potential <span class="mko-sep">/</span> ${gbpK(x.forecast)} likely`,
      lines: [`every unsold place at full price${events ? ` on ${events} dated events` : ''} to ${ukDay(x.window_end)} · likely = lead-time forecast, approved offers applied${cover ? ` (${esc(cover)})` : ''}`, `${gbpK(x.inHand)} already booked on these dates`],
      src: `diary + daily snapshots · Booking Sheet to ${ukStamp(t.freshness)}`
    };
  }

  function tileNonDated(s) {
    const t = insightTile(s, 'money-next-3');
    if (!t?.numbers) return unavailable(3, 'Non-dated sales needed', 'Strategy money figures not available', 'strategy', 'non-dated campaigns');
    const x = t.numbers;
    const ratio = (v) => (x.lyNonDated > 0 ? `${(v / x.lyNonDated).toFixed(1)}×` : '—');
    return {
      n: 3, title: 'Non-dated sales needed', rag: t.boxes?.[2]?.rag || 'grey', go: 'strategy', goLabel: 'non-dated campaigns',
      head: `${gbpK(x.nonDated)} <span class="mko-unit">if every dated place sells</span>`,
      lines: [`${gbpK(x.nonDatedIfForecast)} if only the forecast sells · <b>two alternatives, not added</b>`, `same 3 months last year ${gbpK(x.lyNonDated)} → need <span class="mko-t-${t.boxes?.[2]?.rag || 'grey'}">${ratio(x.nonDated)}</span> (or ${ratio(x.nonDatedIfForecast)})`],
      src: `Booking Sheet to ${ukStamp(t.freshness)}`
    };
  }

  /* ---------- row B: relationships and editorial balance ---------- */

  function milestoneLine(ms, now, yearTxt) {
    if (!ms) return 'no dated returning-sales milestone set (Targets panel)';
    const behind = ms.returning_r12 - now;
    const gap = behind > 0 ? `<span class="mko-t-red">${gbpK(behind)} behind</span>` : '<span class="mko-t-green">reached</span>';
    return `${esc(ms.label)} milestone ${gbpK(ms.returning_r12)} → ${gap}${yearTxt ? ` (year ${esc(yearTxt)})` : ''}`;
  }

  /**
   * The Strategy returning tile's table rows: milestone cell (RAG + "(year …)") and plan payments. Strategy hides the
   * plan-payments row at £0, so the Pick n Mix tile's "plan income last 12 months £X" (same planInfo.income_r12) is read then.
   */
  function returningRows(t, s) {
    const rows = t.table?.rows || [];
    const rowOf = (re) => rows.find((r) => re.test(String(cellTxt(r[0]))));
    const msCell = rowOf(/^Returning £/)?.[3];
    const plan = rowOf(/plan payments/);
    const pnm = /plan income last 12 months (−?£[\d.,]+k?)/.exec(insightTile(s, 'mix-pick-n-mix')?.comparison || '')?.[1];
    return { rag: msCell?.rag || 'grey', yearTxt: /\(year ([^)]+)\)/.exec(String(cellTxt(msCell) || ''))?.[1], plan: plan ? cellTxt(plan[2]) : (pnm || null) };
  }
  /** Plans sold since the relaunch (Strategy Pick n Mix tile: PnM Plans tab, Targets panel date) + plan payments not on the sheet. */
  function planLine(pay, s) {
    const x = insightTile(s, 'mix-pick-n-mix')?.numbers;
    const sold = x?.status_line ? `Pick n Mix: ${esc(x.status_line)}` : '';
    const paid = pay ? `+ ${esc(pay)} plan payments (12 m, not already on the Booking Sheet)` : '';
    return [sold, paid].filter(Boolean).join(' · ') || 'plan payments: not available (plan statements not read)';
  }

  function tileRepeat(s) {
    const t = insightTile(s, 'mix-returning');
    const now = s?.roadmap_now?.returning_r12;
    if (!t || now == null) return unavailable(4, 'Repeat clients', 'returning sales not available', 'segments', 'repeat-client segments');
    const r = returningRows(t, s);
    const ms = nextMilestone(s.roadmap || s.roadmap_targets, todayIso());
    const denom = /^\d+ of \d+/.exec(t.comparison || '')?.[0];
    return {
      n: 4, title: 'Repeat clients', rag: ms ? r.rag : 'grey', go: 'segments', goLabel: 'repeat-client segments',
      head: `${gbpK(now)} <span class="mko-unit">returning sales, rolling 12 months</span>`,
      lines: [milestoneLine(ms, now, r.yearTxt), `${esc(t.headline?.value)} came back since 2024${denom ? ` (${esc(denom)})` : ''}`, planLine(r.plan, s)],
      src: `Booking Sheet (incl. PnM Plans tab) + plan statements to ${ukStamp(t.freshness)}`
    };
  }

  /** Plain text: a change against an earlier period of the same year is a comparison, not a target or last year. */
  function deltaChip(c) {
    const v = String(cellTxt(c) ?? '');
    const arrow = v.startsWith('-') ? '▼' : '▲';
    return `${arrow}${esc(v.replace(/^[-+]/, ''))}`;
  }

  /** "free trials 15.0 a month ▼70% vs Jan–Mar · new paying 1.7 a month ▼64%" from the Strategy Academy table. */
  function academyLine(t) {
    const rows = t.table?.rows || [];
    const base = t.table?.cols?.[1] || 'the base period';
    const trial = rows.find((r) => /trial/i.test(String(cellTxt(r[0]))));
    const paid = rows.find((r) => /new paying/i.test(String(cellTxt(r[0]))));
    const parts = [trial ? `free trials ${esc(cellTxt(trial[2]))} a month ${deltaChip(trial[3])} vs ${esc(base)}` : '', paid ? `new paying ${esc(cellTxt(paid[2]))} a month ${deltaChip(paid[3])}` : ''].filter(Boolean);
    return parts.join(' · ') || 'trial and paid starts not available';
  }

  function tileAcademy(s) {
    const t = insightTile(s, 'mix-academy');
    if (!t) return unavailable(5, 'Academy progression', 'Academy figures not available', 'panel:acquisition', 'Academy funnel');
    const label = t.headline?.label === 'paying members' ? 'paying' : t.headline?.label;
    return {
      n: 5, title: 'Academy progression', rag: 'grey', go: `panel:${t.link?.panel || 'acquisition'}`, goLabel: 'Academy funnel',
      head: `${esc(t.headline?.value)} <span class="mko-unit-b">${esc(label)}</span>`,
      lines: [academyLine(t), 'No trial→paid ratio until a 90-day cohort is defined'],
      src: `${esc(t.source)} · ${esc(t.freshness_label || 'read')} ${ukStamp(t.freshness)}`
    };
  }

  const PURPOSE_ORDER = [['sell', 'Sell'], ['educate', 'Educate'], ['inspire', 'Inspire'], ['nurture', 'Nurture']];
  function tileMix(s) {
    const qp = s?.quarter_plan;
    const m = qp && !qp.error ? qp.purpose_mix : null;
    if (!m) return unavailable(6, 'Next 4 weeks: content mix', qp?.error ? `quarter plan unavailable: ${qp.error}` : 'purpose tags not loaded', 'campaign', 'campaign steps');
    const dr = m.draft || { deliveries: 0, by_primary: {} };
    const range = `${ukDay(m.window?.from)} → ${ukDay(m.window?.to)}`;
    const chip = dr.deliveries ? ` <span class="mko-chip" title="Drafts (not approved): ${esc(mixText(dr.by_primary))}">+${n(dr.deliveries)} draft${dr.deliveries === 1 ? '' : 's'}</span>` : '';
    return {
      n: 6, title: 'Next 4 weeks: content mix', rag: 'grey', go: 'campaign', goLabel: 'campaign steps',
      head: `<span title="${esc(range)}">${n(m.deliveries)} <span class="mko-unit">deliveries · next 4 weeks</span></span>${chip}`,
      lines: [mixBars(m, dr), MIX_LEGEND, mixDetails(m, dr, range)],
      src: 'Purpose tags · drafts apart'
    };
  }
  const mixText = (by) => PURPOSE_ORDER.map(([k, l]) => `${l} ${n(by?.[k] || 0)}`).join(' · ');
  const MIX_LEGEND = `<div class="mko-mixleg">${PURPOSE_ORDER.map(([k, l]) => `<span><i class="mko-dot p-${k}"></i>${l}</span>`).join('')}</div>`;
  /** One bar: a segment per non-zero purpose (count inside), width on a scale shared by both bars. */
  function mixBar(label, tip, by, total, scale, draft) {
    const segs = PURPOSE_ORDER.filter(([k]) => (by?.[k] || 0) > 0)
      .map(([k, l]) => `<span class="mko-seg p-${k}${draft ? ' hatch' : ''}" style="flex:${by[k]} 1 0" title="${esc(`${tip}: ${l} ${by[k]}`)}">${n(by[k])}</span>`).join('');
    const width = scale ? Math.max(18, Math.round((total / scale) * 100)) : 0;
    const bar = total ? `<div class="mko-bar" style="width:${width}%" title="${esc(`${tip}: ${mixText(by)}`)}">${segs}</div>` : '<span class="mko-na">none</span>';
    return `<div class="mko-mixrow"><span class="mko-mixl">${label}</span><div class="mko-mixtrack">${bar}</div><span class="mko-mixn">${n(total)}</span></div>`;
  }
  /**
   * Content approval apart from provider scheduling: approved content the platform can't take yet (its window) is
   * "Approved · waiting for platform window", never a draft. by_primary includes it; the bars split it out.
   */
  const WAITING_LABEL = 'Approved · waiting for platform window';
  const minus = (a, b) => Object.fromEntries(PURPOSE_ORDER.map(([k]) => [k, Math.max(0, (a?.[k] || 0) - (b?.[k] || 0))]));
  function mixGroups(m, dr) {
    const w = m.waiting || { deliveries: 0, by_primary: {} };
    return { on: { deliveries: Math.max(0, (m.deliveries || 0) - (w.deliveries || 0)), by_primary: minus(m.by_primary, w.by_primary) }, w, dr };
  }
  function mixBars(m, dr) {
    const g = mixGroups(m, dr);
    const scale = Math.max(g.on.deliveries, g.w.deliveries || 0, dr.deliveries || 0);
    const waiting = g.w.deliveries ? mixBar('Waiting', WAITING_LABEL, g.w.by_primary, g.w.deliveries, scale, false) : '';
    return `<div class="mko-mix">${mixBar('Scheduled', 'Scheduled / approved', g.on.by_primary, g.on.deliveries, scale, false)}${waiting}${mixBar('Drafts', 'Drafts (not approved)', dr.by_primary, dr.deliveries || 0, scale, true)}</div>${g.w.deliveries ? `<div class="mko-unit">${WAITING_LABEL}: ${n(g.w.deliveries)}</div>` : ''}`;
  }
  /** Everything else, closed by default (one short line each). */
  function mixDetails(m, dr, range) {
    const source = m.source_text || `scheduled / approved ${m.set_by_hand} stored · ${m.by_rule} channel rule`;
    const g = mixGroups(m, dr);
    const items = [
      `Scheduled / approved: ${mixText(g.on.by_primary)}`, `${WAITING_LABEL}: ${mixText(g.w.by_primary)}`, `Drafts (not approved): ${mixText(dr.by_primary)}`,
      `Module mix (${n(m.modules?.total)} featured items): ${mixText(m.modules?.by_purpose)}`, `Purpose source: ${source}`,
      'No target mix (GPT proposes, Alan approves)', `${range} · tags from strategy_initiative_links over campaign steps + theme / event sends`
    ];
    return `<details class="mko-det"><summary>details</summary><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
  }

  /* ---------- row C: delivery, audience and readiness ---------- */

  const CLOSED_STAGES = ['sent', 'measured', 'cancelled'];
  /** Campaign records waiting for Alan: a weekly email due within 7 days with no audience chosen, or a record at "verified". */
  function campaignDecisions(s, today) {
    const soon = addDays(today, 7);
    const out = [];
    for (const c of s?.campaign?.campaigns || []) {
      if (CLOSED_STAGES.includes(c.stage)) continue;
      if (c.kind === 'weekly_email' && !c.audience && c.send_day && c.send_day <= soon) out.push({ text: `Choose the audience for the weekly email, ${ukDay(c.send_day)}`, go: 'campaign' });
      if (c.stage === 'verified') out.push({ text: `Approve: ${c.title || c.campaign_key}`, go: 'campaign' });
    }
    return [...out, ...askDecisions(s)];
  }
  /** "Link this email?" steps: more than one sent email could be a week's email (never guessed). */
  const askDecisions = (s) => (s?.campaign?.step_status?.ask_steps || []).map((a) => ({ text: `Link this week's email: more than one sent email could be the one for w/c ${ukDay(a.week)}`, go: 'campaign' }));

  function decisionList(d, s, today) {
    const out = [];
    if (d.import_block?.production_load_blocked) out.push({ text: 'Accept (or not) the residual risk so production list loads can run', go: 'exports' });
    out.push(...campaignDecisions(s, today));
    for (const m of d.tiles?.cleanup?.frozen || []) out.push({ text: `Approve or cancel the frozen clean-up list (${n(m.people)} people${m.mode === 'test' ? ', test' : ''}, ${ukDay(m.created_at)})`, go: 'cleanup' });
    const i = d.identity || {};
    const back = i.suppressed_new ?? i.suppressed_but_subscribed ?? 0;
    const split = i.suppressed_decided != null ? ` (${n(i.suppressed_total)} total · ${n(i.suppressed_decided)} decided (keep blocked) · ${n(back)} new)` : '';
    if (back > 0) out.push({ text: `Review ${plural(back, 'new blocked contact')} showing as subscribed again${split}`, go: 'review' });
    return out;
  }

  const openActions = (s) => (s?.actions || []).filter((a) => !a.is_ticked && a.due_week_start);
  /** Quarter actions waiting for their evidence rule (e.g. the Pick n Mix relaunch email) are not late yet. */
  const waitingIds = (s) => new Set(s?.campaign?.step_status?.awaiting_plan_ids || []);
  const lateActions = (s, today) => openActions(s).filter((a) => a.status !== 'waiting' && a.due_week_start < today && !waitingIds(s).has(String(a.id))).sort((a, b) => a.due_week_start.localeCompare(b.due_week_start));

  /** Campaign steps late: the server rule (lib/strategy-step-status.mjs), quarter actions counted separately above. */
  const lateStepCount = (s) => s?.campaign?.step_status?.late_campaign ?? 0;

  function stepLines(s, steps) {
    const ss = s?.campaign?.step_status;
    const lines = [];
    if (steps) lines.push(`<span class="mko-t-amber">${plural(steps, 'campaign step')} late</span> (planned day passed, not done)`);
    if (ss?.older) lines.push(`${plural(ss.older, 'older step')} not done (more than 14 days)`);
    if (ss?.awaiting) lines.push(`${n(ss.awaiting)} waiting for evidence`);
    return lines;
  }

  /** Owner of a quarter action = its initiative's owner (quarter_plan.action_owner); no owner stays with Alan. */
  const ownerOf = (s, a) => s?.quarter_plan?.action_owner?.[a.action_key] || null;
  const isAlans = (s) => (a) => !ownerOf(s, a) || ownerOf(s, a) === 'Alan';
  /** "Owned elsewhere (not Needs Alan): GPT: 2 · Claude: 1": open actions whose initiative another owner runs. */
  function othersLine(s) {
    const by = {};
    for (const a of openActions(s).filter((x) => !isAlans(s)(x))) by[ownerOf(s, a)] = (by[ownerOf(s, a)] || 0) + 1;
    const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([o, k]) => `${esc(o)}: ${n(k)}`);
    return parts.length ? [`<span class="mko-unit">Owned elsewhere (not Needs Alan): ${parts.join(' · ')}</span>`] : [];
  }
  function queueLines(s, today) {
    const late = lateActions(s, today).filter(isAlans(s));
    const steps = lateStepCount(s);
    const open = openActions(s).filter(isAlans(s));
    const waiting = open.filter((a) => a.status === 'waiting');
    const next = open.filter((a) => a.status !== 'waiting' && a.due_week_start >= today).sort((a, b) => a.due_week_start.localeCompare(b.due_week_start))[0];
    const lines = [];
    if (late.length) lines.push(`<span class="mko-t-amber">${n(late.length)} late:</span> ${esc(late[0].label)} · due ${ukDay(late[0].due_week_start)}${late.length > 1 ? ` (+${n(late.length - 1)} more)` : ''}`);
    lines.push(...stepLines(s, steps));
    const wait = waiting.length ? `${n(waiting.length)} waiting on trigger (${esc(waiting[0].label)} → ${esc(waiting[0].waiting_on || 'a trigger')})` : '0 waiting on trigger';
    lines.push(`${wait}${next ? ` · next: ${esc(next.label)}, ${ukDay(next.due_week_start)}` : ''}`, ...othersLine(s));
    return { lines, behind: late.length + steps };
  }

  function tileNeedsAlan(d, s) {
    const today = todayIso();
    const dec = decisionList(d, s, today);
    const q = queueLines(s, today);
    const unread = d.tiles?.cleanup?.frozen == null ? ['clean-up manifests could not be read'] : [];
    return {
      n: 7, title: 'Needs Alan', detail: dec, go: 'campaign', goLabel: 'decision queue',
      head: dec.length ? plural(dec.length, 'decision') : 'No decisions waiting',
      lines: [...q.lines, ...unread.map(esc)],
      rag: dec.length || q.behind || unread.length ? 'amber' : 'green',
      src: 'quarter actions · campaign step status · campaign records · list loads · clean-up · suppression review'
    };
  }

  /** Red only for a real overage this cycle; amber for a stale meter / Scheduled read, a projected shortfall or under 10% free. */
  function allowanceRag(m, c) {
    if (c.overage > 0) return 'red';
    const readBad = m.schedule_read && m.schedule_read.state !== 'fresh';
    return m.state !== 'fresh' || readBad || c.projected_overage > 0 || c.free_after_commitments < c.quota * 0.1 ? 'amber' : 'green';
  }
  function capacityLines(c) {
    const rows = typeof window.mkCapacityRows === 'function' ? window.mkCapacityRows(c) : [];
    return [`<table class="mkd-kv"><tbody>${rows.map(([label, value, title]) => `<tr title="${esc(title)}"><td>${esc(label)}</td><td>${value}</td></tr>`).join('')}</tbody></table>`];
  }
  function tileAllowance(d, s) {
    const m = d.meter || {};
    const base = { n: 8, title: 'Email capacity', go: 'budget', goLabel: 'sends & reservations' };
    if (m.state === 'never_read' || m.after_reservations == null) return { ...base, rag: 'amber', head: 'No meter reading', lines: [esc(m.note || 'the send meter has not been read yet')], src: 'Squarespace send meter' };
    const c = typeof window.mkCapacity === 'function' ? window.mkCapacity(d, s) : null;
    if (!c) return { ...base, rag: 'amber', head: `${n(m.after_reservations)} free`, lines: ['capacity script not loaded — refresh the page'], src: 'Squarespace meter' };
    const stale = m.state !== 'fresh';
    const read = m.schedule_read?.last_ok_at ? `Squarespace Scheduled read ${ukDayTime(m.schedule_read.last_ok_at)}` : 'Squarespace Scheduled not read yet';
    return {
      ...base, rag: allowanceRag(m, c),
      head: `${c.overage ? `<span class="mko-t-red">${n(c.overage)} over</span>` : `${n(c.free_after_commitments)} free`}${stale ? ' <span class="rt-pill warn">STALE</span>' : ''}`,
      lines: [`<span class="mko-unit">after committed sends · resets ${ukDayTime(m.cycle?.reset)}</span>`, ...capacityLines(c)],
      src: `meter read ${ukDayTime(m.captured_at)}${stale ? ` (${n(m.age_hours)} h ago)` : ''} · ${read}`
    };
  }

  function recentLine(h) {
    if (h.state === 'missing') return 'Recent buyers not email-eligible: … <a href="#" data-mko-go="customers">see Customers</a>';
    if (h.state === 'error') return `Recent buyers not email-eligible: unavailable (${esc(h.error)})`;
    const x = h.data?.recent_not_eligible;
    if (h.state !== 'ok' || !x) return 'Recent buyers not email-eligible: …';
    const parts = [`${n(x.not_subscribed)} not subscribed`, `${n(x.blocked)} blocked`, `${n(x.no_email)} no email held`];
    if (x.email_no_contact) parts.push(`${n(x.email_no_contact)} email, no Squarespace contact`);
    return `<span class="mko-t-amber">${n(x.total)} recent buyers (12 months) not email-eligible:</span> ${parts.join(' · ')}`;
  }

  /** "164 collected of 166 known · 2 awaiting next collector · 164 complete" (sends the collector hasn't read yet). */
  function collectorLag(cov) {
    if (!cov) return 'coverage …';
    const lag = cov.awaiting_collector ? ` · ${n(cov.awaiting_collector)} awaiting next collector` : '';
    return `${n(cov.collected ?? cov.campaigns)} collected of ${n(cov.known ?? cov.campaigns)} known${lag} · ${n(cov.complete)} complete`;
  }
  /** The denominator beside the count: "= 669 people + 3 own addresses + 1 organisation" (client-health reconciliation). */
  function audienceSplit(h) {
    const r = h.data;
    if (h.state !== 'ok' || r?.can_email_people == null) return '<span class="mko-unit">people / own addresses / organisations: …</span>';
    const alias = r.alias_addresses ? ` + ${n(r.alias_addresses)} second address${r.alias_addresses === 1 ? '' : 'es'} of the same people` : '';
    return `<span class="mko-unit">= ${n(r.can_email_people)} people + ${n(r.owner_addresses)} own address${r.owner_addresses === 1 ? '' : 'es'} + ${n(r.organisations)} organisation${r.organisations === 1 ? '' : 's'}${alias}${r.gap ? ` (gap ${n(r.gap)})` : ''}</span>`;
  }
  function tileAudience(d, h) {
    const total = h.data?.recent_not_eligible?.total;
    const rag = h.state === 'ok' && total != null ? (total > 0 ? 'amber' : 'green') : 'grey';
    return {
      n: 9, title: 'Eligible audience', rag, go: 'health', goLabel: 'Client list health',
      head: `${n(d.identity?.subscribed_unsuppressed)} can be emailed`,
      lines: [audienceSplit(h), recentLine(h)],
      src: `Squarespace consent ${ukStamp(d.runs?.['sync:profiles']?.finished_at)} · suppression list`
    };
  }

  /** Strategy-side readiness gaps: missing daily diary snapshots, campaign data that failed to load. */
  function strategyWarnings(s) {
    if (!s) return [];
    const out = [];
    const gaps = s.snapshot_meta?.missing_last_7 || [];
    if (gaps.length) out.push(`diary snapshots missing for ${plural(gaps.length, 'day')} in the last 7`);
    for (const e of s.campaign?.load_errors || []) out.push(`campaign data: ${String(e).slice(0, 100)}`);
    return out;
  }

  function tileHealth(d, s) {
    const h = typeof window.mkHealthIssues === 'function' ? window.mkHealthIssues(d) : { blocked: [], attention: [] };
    const attention = [...h.attention, ...strategyWarnings(s)];
    const all = [...h.blocked, ...attention];
    const state = h.blocked.length ? ['Blocked', 'red'] : (attention.length ? ['Attention', 'amber'] : ['Ready', 'green']);
    const cov = d.engagement?.coverage;
    return {
      n: 10, title: 'Data & alignment health', rag: state[1], go: 'sources', goLabel: 'per-source status',
      head: all.length ? `${state[0]} · ${n(all.length)}` : 'Ready',
      lines: [all.length ? all.slice(0, 2).map(esc).join(' · ') : 'every source read in the last day; no list or delivery issues'],
      src: `run log · customers rebuilt ${ukStamp(d.runs?.['sync:customers']?.finished_at)} · emails ${collectorLag(cov)}`
    };
  }

  /* ---------- render ---------- */

  const STYLE = `<style>
    .mko { margin: 0.5rem 0 1.5rem; }
    .mko-period { color: var(--dark-text-muted); font-size: 0.85rem; margin: 0 0 0.25rem; }
    .mko-prio { color: var(--dark-text); font-size: 0.92rem; margin: 0 0 0.6rem; }
    .mko-row { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dark-text-muted); margin: 1rem 0 0.45rem; }
    .mko-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); }
    .mko-grid.c4 { grid-template-columns: repeat(auto-fit, minmax(14.5rem, 1fr)); }
    .mko-grid.c5 { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
    .mko-gaplink { margin: 0.2rem 0 0.7rem; font-size: 0.95rem; } .mko-gaplink a { color: #8fb7ff; font-weight: 600; }
    .mko-tile { position: relative; background: #111827; border: 1px solid var(--dark-border); border-left: 5px solid #64748b; border-radius: 10px; padding: 0.8rem 1rem 0.7rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
    .mko-tile:hover { background: #142033; } .mko-tile:focus-visible { outline: 2px solid var(--dark-brand); }
    .mko-tile.r-red { border-left-color: #ef4444; } .mko-tile.r-amber { border-left-color: #f59e0b; } .mko-tile.r-green { border-left-color: #22c55e; } .mko-tile.r-grey { border-left-color: #64748b; }
    .mko-num { position: absolute; top: 0.5rem; right: 0.7rem; font-size: 0.72rem; color: #64748b; }
    .mko-title { font-size: 1.08rem; font-weight: 800; color: #fff; padding-right: 1.2rem; }
    .mko-badge { font-size: 0.68rem; font-weight: 600; background: #1e3a8a; color: #bfdbfe; border-radius: 4px; padding: 1px 6px; margin-left: 0.35rem; vertical-align: middle; }
    .mko-head { font-size: 1.75rem; font-weight: 800; color: #fff; line-height: 1.2; margin: 0.15rem 0 0.2rem; overflow-wrap: anywhere; }
    .mko-unit { font-size: 0.95rem; font-weight: 500; color: var(--dark-text-muted); } .mko-unit-b { font-size: inherit; font-weight: 800; }
    .mko-sep { color: #64748b; font-weight: 500; } .mko-na { color: #94a3b8; }
    .mko-line { font-size: 0.86rem; color: #cbd5e1; line-height: 1.45; } .mko-line a { color: var(--dark-brand); }
    .mko-src { font-size: 0.74rem; color: #64748b; margin-top: auto; padding-top: 0.35rem; }
    .mko-t-red { color: #f87171; font-weight: 700; } .mko-t-amber { color: #fbbf24; font-weight: 700; } .mko-t-green { color: #4ade80; font-weight: 700; } .mko-t-grey { color: #94a3b8; }
    .mko-det { font-size: 0.82rem; color: #cbd5e1; } .mko-det summary { cursor: pointer; color: var(--dark-text-muted); }
    .mko-det ul { margin: 0.25rem 0 0; padding-left: 1.1rem; } .mko-det li { margin: 0.15rem 0; } .mko-det a { color: #e5e7eb; }
    .mko-loading { color: var(--dark-text-muted); font-size: 0.9rem; }
    .mko-chip { display: inline-block; vertical-align: middle; margin-left: 0.4rem; font-size: 0.78rem; font-weight: 600; color: #cbd5e1; background: #1f2937; border: 1px solid #374151; border-radius: 999px; padding: 1px 8px; }
    .mko-mix { display: flex; flex-direction: column; gap: 0.4rem; margin: 0.25rem 0 0.15rem; }
    .mko-mixrow { display: grid; grid-template-columns: 4.6rem 1fr 1.8rem; align-items: center; gap: 0.45rem; }
    .mko-mixl { font-size: 0.8rem; color: #cbd5e1; font-weight: 600; } .mko-mixn { font-size: 0.8rem; color: #94a3b8; text-align: right; }
    .mko-mixtrack { min-width: 0; } .mko-bar { display: flex; height: 1.35rem; border-radius: 5px; overflow: hidden; gap: 2px; min-width: 6rem; }
    .mko-seg { min-width: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 800; color: #0b1220; }
    .mko-seg.hatch { opacity: 0.72; background-image: repeating-linear-gradient(135deg, rgba(11,18,32,0.5) 0 4px, transparent 4px 9px); color: #fff; text-shadow: 0 0 2px #000, 0 0 4px #000; }
    .p-sell { background-color: #f59e0b; } .p-educate { background-color: #60a5fa; } .p-inspire { background-color: #a78bfa; } .p-nurture { background-color: #34d399; }
    .mko-mixleg { display: flex; flex-wrap: wrap; gap: 0.25rem 0.8rem; font-size: 0.76rem; color: #94a3b8; }
    .mko-dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; margin-right: 0.3rem; vertical-align: -1px; }
  </style>`;

  function detailHtml(list) {
    if (!list?.length) return '';
    return `<details class="mko-det"><summary>show the ${plural(list.length, 'decision')}</summary><ul>${list.map((x) => `<li><a href="#" data-mko-go="${esc(x.go)}">${esc(x.text)}</a></li>`).join('')}</ul></details>`;
  }

  function tileHtml(t) {
    return `<div class="mko-tile r-${t.rag || 'grey'}" role="link" tabindex="0" data-mko-go="${esc(t.go)}" title="Open ${esc(t.goLabel)}"><div class="mko-num">${t.n}</div>`
      + `<div class="mko-title">${esc(t.title)}${t.badge ? `<span class="mko-badge">${esc(t.badge)}</span>` : ''}</div><div class="mko-head">${t.head}</div>`
      + `${t.lines.filter(Boolean).map((l) => `<div class="mko-line">${l}</div>`).join('')}${detailHtml(t.detail)}`
      + `<div class="mko-src">${t.src} · → ${esc(t.goLabel)}</div></div>`;
  }

  const loadingTile = (num, title, why) => ({ n: num, title, head: `<span class="mko-loading">${esc(why)}</span>`, lines: [], src: 'Strategy summary', go: 'strategy', goLabel: 'Strategy', rag: 'grey' });

  /**
   * Row A (sales gap) is retired here: Strategy owns "Sales gap by month" (one server model, s.sales_gap). This line
   * links to it with the same rolling figures; Repeat clients and Academy progression moved to Strategy too.
   */
  function salesGapLink(st) {
    const r = st.s?.sales_gap?.rolling;
    const figures = r ? ` <span class="mko-unit">· to ${ukDay(r.to)}: ${gbpK(r.still_to_sell)} still to sell · ${gbpK(r.likely)} likely dated bookings · ${gbpK(r.non_dated_needed)} non-dated needed</span>` : '';
    return `<p class="mko-gaplink"><a href="#strategy" data-mko-go="strategy">Sales gap by month → Strategy</a>${figures}</p>`;
  }
  function gridHtml(st) {
    const t7 = st.s ? tileNeedsAlan(st.d, st.s) : loadingTile(7, 'Needs Alan', st.error ? `decision list unavailable: ${st.error}` : 'Loading…');
    const mix = st.s ? tileMix(st.s) : loadingTile(6, 'Next 4 weeks: content mix', st.error ? `content mix unavailable: ${st.error}` : 'Loading…');
    return `${STYLE}${cyclesStyle()}<div class="mko"><p class="mko-period">Period: from ${ukDay(todayIso())} · each tile shows its own source and data-through date</p>`
      + salesGapLink(st)
      + `<div class="mko-grid c5">${[mix, t7, tileAllowance(st.d, st.s), tileAudience(st.d, st.health), tileHealth(st.d, st.s)].map(tileHtml).join('')}${cyclesTile(st.d)}</div></div>`;
  }
  /** "Squarespace campaigns by billing cycle" (lib/marketing-sqs-cycles.js): the row under Email capacity, after the five tiles. */
  const cyclesTile = (d) => (typeof window.mkSqsCyclesTileHtml === 'function' && d?.meter?.capacity ? window.mkSqsCyclesTileHtml(d) : '');
  const cyclesStyle = () => window.mkSqsCyclesStyle || '';

  /* ---------- click-throughs ---------- */

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const openPanel = (panel) => document.querySelector(`.aigeo-nav-item[data-panel="${panel}"]`)?.click();
  const SCROLL = { campaign: 'mk-campaign-host', segments: 'mk-segments', budget: 'mk-budget', customers: 'mk-query', sources: 'mk-sources', exports: 'mk-exports', cleanup: 'mk-cleanup', review: 'mk-review' };
  function go(where) {
    if (SCROLL[where]) return scrollTo(SCROLL[where]);
    if (where === 'strategy') return openPanel('strategy');
    if (where === 'diary') { openPanel('revenue-funnel'); return setTimeout(() => scrollTo('rf-diary-host'), 400); }
    if (where === 'health') return typeof window.mkOpenClientHealth === 'function' ? window.mkOpenClientHealth() : scrollTo('mk-query');
    if (where.startsWith('panel:')) return openPanel(where.slice(6));
    return null;
  }
  /** A campaigns-by-cycle row: that email's campaign record (the schedule's detail panel), else the schedule itself. */
  function openRecord(key) {
    if (typeof window.mkOpenEmailRecord === 'function' && window.mkOpenEmailRecord(key)) return;
    scrollTo('mk-schedule');
  }
  function onActivate(e) {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    const rec = e.target.closest('[data-mkc-open]');
    if (rec) { e.preventDefault(); openRecord(rec.dataset.mkcOpen); return; }
    if (e.target.closest('details') && !e.target.closest('a[data-mko-go]')) return;
    const el = e.target.closest('[data-mko-go]');
    if (!el) return;
    e.preventDefault();
    go(el.dataset.mkoGo);
  }

  /* ---------- mount ---------- */

  function clientHealth() {
    if (typeof window.mkClientHealthSummary !== 'function') return Promise.resolve({ state: 'missing' });
    return Promise.resolve().then(() => window.mkClientHealthSummary()).then((data) => ({ state: 'ok', data }), (e) => ({ state: 'error', error: e.message }));
  }

  /**
   * Paints the tiles from the Marketing overview `d` straight away; Strategy tiles (1–5, 7) and the tile 9 buyer split
   * fill in when their promises resolve. `strategy` is the shared stLoadStrategySummary() promise (one fetch per render).
   */
  window.mkMountOverviewTiles = function mkMountOverviewTiles(host, d, strategy) {
    if (!host) return;
    const st = { d, s: null, error: null, health: { state: 'loading' } };
    const paint = () => { if (host.isConnected) host.innerHTML = gridHtml(st); };
    host.addEventListener('click', onActivate);
    host.addEventListener('keydown', onActivate);
    paint();
    Promise.resolve(strategy).then((s) => { st.s = s || null; if (!s) st.error = 'no data'; }, (e) => { st.error = e.message; }).then(paint);
    clientHealth().then((h) => { st.health = h; paint(); });
  };
  window.mkOverviewTiles = { tileNeedsAlan, tileMix, tileAudience, tileHtml, STYLE, tileSalesNeeded, tileDated, tileNonDated, tileRepeat, tileAcademy, insightTile, tileAllowance, gridHtml };
  /** Tile 7's Alan-only queue for "Waiting on you" (lib/marketing-waiting.js): decisions + Alan-owned open actions. */
  window.mkNeedsAlanQueue = (d, s) => ({ decisions: decisionList(d, s, todayIso()), actions: openActions(s).filter(isAlans(s)).filter((a) => a.status !== 'waiting' && !waitingIds(s).has(String(a.id))) });
})();
