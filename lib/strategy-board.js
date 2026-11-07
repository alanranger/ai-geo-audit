/**
 * Strategy & Actions S3c "Next 4 weeks" board + "When your clients book" table, and S3d "Campaign steps" per week.
 * Both read the same week rows (strategy-summary `campaign.weeks[].rows / more / steps`, lib/strategy-board-rows.mjs).
 * Ticks: moments / steps → PATCH /api/aigeo/strategy-ticks (strategy_campaign_ticks); plan actions → window.stTickAction
 * (strategy_quarter_actions.is_ticked). Ticking a step also ticks the moments it covers. Brief = paste-ready text.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const utc = (iso) => new Date(`${iso}T12:00:00Z`);
  const day = (iso) => utc(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dm = (iso) => utc(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
  let activeWeek = 0;
  let current = null;

  const ticked = (key) => !!current?.campaign?.ticks?.[key]?.is_ticked;
  const ov = (e) => (window.stOverrideHtml ? window.stOverrideHtml(e) : '');
  const offerPill = (o) => (window.stOfferHtml ? window.stOfferHtml(o) : '');
  const TAG = { 'Announce': 'ann', 'Main push': 'push', 'Last places': 'last', 'Last chance': 'chance', 'Weekly mention': 'weekly', 'Plan': 'plan' };
  const stageTag = (s) => `<span class="st-tag st-tag-${TAG[s] || 'weekly'}">${esc(s)}</span>`;
  const CHIP = { Email: 'email', 'FB+IG': 'fbig', LinkedIn: 'li', Outlook: 'ol' };
  const chip = (c) => `<span class="st-ch st-ch-${CHIP[c] || 'email'}">${esc(c)}</span>`;

  /* ---------- When your clients book ---------- */

  function leadTable(lt) {
    const w = (n) => (n == null ? '—' : `${n} wk${n === 1 ? '' : 's'}`);
    const dd = (n) => (n == null ? '—' : `${n} days`);
    const row = (label, v) => `<tr><td class="left">${label}</td><td>${v?.n ?? 0}</td><td>${dd(v?.q25_days)}</td><td>${dd(v?.median_days)}</td><td>${dd(v?.q75_days)}</td><td>${w(v?.announce_weeks)}</td><td>${w(v?.main_push_weeks)}</td><td>${w(v?.last_places_weeks)}</td></tr>`;
    return `<table class="rt-table" id="st-leadtimes"><thead><tr><th class="left">When your clients book</th><th>Bookings</th><th>¼ book within</th><th>Half book within</th><th>¾ book within</th><th>Announce</th><th>Main push</th><th>Last places</th></tr></thead>`
      + `<tbody>${row('Beginners / Lightroom courses', lt.course)}${row('Day workshops &amp; walks', lt.day)}${row('Residentials', lt.residential)}</tbody></table>`
      + '<p class="rt-sub">Weeks before the start date. Announce is when the earliest quarter of your clients book, Main push is the halfway point, and Last places is when the final quarter book. Worked out from your Booking Sheet bookings over the last 24 months (JLR left out), and updated every time the page loads.</p>';
  }

  /* ---------- Next 4 weeks ---------- */

  function placesLine(r) {
    const bits = [];
    if (r.cap) bits.push(`${r.booked} of ${r.cap} booked`);
    if (r.gain) bits.push(`<span class="st-gain">+${gbp(r.gain)} GP if full</span>`);
    return bits.join(' · ');
  }
  function planItem(r) {
    const due = r.overdue ? `<span class="st-overdue">${esc(r.when)}</span>` : `due ${esc(day(r.due))}`;
    return `<li class="st-row"><input type="checkbox" class="st-qa-tick" data-id="${r.id}" ${r.is_ticked ? 'checked' : ''} aria-label="Done">`
      + `<div><div class="st-row-l1">${esc(day(r.due))} · ${stageTag('Plan')}</div><div class="st-row-name">${esc(r.name)}</div><div class="rt-sub">${due} · quarter card</div></div></li>`;
  }
  function eventItem(r) {
    const on = r.keys.every(ticked);
    const evRef = r.type === 'moment' ? { date: r.date, url: r.url, title: r.title } : null;
    return `<li class="st-row"><input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify(r.keys))}" ${on ? 'checked' : ''} aria-label="Done">`
      + `<div><div class="st-row-l1">${esc(day(r.due))} · ${r.chips.map(chip).join(' ')} · ${stageTag(r.stage)}</div>`
      + `<div class="st-row-name">${esc(r.type === 'announce_group' ? r.name : `${r.name} · ${r.when}`)}</div>`
      + `<div class="rt-sub">${placesLine(r)}${offerPill(r.offer)}${evRef ? ov(evRef) : ''}</div></div></li>`;
  }
  const item = (r) => (r.type === 'plan' ? planItem(r) : eventItem(r));
  function weekColumn(w, i) {
    const head = i === 0 ? 'This week' : (i === 1 ? 'Next week' : '');
    const more = w.more?.length ? `<details class="st-more"><summary>+${w.more.length} more</summary><ul>${w.more.map(item).join('')}</ul></details>` : '';
    return `<div class="st-n4-col${i === 0 ? ' st-n4-now' : ''}"><h4>${head ? `${head} ` : ''}<span class="rt-sub">w/c ${esc(dm(w.week))}</span></h4>`
      + `<ul>${w.rows.map(item).join('') || '<li class="rt-sub">Nothing due</li>'}</ul>${more}</div>`;
  }
  function next4Html(data) {
    const c = data.campaign;
    return '<h3>Next 4 weeks</h3><p class="rt-sub">What to do each week: every date on the site gets its Announce, Main push and Last places moment in the right week, from when your clients actually book. Each row shows the day it\'s due, where it goes, the date it promotes, places booked and the GP still to win. Quarter-card actions sit alongside. Ticking here also ticks the quarter card and the campaign step.</p>'
      + `${leadTable(c.lead_times)}<div class="st-n4">${c.weeks.map(weekColumn).join('')}</div>`;
  }

  /* ---------- Campaign steps ---------- */

  const UTM = { email: ['squarespace-email', 'email'], facebook: ['facebook', 'social'], instagram: ['instagram', 'social'], linkedin: ['linkedin', 'social'], outlook: ['outlook', 'email'] };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function channelKeys(channel) {
    if (/Facebook/.test(channel)) return ['facebook', 'instagram'];
    if (/LinkedIn/.test(channel)) return ['linkedin'];
    if (/Outlook/.test(channel)) return ['outlook'];
    return ['email'];
  }
  /** Campaign-tagged link: weekly email links carry the week's email campaign; other channels the event's own campaign. */
  function tagged(f, ch, week) {
    const [source, medium] = UTM[ch];
    const camp = ch === 'email' ? `weekly-email-${week}` : `ev-${f.date}-${slug(f.title)}`;
    const base = /^https?:/.test(f.url) ? f.url : `https://www.alanranger.com${f.url}`;
    return `${base}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${camp}&utm_content=${slug(f.title)}`;
  }
  function briefLine(f, chans, week) {
    const offer = f.offer ? ` — OFFER: ${f.offer.note}${f.offer.code ? ` (code ${f.offer.code})` : ''}${f.offer.ends ? `, ends ${day(f.offer.ends)}` : ''}` : '';
    const places = f.cap ? `, ${f.booked} of ${f.cap} booked` : '';
    const links = f.url ? chans.map((ch) => `\n    ${chans.length > 1 ? `${ch} link: ` : 'Link: '}${tagged(f, ch, week)}`).join('') : '';
    return `- ${f.moment}: ${f.name || f.title} (${f.when || f.date})${places}${offer}${links}`;
  }
  const expand = (list) => list.flatMap((f) => (f.items ? f.items.map((i) => ({ ...i, moment: 'Announce' })) : [f]));
  function briefText(s, rules, week) {
    const chans = channelKeys(s.channel);
    const ev = expand(s.featured).map((f) => briefLine(f, chans, week)).join('\n');
    return `Write the ${s.channel} piece for Alan Ranger Photography, to go out ${day(s.day)}.\nTask: ${s.step}.\n`
      + `Feature these (first two lead, the rest as supporting mentions):\n${ev || '- (no events this week: use a useful tip and the Pick n Mix plans)'}\n`
      + `Rules: British English; real prices and dates only from the pages linked; use the tagged links exactly as given; no offers or codes except the OFFER lines above.${/LinkedIn/.test(s.channel) ? ` Angle: ${rules.linkedin.angle}.` : ''}${/email/i.test(s.channel) ? ` One full-list send this week (list ~${window.mkLiveListSize || rules.email.list_size}); Light & Logic is folded into the week of the ${rules.email.light_and_logic_day}th, never a separate send.` : ''}`;
  }
  function featureLine(f) {
    return `<div>${stageTag(f.moment)} ${esc(f.name || f.title)} <span class="rt-sub">${esc(f.when || '')}</span>${offerPill(f.offer)}${f.event_key ? ov({ date: f.date, url: f.url, title: f.title }) : ''}</div>`;
  }
  /** Two lead items shown; supporting mentions behind "+N supporting". */
  function featuredCell(list) {
    if (!list.length) return '<span class="rt-sub">—</span>';
    const rest = list.slice(2);
    return list.slice(0, 2).map(featureLine).join('') + (rest.length ? `<details><summary class="rt-sub">+${rest.length} supporting</summary>${rest.map(featureLine).join('')}</details>` : '');
  }
  function tickBox(keys, label) {
    return `<label class="st-pub"><input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify(keys))}" ${ticked(keys[0]) ? 'checked' : ''} aria-label="${esc(label)}"> ${esc(label)}</label>`;
  }
  /** Facebook + Instagram: one prep task, two publish ticks. Weekly email: its campaign record's stage. */
  function doneCell(s, week) {
    if (/Facebook/.test(s.channel)) return tickBox([s.key], 'Prep') + tickBox([`${s.key}|fb`, ...s.covers], 'FB') + tickBox([`${s.key}|ig`, ...s.covers], 'IG');
    if (s.is_email && window.stStageChip) return window.stStageChip(current.campaign.campaigns?.find((r) => r.campaign_key === `email|${week}`));
    return `<input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify([s.key, ...s.covers]))}" ${ticked(s.key) ? 'checked' : ''} aria-label="Done">`;
  }
  const CHANNEL_CHIPS = { 'Facebook + Instagram': '<span class="st-ch st-ch-fbig">Facebook</span> <span class="st-ch st-ch-fbig">Instagram</span>', LinkedIn: '<span class="st-ch st-ch-li">LinkedIn</span>', 'Squarespace email (full list)': '<span class="st-ch st-ch-email">Squarespace email</span>', 'Outlook personal notes': '<span class="st-ch st-ch-ol">Outlook (BCC)</span>' };
  function stepRow(s, wi, si, week) {
    return `<tr><td>${doneCell(s, week)}</td><td>${esc(day(s.day))}</td><td class="left">${CHANNEL_CHIPS[s.channel] || esc(s.channel)}</td><td class="left">${esc(s.step)}</td>`
      + `<td class="left st-feat">${featuredCell(s.featured)}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary" data-brief="${wi}|${si}">Brief</button></td></tr>`;
  }
  /** The billing-cycle meter (Marketing tab) replaces the old calendar-month estimate; stale is shown, never zero. */
  function sendsLine(s) {
    const m = window.mkMeter;
    if (!m || m.state === 'never_read') return `<div class="st-sends">Send budget: no Squarespace meter reading yet (calendar-month estimate retired; ${s.emails_sent} weekly email${s.emails_sent === 1 ? '' : 's'} marked sent this month).</div>`;
    const when = new Date(m.captured_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const reset = new Date(m.cycle.reset).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    return `<div class="st-sends ${m.after_reservations < 0 ? 'over' : ''}">Billing cycle: <b>${m.used.toLocaleString('en-GB')}</b> of ${m.quota.toLocaleString('en-GB')} sends used, ${m.reserved.toLocaleString('en-GB')} reserved, <b>${m.after_reservations.toLocaleString('en-GB')}</b> left after reservations · resets ${reset} · ${m.state === 'fresh' ? 'read' : 'STALE, last read'} ${when}</div>`;
  }
  function campaignHtml(data) {
    const c = data.campaign;
    const r = c.rules;
    const tabs = c.weeks.map((w, i) => `<button type="button" class="st-al-chip" data-cw="${i}" aria-pressed="${i === activeWeek}">${i === 0 ? 'This week · ' : ''}w/c ${esc(dm(w.week))}</button>`).join('');
    const w = c.weeks[activeWeek] || c.weeks[0];
    const s = c.sends;
    return `<h3>Campaign steps</h3><p class="rt-sub">One plan per week, from the same rows as Next 4 weeks: what to send or post, where, which day, featuring which dates. One Squarespace email a week (${esc(r.email.day)}) to the full list; Facebook + Instagram ${esc(r.facebook_instagram.days.join(' + '))} (one prep task, two publish ticks); LinkedIn ${esc(r.linkedin.days.join(', '))}; an Outlook note only for last places / last chance. "Brief" gives the ready-made brief. Ticking a step also ticks the dates it features.</p>`
      + sendsLine(s)
      + `<div class="st-al-chips">${tabs}</div>`
      + `<div class="st-diary-scroll"><table class="rt-table" id="st-campaign-table"><thead><tr><th>Done</th><th>Day</th><th class="left">Channel</th><th class="left">Step</th><th class="left">Features</th><th></th></tr></thead>`
      + `<tbody>${w.steps.map((st, si) => stepRow(st, activeWeek, si, w.week)).join('')}</tbody></table></div>`
      + '<div id="st-brief-box" hidden><textarea id="st-brief-text" rows="9" style="width:100%"></textarea><button type="button" class="rf-btn" id="st-brief-copy">Copy brief</button></div>'
      + (window.stCampaignRecordsHtml ? window.stCampaignRecordsHtml(c, w.week) : '');
  }

  function ensureSection(root, id) {
    let el = root.querySelector(`#${id}`);
    if (!el) { el = document.createElement('div'); el.className = 'rt-section'; el.id = id; root.appendChild(el); }
    return el;
  }
  /** Strategy keeps a one-line pointer; the steps themselves live on Marketing & Campaigns. */
  function nextCampaignHtml(data) {
    const w = data.campaign.weeks[0];
    const email = w?.steps?.find((s) => s.is_email);
    const rec = data.campaign.campaigns?.find((r) => r.campaign_key === `email|${w?.week}`);
    const lead = email?.featured?.slice(0, 2).map((f) => esc(f.name || f.title)).join(' + ');
    const line = email ? `${esc(day(email.day))} Squarespace email${lead ? ` featuring ${lead}` : ''}${rec ? ` · stage ${esc(rec.stage)}` : ''} · ${w.steps.length} steps this week` : 'Nothing planned this week';
    return `<h3>Next campaign</h3><p class="rt-sub">${line}. Campaign steps, customers &amp; segments and the email send budget are on <a href="#marketing" data-goto-marketing>Marketing &amp; Campaigns →</a></p>`;
  }
  function paint(root) {
    if (!current?.campaign?.weeks) return;
    if (root) {
      ensureSection(root, 'st-next4').innerHTML = next4Html(current);
      ensureSection(root, 'st-campaign').innerHTML = nextCampaignHtml(current);
    }
    const mk = document.getElementById('mk-campaign-host');
    if (mk?.dataset.mounted === '1') mk.innerHTML = campaignHtml(current);
  }
  const repaintAll = () => {
    const root = document.getElementById('strategy-root');
    paint(root?.dataset.loaded === '1' ? root : null);
  };

  async function saveTicks(keys, isTicked) {
    const r = await fetch('/api/aigeo/strategy-ticks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyUrl: PROP, keys, is_ticked: isTicked })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'not saved');
    const now = new Date().toISOString();
    keys.forEach((k) => { current.campaign.ticks[k] = { is_ticked: isTicked, ticked_at: isTicked ? now : null }; });
  }
  async function onChange(e) {
    const mo = e.target.closest?.('.st-mo-tick');
    const qa = e.target.closest?.('.st-qa-tick');
    if (!current || (!mo && !qa)) return;
    e.target.disabled = true;
    try {
      if (qa) { await window.stTickAction(qa.getAttribute('data-id'), qa.checked); return; }
      await saveTicks(JSON.parse(mo.getAttribute('data-keys')), mo.checked);
      repaintAll();
    } catch (_err) {
      e.target.checked = !e.target.checked;
      e.target.disabled = false;
    }
  }
  function goToMarketing(e) {
    e.preventDefault();
    document.querySelector('.aigeo-nav-item[data-panel="marketing"]')?.click();
  }
  function onClick(e) {
    const tab = e.target.closest?.('[data-cw]');
    const brief = e.target.closest?.('[data-brief]');
    if (e.target.closest?.('[data-goto-marketing]')) { goToMarketing(e); return; }
    if (tab && current) { activeWeek = Number(tab.getAttribute('data-cw')); repaintAll(); return; }
    if (brief) showBrief(brief.getAttribute('data-brief'));
    if (e.target.id === 'st-brief-copy') navigator.clipboard?.writeText(document.getElementById('st-brief-text').value).catch(() => {});
  }
  function showBrief(ref) {
    const [wi, si] = ref.split('|').map(Number);
    const w = current.campaign.weeks[wi];
    document.getElementById('st-brief-text').value = briefText(w.steps[si], current.campaign.rules, w.week);
    document.getElementById('st-brief-box').hidden = false;
  }

  window.mountStrategyBoard = function mountStrategyBoard(root, data) {
    current = data;
    if (!data?.campaign) return;
    if (!current.campaign.ticks) current.campaign.ticks = {};
    paint(root);
  };
  /** Marketing & Campaigns: the Campaign steps section (same data, ticks and briefs as before). */
  window.mountMarketingCampaign = function mountMarketingCampaign(host, data) {
    if (!current || data !== current) current = data;
    if (!current?.campaign) { host.innerHTML = '<p class="rt-sub">No campaign data.</p>'; return; }
    if (!current.campaign.ticks) current.campaign.ticks = {};
    host.dataset.mounted = '1';
    host.innerHTML = campaignHtml(current);
  };
  window.stRepaintBoard = repaintAll;
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
})();
