/**
 * SERP copy: ASCII-only, length-verified title/meta (150-160 meta for Seospace).
 * Hub pages get pathway-aware copy, not single-keyword rank snippets.
 */

export const TITLE_MAX = 58;
export const META_MIN = 150;
export const META_MAX = 160;
export const META_LEAD_MAX = 80;

const HUB_CURATED = {
  '/photography-courses-coventry': ['photography courses', 'photography courses coventry', 'beginner photography courses'],
  '/free-online-photography-course': ['photography lessons online', 'online photography course', 'free online photography course']
};

/** Hub landing pages: pathway list baked from live page structure. */
const HUB_SERP = {
  '/photography-courses-coventry': {
    title: 'Photography Courses Coventry - Beginners, 1-2-1, RPS',
    meta: 'Photography courses in Coventry - beginners, private 1-2-1, mentoring, RPS & free online course. Compare all paths. Book free consultation with Alan Ranger',
    h1Keep: 'Photography Courses in Coventry - Learn from a Pro',
    note: 'Hub page: lists beginners, 1-2-1, mentoring, RPS & free online course. Title/meta only — keep H1 unless repositioning.'
  },
  '/free-online-photography-course': {
    title: 'Photography Lessons Online - Free 14-Day Trial | Academy',
    meta: 'Free online photography course - 60 modules, 14-day trial. Learn camera settings, composition & editing at your pace. Start free with Alan Ranger Academy.',
    h1Keep: null,
    note: 'Academy signup page — owns "online" intent; do not retarget Coventry hub for this phrase.'
  }
};

/** Replace em/en dashes so Seospace/Squarespace length matches String.length. */
export function normalizeSerpText(s) {
  if (!s) return '';
  return String(s)
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function serpLength(s) {
  return normalizeSerpText(s).length;
}

export function pathname(url) {
  if (!url) return '';
  try {
    return new URL(url, 'https://www.alanranger.com').pathname.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

export function isHubPage(url) {
  const p = pathname(url);
  return Object.prototype.hasOwnProperty.call(HUB_SERP, p);
}

export function hubSerpPack(url) {
  return HUB_SERP[pathname(url)] || null;
}

export function pageHeadNounFromUrl(url) {
  const p = pathname(url);
  if (/free-online|online-photography-course|\/academy/.test(p)) return 'online_course';
  if (/courses-coventry|photography-courses/.test(p)) return 'courses';
  if (/lessons/.test(p)) return 'lessons';
  if (/workshops/.test(p)) return 'workshops';
  return 'generic';
}

function pagePath(cleanedUrl) {
  return pathname(cleanedUrl);
}

export function pickKeywordForPage(cleanedUrl, keywords) {
  const path = pagePath(cleanedUrl);
  const curated = [];
  for (const [hub, kws] of Object.entries(HUB_CURATED)) {
    if (path === hub || path.startsWith(hub + '/')) curated.push(...kws);
  }
  const onPage = (keywords || []).filter((k) => pagePath(k.best_url || cleanedUrl) === path);
  if (!onPage.length) return null;
  for (const ck of curated) {
    const hit = onPage.find((k) => String(k.keyword).toLowerCase() === ck);
    if (hit) return hit;
  }
  let best = null;
  let bestVol = -1;
  for (const k of onPage) {
    const v = Number(k.search_volume) || 0;
    if (v > bestVol) { best = k; bestVol = v; }
  }
  return best;
}

/** Fit meta to [META_MIN, META_MAX] after normalize; never emit over 160. */
export function fitMetaDescription(raw, min = META_MIN, max = META_MAX) {
  let s = normalizeSerpText(raw);
  if (s.length > max) {
    s = s.slice(0, max);
    const cut = s.lastIndexOf(' ', min);
    s = (cut >= min ? s.slice(0, cut) : s.slice(0, max - 1)).trimEnd() + '.';
    s = normalizeSerpText(s);
  }
  if (s.length < min) {
    for (const extra of [
      ' Book a free consultation with Alan Ranger.',
      ' View dates and book online.',
      ' Enquire today.'
    ]) {
      if (s.length >= min) break;
      if (s.length + extra.length <= max) s = normalizeSerpText(s + extra);
    }
  }
  if (s.length > max) {
    s = normalizeSerpText(s.slice(0, max));
    const cut = s.lastIndexOf(' ');
    if (cut >= min) s = s.slice(0, cut).trimEnd() + '.';
  }
  s = normalizeSerpText(s);
  return { text: s, length: s.length, valid: s.length >= min && s.length <= max };
}

export function buildHubMeta(url) {
  const pack = hubSerpPack(url);
  if (!pack || !pack.meta) return null;
  return fitMetaDescription(pack.meta);
}

export function buildHubTitle(url) {
  const pack = hubSerpPack(url);
  if (!pack || !pack.title) return null;
  const s = normalizeSerpText(pack.title);
  if (s.length > TITLE_MAX) return { text: s.slice(0, TITLE_MAX).trim(), length: TITLE_MAX, valid: false };
  return { text: s, length: s.length, valid: true };
}

function titleLeadForPage(url, rankingKw) {
  const hub = hubSerpPack(url);
  if (hub) {
    return { lead: hub.title.split(' - ')[0] || hub.title, note: hub.note, blocked: false };
  }
  const noun = pageHeadNounFromUrl(url);
  const kw = String(rankingKw || '').toLowerCase();
  if (noun === 'online_course') {
    if (kw && /lessons/.test(kw) && !/\bonline\b/.test(kw)) {
      return { lead: 'photography lessons online', note: 'Use the online modifier on the Academy URL.' };
    }
    return { lead: rankingKw || 'online photography course', note: null };
  }
  if (noun === 'courses') {
    if (/\bonline\b/.test(kw)) {
      return { lead: null, note: 'Do not target "online" on this URL - Academy owns online.', blocked: true };
    }
    return {
      lead: 'Photography Courses in Coventry',
      note: 'URL owns courses + Coventry. Do not swap to "lessons" from a volatile rank keyword.'
    };
  }
  if (noun === 'workshops') {
    return {
      lead: /workshop/i.test(kw) ? rankingKw : 'Photography Workshops',
      note: 'Workshops URL — lead with workshops, not courses or Coventry hub copy.'
    };
  }
  return { lead: rankingKw, note: null };
}

export function buildMetaSeed(url, lead, rankingKw) {
  const noun = pageHeadNounFromUrl(url);
  if (noun === 'workshops') {
    return 'Photography workshops across the West Midlands - landscape, wildlife, street and night sessions near you. Compare dates. Book your place with Alan Ranger.';
  }
  if (noun === 'courses') {
    return 'Photography courses in Coventry - beginners, private 1-2-1, mentoring, RPS & free online course. Compare all paths. Book free consultation with Alan Ranger';
  }
  if (noun === 'online_course') {
    return 'Free online photography course - 60 modules, 14-day trial. Learn camera settings and editing at your pace. Start free with Alan Ranger Academy.';
  }
  const head = normalizeSerpText(lead || rankingKw || 'Photography training');
  const kw = normalizeSerpText(rankingKw || lead || 'local courses');
  return `${head} - ${kw}. Compare options. Book a free consultation with Alan Ranger.`;
}

export function proposeTitleExample(lead, currentTitle) {
  if (!lead) return null;
  const leadN = normalizeSerpText(lead);
  const tailMatch = currentTitle && currentTitle.match(/\|\s*[^|]{8,50}$/);
  const tail = tailMatch ? normalizeSerpText(tailMatch[0]) : ' | Learn from a Pro';
  let s = normalizeSerpText(leadN + tail);
  if (s.length > TITLE_MAX) {
    const room = TITLE_MAX - tail.length - 1;
    s = normalizeSerpText(leadN.slice(0, Math.max(room, 20)).trim() + tail);
  }
  return s;
}

function metaNeedsLead(meta, leadPhrase) {
  if (!meta || !leadPhrase) return false;
  const head = normalizeSerpText(meta).slice(0, META_LEAD_MAX).toLowerCase();
  const needle = String(leadPhrase).toLowerCase().split(' ').slice(0, 3).join(' ');
  return needle.length > 4 && !head.includes(needle);
}

/** Hub meta done when 150-160ch and lists pathways + CTA (not byte-identical to template). */
export function hubMetaMeetsIntent(meta, url) {
  const len = serpLength(meta);
  if (len < META_MIN || len > META_MAX) return false;
  const s = normalizeSerpText(meta).toLowerCase();
  const p = pathname(url);
  if (p === '/photography-courses-coventry') {
    return s.includes('coventry') && s.includes('beginners')
      && (s.includes('1-2-1') || s.includes('private'))
      && s.includes('mentoring') && s.includes('rps')
      && /online/.test(s) && /consultation/.test(s)
      && !/\bor\s+online\b/i.test(s);
  }
  const pack = hubSerpPack(url);
  return !!(pack && pack.meta && s === normalizeSerpText(pack.meta).toLowerCase());
}

export function hubTitleMeetsIntent(title, url) {
  const built = buildHubTitle(url);
  if (!built || !built.valid) return false;
  const n = normalizeSerpText(title || '');
  if (n === built.text) return true;
  if (serpLength(title) > TITLE_MAX) return false;
  const s = n.toLowerCase();
  if (pathname(url) === '/photography-courses-coventry') {
    return s.includes('coventry') && s.includes('beginners')
      && (s.includes('1-2-1') || s.includes('rps')) && !/\bor\s+online\b/i.test(n);
  }
  return false;
}

function hubSerpActions(url, title, meta) {
  const hub = hubSerpPack(url);
  const titleBuilt = buildHubTitle(url);
  const metaBuilt = buildHubMeta(url);
  const actions = [];
  if (titleBuilt && titleBuilt.valid && !hubTitleMeetsIntent(title, url)) {
    actions.push({
      tag: 'title',
      confidence: 'high',
      headline: `Set SEO title (${titleBuilt.length}ch)`,
      detail: `Hub page - use exactly: "${titleBuilt.text}" (${titleBuilt.length}ch). Keep H1: "${hub.h1Keep || '(unchanged)'}". ${hub.note}`
    });
  }
  if (metaBuilt && metaBuilt.valid && !hubMetaMeetsIntent(meta, url)) {
    actions.push({
      tag: 'meta',
      confidence: 'high',
      headline: `Set SEO description (${metaBuilt.length}ch)`,
      detail: `Hub page - aim for ${META_MIN}-${META_MAX}ch: "${metaBuilt.text}" Use ASCII hyphen (-) only. ${hub.note}`
    });
  }
  return { actions, titleBuilt, metaBuilt, hub };
}

export function buildSerpCopyAdvice({ pageUrl, rankingKw, rank, searchVolume, title, meta }) {
  const url = pageUrl || '';
  if (isHubPage(url)) {
    const hubOut = hubSerpActions(url, title, meta);
    const serpComplete = hubOut.actions.length === 0;
    return {
      blocked: false,
      lead: hubOut.titleBuilt ? hubOut.titleBuilt.text : null,
      titleExample: hubOut.titleBuilt ? hubOut.titleBuilt.text : null,
      metaExample: hubOut.metaBuilt ? hubOut.metaBuilt.text : null,
      metaExampleLength: hubOut.metaBuilt ? hubOut.metaBuilt.length : null,
      h1Recommendation: hubOut.hub && hubOut.hub.h1Keep ? hubOut.hub.h1Keep : null,
      note: hubOut.hub ? hubOut.hub.note : null,
      actions: hubOut.actions,
      reasons: serpComplete
        ? ['Title and meta match the hub template — no repeat SERP edit on this URL.']
        : ['Hub landing page: copy lists all course pathways, not one rank keyword.'],
      isHub: true,
      serpComplete
    };
  }

  const { lead, note, blocked } = titleLeadForPage(url, rankingKw);
  const titleLen = serpLength(title);
  const metaLen = serpLength(meta);
  const actions = [];
  const reasons = [];

  if (blocked) {
    return { blocked: true, note, actions: [], reasons: [note] };
  }

  const example = proposeTitleExample(lead, title);
  const titleHasLead = lead && title && normalizeSerpText(title).toLowerCase()
    .includes(String(lead).toLowerCase().slice(0, 12));

  if (titleLen > TITLE_MAX) reasons.push(`Title is ${titleLen}ch (truncate risk; aim <=${TITLE_MAX}ch).`);
  if (title && /\bor\s+online\b/i.test(title) && pageHeadNounFromUrl(url) === 'courses') {
    const msg = 'Title still has "or Online" - drop from title (Academy owns online).';
    reasons.push(msg);
    if (example) {
      actions.push({
        tag: 'title',
        confidence: 'medium',
        headline: 'Surgical title edit: remove "or Online"',
        detail: `${msg} Example (${serpLength(example)}ch): "${example}"`
      });
    }
  }

  if (lead && !titleHasLead) {
    actions.push({
      tag: 'title',
      confidence: pageHeadNounFromUrl(url) === 'courses' && /lessons/i.test(String(rankingKw))
        ? 'medium'
        : 'high',
      headline: `Refine title (<=${TITLE_MAX}ch) - lead with "${normalizeSerpText(lead)}"`,
      detail: [
        title ? `Current (${titleLen}ch): "${normalizeSerpText(title)}"` : 'Current title not captured.',
        example ? `Example (${serpLength(example)}ch): "${example}"` : '',
        rank != null ? `Ranking #${rank} for "${rankingKw}" (${Number(searchVolume || 0).toLocaleString()}/mo vol).` : '',
        'Squarespace SEO title + meta only - do not change URL or H1 unless planned.',
        note || ''
      ].filter(Boolean).join(' ')
    });
  }

  let metaExample = null;
  let metaExampleLength = null;

  if (metaLen > META_MAX || metaLen < META_MIN || (meta && lead && metaNeedsLead(meta, lead))) {
    const fitted = fitMetaDescription(buildMetaSeed(url, lead, rankingKw));
    if (fitted.valid) {
      metaExample = fitted.text;
      metaExampleLength = fitted.length;
      actions.push({
        tag: 'meta',
        confidence: 'high',
        headline: `Set SEO description (${fitted.length}ch)`,
        detail: `Use exactly (${fitted.length}ch, band ${META_MIN}-${META_MAX}): "${fitted.text}" ASCII hyphen (-) only.`
      });
    } else if (metaLen > META_MAX) {
      actions.push({
        tag: 'meta',
        confidence: 'high',
        headline: `Trim meta to ${META_MIN}-${META_MAX}ch (now ${metaLen}ch)`,
        detail: 'Rewrite shorter; keep head term in first 80ch.'
      });
    }
  }

  const serpComplete = actions.length === 0 && titleHasLead && metaLen >= META_MIN && metaLen <= META_MAX;
  if (serpComplete) {
    reasons.push('Live title and meta look done for this URL — picker will skip Top 3 repeat.');
  }

  return {
    blocked: false,
    lead: lead ? normalizeSerpText(lead) : null,
    titleExample: example,
    metaExample,
    metaExampleLength,
    h1Recommendation: null,
    note,
    actions,
    reasons,
    isHub: false,
    serpComplete
  };
}
