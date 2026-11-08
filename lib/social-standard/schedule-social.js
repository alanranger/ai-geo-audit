/**
 * AR-social-v1 in the Marketing schedule (browser, read-only; no DOM). Exposes window.SocialStandard.
 *  - placements: Facebook feed, Instagram feed, Instagram Story and LinkedIn are separate deliveries. Each reads ONLY
 *    its own evidence: its marketing_social_placements row (stage, provider id, live URL, actual time, evidence),
 *    else its own tick (|fb, |ig, |igs; the LinkedIn step tick), and for the Story only Story-specific evidence
 *    (an |igs tick or a history entry on the |ig tick that names the Story). Never inferred from another placement.
 *    Anything before a platform draft is "planned in app"; "scheduled on platform" needs a provider id or URL.
 *  - the step's event facts: records from GET /api/aigeo/social-standard (joined there, never copied), matched by
 *    the step's featured event / URLs and the "EVENT CARD COVERAGE" lines of GPT's brief;
 *  - caption, links per placement, readiness + missing facts; proposals for event dates no social row covers.
 */
(function () {
  const PLACEMENTS = { fbig: ['facebook_feed', 'instagram_feed', 'instagram_story'], linkedin: ['linkedin_feed'] };
  const LABEL = { facebook_feed: 'FB feed', instagram_feed: 'IG feed', instagram_story: 'IG Story', linkedin_feed: 'LinkedIn' };
  const STAGES = ['prepare', 'factual_review', 'preview_review', 'platform_draft', 'scheduled', 'published', 'live_check', 'measured'];
  const STAGE_LABEL = { prepare: 'prepare', factual_review: 'factual review', preview_review: 'preview review', platform_draft: 'platform draft', scheduled: 'scheduled on platform', published: 'published', live_check: 'live check', measured: 'measured', skipped: 'skipped' };
  const IN_APP = new Set(['prepare', 'factual_review', 'preview_review']);
  const DONE = new Set(['done', 'auto_done']);
  const SKIP = new Set(['skipped', 'not_needed']);
  const TICK_SUFFIX = { facebook_feed: '|fb', instagram_feed: '|ig', instagram_story: '|igs', linkedin_feed: '' };
  const URL_RE = /https:\/\/[^\s)"'<>]+/g;

  /* ---------- steps ---------- */

  function stepIndex(s) {
    const c = s?.campaign || {};
    const all = [...(c.weeks || []).flatMap((w) => w.steps || []), ...(c.carried?.late || []), ...(c.carried?.older || []), ...(c.carried?.future || [])];
    return new Map(all.map((st) => [st.key, st]));
  }
  /** GPT's final caption: the brief after the "DRAFT — …" line, up to "Asset:" / the delivery pack. */
  function captionOf(st) {
    const b = String(st?.brief || '');
    if (!/^DRAFT\b/.test(b)) return null;
    const body = b.split(/\n\s*\n/).slice(1).join('\n\n').split(/\n(?:Asset:|Status:|AR-SOCIAL-V1 DELIVERY PACK|EVENT CARD COVERAGE)/)[0].trim();
    return body || null;
  }
  const proposedAt = (st) => (String(st?.brief || '').match(/(?:planned|Proposed)\s+(?:\w+day\s+)?([0-9]{4}-[0-9]{2}-[0-9]{2}|\d{1,2} \w+ \d{4}),?\s+(\d{2}:\d{2})/i) || []).slice(1).join(' ') || null;
  /** "EVENT CARD COVERAGE" lines: event names and the booking URLs to verify. */
  function coverageOf(st) {
    const b = String(st?.brief || '');
    const i = b.indexOf('EVENT CARD COVERAGE');
    if (i < 0) return { names: [], urls: [] };
    const sec = b.slice(i);
    const names = [...sec.matchAll(/\n([^\n:]{3,60}):\s+\d/g)].map((m) => m[1].trim());
    const urls = [...sec.matchAll(/Source\/booking URL to verify:\s*(https:\/\/\S+)/g)].map((m) => m[1]);
    return { names, urls };
  }
  const pathOf = (u) => String(u || '').replace(/^https:\/\/www\.alanranger\.com/, '');

  /* ---------- event facts ---------- */

  function urlsOf(st) {
    const f = (st?.featured || []).flatMap((x) => [x.url, x.event_key ? x.event_key.split('|').slice(1).join('|') : null]).filter(Boolean);
    return [...new Set([...f, ...coverageOf(st).urls, ...(captionOf(st) || '').match(URL_RE) || []].map(pathOf))];
  }
  /** Facts records for a step: by booking or event URL; one URL shared by several dates picks the next date on / after the post. */
  function factsFor(st, view, day) {
    const recs = view?.facts || [];
    const out = [];
    for (const u of urlsOf(st)) {
      const hits = recs.filter((r) => pathOf(r.booking_url) === u || pathOf(r.event_url) === u).sort((a, b) => a.event_date.localeCompare(b.event_date));
      const pick = hits.find((r) => !day || r.event_date >= day) || null;
      if (pick && !out.includes(pick)) out.push(pick);
    }
    return out;
  }

  /* ---------- placements (each from its own evidence only) ---------- */

  const firstUrl = (t) => (String(t || '').match(URL_RE) || [])[0] || null;
  function storyEvidence(tick) {
    return (tick?.history || []).filter((h) => /story/i.test(`${h.action || ''} ${h.evidence || ''}`));
  }
  function fromTick(p, stepKey, s) {
    const ticks = s?.campaign?.ticks || {};
    const own = ticks[`${stepKey}${TICK_SUFFIX[p]}`];
    if (p === 'instagram_story' && !own) {
      const ev = storyEvidence(ticks[`${stepKey}|ig`]);
      return ev.length ? { stage: 'published', source: 'Story evidence on the Instagram tick', actual_at: ev[0].at, evidence: ev.map((h) => ({ kind: 'manual', at: h.at, by: h.by, text: h.evidence || h.action })) } : null;
    }
    if (!own) return null;
    if (SKIP.has(own.status)) return { stage: 'skipped', source: 'tick', evidence: [{ kind: 'manual', at: own.set_at, by: own.set_by, text: own.reason || own.status }] };
    if (own.is_ticked || DONE.has(own.status)) return { stage: 'published', source: 'tick (manual confirmation)', actual_at: own.ticked_at || own.set_at, provider_url: p === 'instagram_feed' ? firstUrl(own.reason) : null, evidence: [{ kind: 'manual', at: own.set_at, by: own.set_by, text: own.reason || 'ticked' }] };
    return null;
  }
  function fromRow(row) {
    if (!row.stage) return null;
    const verified = !!(row.provider_id || row.provider_url || (row.evidence || []).length);
    const stage = !verified && STAGES.indexOf(row.stage) >= STAGES.indexOf('scheduled') ? 'platform_draft' : row.stage;
    return { stage, source: 'placement record', provider_id: row.provider_id, provider_url: row.provider_url, actual_at: row.actual_at, planned_at: row.planned_at, evidence: row.evidence || [], assets: row.assets || {}, caption: row.caption || null };
  }
  const planFields = (row) => ({ planned_at: row?.planned_at || null, planned_tz: row?.planned_tz || null, plan_source: row?.plan_source || null });
  const appStage = (facts, caption) => (facts.length && facts.every((f) => f.ready) && caption ? 'factual_review' : 'prepare');
  /** One entry per placement of a schedule card (fbig → FB feed, IG feed, IG Story; linkedin → LinkedIn). */
  function placementsOf(x, ctx) {
    const list = PLACEMENTS[x.row];
    if (!list || !x.step_key) return [];
    const st = ctx.steps.get(x.step_key);
    const facts = factsFor(st, ctx.view, x.day);
    const caption = copyOf(x, ctx.view).public_caption;
    return list.map((p) => {
      const row = (ctx.view?.placements || []).find((r) => r.step_key === x.step_key && r.placement === p);
      const got = (row && fromRow(row)) || fromTick(p, x.step_key, ctx.s) || { stage: appStage(facts, caption), source: 'app plan', evidence: [] };
      return { placement: p, label: LABEL[p], ...got, assets: got.assets || row?.assets || {}, ...planFields(row), in_app: IN_APP.has(got.stage), stage_label: STAGE_LABEL[got.stage] || got.stage };
    });
  }

  /* ---------- planned time + purpose (structured fields only, never parsed from free text here) ---------- */

  /** The delivery's planned time: marketing_social_placements.planned_at (earliest placement), else null = needs time. */
  function planOf(x, view) {
    const rows = (view?.placements || []).filter((r) => r.step_key === x.step_key && r.planned_at).sort((a, b) => a.planned_at.localeCompare(b.planned_at));
    return rows.length ? { planned_at: rows[0].planned_at, planned_tz: rows[0].planned_tz || 'Europe/London', source: rows[0].plan_source || 'stored' } : null;
  }
  /**
   * The delivery's purpose as Strategy resolves it (one model for both tabs): the stored strategy_initiative_links tag
   * ("stored"), else the channel rule ("rule" = needs an explicit purpose).
   */
  function purposeOf(stepKey, s) {
    for (const i of Object.values(s?.quarter_plan?.initiatives || {})) {
      const d = (i.deliveries || []).find((x) => x.key === stepKey || x.alias === stepKey);
      if (d?.purpose) return { primary: d.purpose.primary, secondary: d.purpose.secondary || [], source: d.purpose_source === 'set' ? 'stored' : 'rule' };
    }
    const link = s?.quarter_plan?.links?.[`delivery|${stepKey}`];
    return link && link.source === 'set' ? { primary: null, secondary: [], source: 'stored' } : null;
  }

  /* ---------- panel data ---------- */

  const CAPTIONED = new Set(['facebook_feed', 'instagram_feed', 'linkedin_feed']);
  /**
   * The delivery's copy fields (marketing_social_placements): ONLY public_caption is the Final caption; asset
   * instructions, internal notes and platform state are shown apart and never published. The brief is never parsed here.
   */
  function copyOf(x, view) {
    const rows = (view?.placements || []).filter((r) => r.step_key === x.step_key);
    const cap = rows.find((r) => CAPTIONED.has(r.placement) && r.public_caption) || null;
    const any = cap || rows.find((r) => r.internal_notes || r.asset_instructions || r.platform_state) || {};
    return { public_caption: cap?.public_caption || null, caption_markers: cap?.caption_markers || [], asset_instructions: any.asset_instructions || null, internal_notes: any.internal_notes || null, platform_state: any.platform_state || null, caption_split: any.caption_split || null };
  }
  function urlCheck(url, view) {
    if (!url) return [false, ['no booking URL']];
    const c = view?.url_checks?.[url];
    if (!c) return [false, ['not checked yet']];
    return c.ok ? [true, []] : [false, [`${url} → ${c.status ?? c.error ?? 'no response'}`]];
  }
  /** Caption safety: a public caption exists, carries no internal marker phrase, and its booking URL resolves. */
  function copyChecks(copy, links, view) {
    const cap = copy.public_caption;
    const markers = copy.caption_markers || [];
    const [urlOk, urlDetail] = urlCheck(links.url, view);
    return [
      ['public caption stored', !!cap, cap ? [] : ['needs caption: no public caption stored (GPT writes it)']],
      ['no internal marker phrases in the caption', !!cap && !markers.length, markers.length ? [`remove: ${markers.join(', ')}`] : (cap ? [] : ['no caption to check'])],
      ['booking URL resolves', urlOk, urlDetail]
    ];
  }

  function linksOf(facts, caption) {
    const url = facts.find((f) => f.booking_url)?.booking_url || firstUrl(caption);
    const written = !!(url && caption && caption.includes(url));
    return { url, facebook_first_comment: url, instagram_written: url, instagram_written_in_caption: written, story_sticker: url, linkedin_body: url, linkedin_in_body: written };
  }
  /** A real render (a stored PNG from the render job), not any other entry in `assets` (e.g. GPT's editorial notes). */
  const rendered = (p) => Object.values(p.assets || {}).some((a) => a && a.storage_path && a.sha256);
  /** Meaningful readiness: structured plan, explicit purpose, resolved facts, caption safety, rendered asset, link quota. */
  function readinessOf(r) {
    const { facts, placements, quota, meta } = r;
    const items = [
      ['planned time stored', !!meta.plan, meta.plan ? [] : ['needs time: no planned_at stored for this delivery']],
      ['explicit purpose stored', meta.purpose?.source === 'stored', meta.purpose?.source === 'stored' ? [] : ['needs purpose: only the channel rule applies']],
      ['event facts complete', facts.length > 0 && facts.every((f) => !f.missing.length), facts.flatMap((f) => f.missing.map((m) => `${f.event_id}: ${m}`))],
      ['no contradictory facts', facts.every((f) => !f.contradictions.length), facts.flatMap((f) => f.contradictions.map((m) => `${f.event_id}: ${m}`))],
      ...copyChecks(r.copy, r.links, r.view),
      ['rendered asset present', placements.some(rendered), placements.some(rendered) ? [] : ['no rendered PNG stored: press Render']]
    ];
    if (placements.some((p) => p.placement === 'facebook_feed') && quota) items.push(['Facebook caption link available', !quota.exhausted, quota.exhausted ? [`${quota.used} of ${quota.limit} caption links used in ${quota.month}: put the link in the first comment (${quota.basis})`] : []]);
    return items.map(([label, ok, detail]) => ({ label, ok, detail }));
  }
  /** Everything the side panel shows for one social card. */
  function panelFor(x, ctx) {
    const st = ctx.steps.get(x.step_key);
    const facts = factsFor(st, ctx.view, x.day);
    const copy = copyOf(x, ctx.view);
    const placements = placementsOf(x, ctx);
    const meta = { plan: planOf(x, ctx.view), purpose: purposeOf(x.step_key, ctx.s) };
    const links = linksOf(facts, copy.public_caption);
    const readiness = readinessOf({ facts, placements, quota: ctx.view?.quota, meta, copy, links, view: ctx.view });
    return { step: st || null, facts, caption: copy.public_caption, copy, proposed_at: proposedAt(st), ...meta, coverage: coverageOf(st).names, links, placements, readiness, quota: ctx.view?.quota || null };
  }

  /* ---------- proposals for new event dates (never created) ---------- */

  const SLOT = { fbig: 2, linkedin: 3 };
  const addDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  function coveredPaths(ctx) {
    const out = new Set();
    for (const st of ctx.steps.values()) if (!String(st.key).startsWith('step|') || (st.featured || []).length) urlsOf(st).forEach((u) => out.add(u));
    for (const f of ctx.view?.facts || []) if (out.has(pathOf(f.booking_url))) out.add(pathOf(f.event_url));
    return out;
  }
  /**
   * Future events with stage moments (observed lead times: announce / main push / last places) and no social row:
   * the stages to propose, each on the existing weekly slot of its week (Tue FB+IG, Wed LinkedIn). Never created.
   */
  function proposable(m, today, covered, notStart) {
    const ev = m.event || {};
    if (!ev.date || ev.date <= today || m.week < addDays(today, -6)) return false;
    return ev.promote_mode !== 'dont_promote' && !notStart.has(ev.date) && !covered.has(ev.url);
  }
  function proposals(s, ctx, today) {
    const covered = coveredPaths(ctx);
    const notStart = new Set((ctx.view?.checks || []).filter((c) => c.date).map((c) => c.date));
    const byEvent = new Map();
    for (const m of s?.campaign?.moments || []) {
      const ev = m.event || {};
      if (!proposable(m, today, covered, notStart)) continue;
      const list = byEvent.get(ev.event_key) || byEvent.set(ev.event_key, { event: ev, stages: [] }).get(ev.event_key);
      list.stages.push({ stage: m.label || m.moment, week: m.week, fbig: addDays(m.week, SLOT.fbig - 1), linkedin: addDays(m.week, SLOT.linkedin - 1) });
    }
    return [...byEvent.values()].sort((a, b) => a.event.date.localeCompare(b.event.date));
  }

  /** Build once per paint: steps index + the social-standard view. */
  const context = (s, view) => ({ s, view, steps: stepIndex(s) });

  window.SocialStandard = { context, placementsOf, panelFor, planOf, purposeOf, proposals, captionOf, coverageOf, factsFor, LABEL, STAGES, STAGE_LABEL };
})();
