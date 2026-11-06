/**
 * Strategy & Actions S3c "Next 4 weeks" board + "When your clients book" table, and S3d "Campaign steps" per week.
 * Data: strategy-summary `campaign` (lib/strategy-moments.mjs). Ticks: moments / steps → PATCH /api/aigeo/strategy-ticks
 * (table strategy_campaign_ticks); quarter actions → window.stTickAction (strategy_quarter_actions.is_ticked).
 * Ticking a step also ticks the moments it covers. Brief = paste-ready text for ChatGPT.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  let activeWeek = 0;
  let current = null;

  const ticked = (key) => !!current?.campaign?.ticks?.[key]?.is_ticked;
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  function leadTable(lt) {
    const row = (label, v) => `<tr><td class="left">${label}</td><td>${v?.announce_weeks ?? '—'}</td><td>${v?.main_push_weeks ?? '—'}</td><td>${v?.last_places_weeks ?? '—'}</td><td>${v?.n ?? 0}</td></tr>`;
    return `<table class="rt-table" id="st-leadtimes"><thead><tr><th class="left">When your clients book (weeks before the start)</th><th>Announce</th><th>Main push</th><th>Last places</th><th>Bookings</th></tr></thead>`
      + `<tbody>${row('Courses (Week 1)', lt.course)}${row('Day workshops &amp; walks', lt.day)}${row('Residentials', lt.residential)}</tbody></table>`
      + `<p class="rt-sub">${esc(lt.window?.basis || '')} (${esc(lt.window?.from)} → ${esc(lt.window?.to)}). Announce ≈ 75th percentile of lead time, Main push ≈ median, Last places ≈ 25th. Recalculated from the Booking Sheet on every load.</p>`;
  }

  const ov = (e) => (window.stOverrideHtml ? window.stOverrideHtml(e) : '');
  const offerPill = (o) => (window.stOfferHtml ? window.stOfferHtml(o) : '');
  function momentItem(m) {
    const k = m.key;
    return `<li><label><input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify([k]))}" ${ticked(k) ? 'checked' : ''}> <b>${esc(m.label)}</b> · ${esc(m.event.title)} <span class="rt-sub">(${esc(m.event.date)}${m.event.places_left != null ? `, ${m.event.places_left} left` : ''})</span></label>${offerPill(m.event.offer)}${ov(m.event)}</li>`;
  }
  function actionItem(a) {
    return `<li><label><input type="checkbox" class="st-qa-tick" data-id="${a.id}" ${a.is_ticked ? 'checked' : ''}> <b>Plan</b> · ${esc(a.label)}</label></li>`;
  }
  function weekColumn(w, data) {
    const end = addDays(w.week, 7);
    const acts = (data.actions || []).filter((a) => a.due_week_start >= w.week && a.due_week_start < end);
    const items = [...acts.map(actionItem), ...w.moments.map(momentItem)].join('') || '<li class="rt-sub">Nothing due</li>';
    return `<div class="st-n4-col"><h4>w/c ${esc(day(w.week))}</h4><ul>${items}</ul></div>`;
  }
  function next4Html(data) {
    const c = data.campaign;
    return `<h3>Next 4 weeks</h3><p class="rt-sub">This quarter's plan actions due each week plus every event's moments (Announce / Main push / Last places) placed by when your clients book. Sold-out events drop their moments; missed ones become one Catch-up this week. Ticking a plan action ticks it on its quarter card.</p>`
      + `<div class="st-n4">${c.weeks.map((w) => weekColumn(w, data)).join('')}</div>${leadTable(c.lead_times)}`;
  }

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
    const offer = f.offer ? ` — OFFER: ${f.offer.note}${f.offer.code ? ` (code ${f.offer.code})` : ''}${f.offer.ends ? `, ends ${f.offer.ends}` : ''}` : '';
    const links = f.url ? chans.map((ch) => `\n    ${chans.length > 1 ? `${ch} link: ` : 'Link: '}${tagged(f, ch, week)}`).join('') : '';
    return `- ${f.moment}: ${f.title} — ${f.date}${f.places_left != null ? `, ${f.places_left} places left` : ''}${offer}${links}`;
  }
  function briefText(s, rules, week) {
    const chans = channelKeys(s.channel);
    const ev = s.featured.map((f) => briefLine(f, chans, week)).join('\n');
    return `Write the ${s.channel} piece for Alan Ranger Photography, to go out ${day(s.day)}.\nTask: ${s.step}.\n`
      + `Feature these (first two lead, the rest as supporting mentions):\n${ev || '- (no events this week: use a useful tip and the Pick n Mix plans)'}\n`
      + `Rules: British English; real prices and dates only from the pages linked; use the tagged links exactly as given; no offers or codes except the OFFER lines above.${/LinkedIn/.test(s.channel) ? ` Angle: ${rules.linkedin.angle}.` : ''}${/email/i.test(s.channel) ? ` One full-list send this week (list ~${rules.email.list_size}); Light & Logic is folded into the week of the ${rules.email.light_and_logic_day}th, never a separate send.` : ''}`;
  }
  /** Two lead events shown; supporting mentions behind "+N supporting". */
  function featuredCell(list) {
    if (!list.length) return '<span class="rt-sub">—</span>';
    const line = (f) => `${esc(f.title)} <span class="rt-sub">(${esc(f.moment)}, ${esc(f.date)})</span>${offerPill(f.offer)}${ov(f)}`;
    const lead = list.slice(0, 2).map(line).join('<br>');
    const rest = list.slice(2);
    return rest.length ? `${lead}<details><summary class="rt-sub">+${rest.length} supporting</summary>${rest.map(line).join('<br>')}</details>` : lead;
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
  function stepRow(s, rules, wi, si, week) {
    return `<tr><td>${esc(day(s.day))}</td><td class="left">${esc(s.channel)}</td><td class="left">${esc(s.step)}</td>`
      + `<td class="left st-feat">${featuredCell(s.featured)}</td>`
      + `<td>${doneCell(s, week)}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary" data-brief="${wi}|${si}">Brief</button></td></tr>`;
  }
  function campaignHtml(data) {
    const c = data.campaign;
    const r = c.rules;
    const tabs = c.weeks.map((w, i) => `<button type="button" class="st-al-chip" data-cw="${i}" aria-pressed="${i === activeWeek}">w/c ${esc(day(w.week))}</button>`).join('');
    const w = c.weeks[activeWeek] || c.weeks[0];
    const s = c.sends;
    return `<h3>Campaign steps</h3><p class="rt-sub">Squarespace email every week (${esc(r.email.day)}) to the full list; Facebook + Instagram ${esc(r.facebook_instagram.days.join(' + '))} (one prep task); LinkedIn ${esc(r.linkedin.days.join(', '))}; YouTube: ${esc(r.youtube)}; Google Business Profile: ${esc(r.google_business_profile)}; Outlook notes: ${esc(r.outlook_notes)}. Ticking a step ticks the moments it covers.</p>`
      + `<div class="st-sends ${s.sends > s.cap ? 'over' : ''}">Full-list sends this month (${esc(s.month)}): <b>${s.sends.toLocaleString('en-GB')}</b> of ${s.cap.toLocaleString('en-GB')} (${s.emails_sent} weekly email${s.emails_sent === 1 ? '' : 's'} marked sent × ${s.list_size} on the list)</div>`
      + `<div class="st-al-chips">${tabs}</div>`
      + `<div class="st-diary-scroll"><table class="rt-table" id="st-campaign-table"><thead><tr><th>Day</th><th class="left">Channel</th><th class="left">Step</th><th class="left">Featured events</th><th>Done</th><th></th></tr></thead>`
      + `<tbody>${w.steps.map((st, si) => stepRow(st, r, activeWeek, si, w.week)).join('')}</tbody></table></div>`
      + '<div id="st-brief-box" hidden><textarea id="st-brief-text" rows="9" style="width:100%"></textarea><button type="button" class="rf-btn" id="st-brief-copy">Copy brief</button></div>'
      + (window.stCampaignRecordsHtml ? window.stCampaignRecordsHtml(c, w.week) : '');
  }

  function ensureSection(root, id) {
    let el = root.querySelector(`#${id}`);
    if (!el) { el = document.createElement('div'); el.className = 'rt-section'; el.id = id; root.appendChild(el); }
    return el;
  }
  function paint(root) {
    if (!current?.campaign?.weeks) return;
    ensureSection(root, 'st-next4').innerHTML = next4Html(current);
    ensureSection(root, 'st-campaign').innerHTML = campaignHtml(current);
  }

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
    const root = document.getElementById('strategy-root');
    const mo = e.target.closest?.('.st-mo-tick');
    const qa = e.target.closest?.('.st-qa-tick');
    if (!root || (!mo && !qa)) return;
    e.target.disabled = true;
    try {
      if (qa) { await window.stTickAction(qa.getAttribute('data-id'), qa.checked); return; }
      await saveTicks(JSON.parse(mo.getAttribute('data-keys')), mo.checked);
      paint(root);
    } catch (_err) {
      e.target.checked = !e.target.checked;
      e.target.disabled = false;
    }
  }
  function onClick(e) {
    const root = document.getElementById('strategy-root');
    const tab = e.target.closest?.('[data-cw]');
    const brief = e.target.closest?.('[data-brief]');
    if (tab && root) { activeWeek = Number(tab.getAttribute('data-cw')); paint(root); return; }
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
  window.stRepaintBoard = () => {
    const root = document.getElementById('strategy-root');
    if (root) paint(root);
  };
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
})();
