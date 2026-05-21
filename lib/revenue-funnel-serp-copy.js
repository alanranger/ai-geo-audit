/**
 * SERP copy helpers: surgical title/meta suggestions grounded in URL intent,
 * char limits, and curated tier keywords — not blind "lead with ranking kw".
 */

const TITLE_MAX = 58;
const META_MIN = 120;
const META_MAX = 160;
const META_LEAD_MAX = 80;

const HUB_CURATED = {
  '/photography-courses-coventry': ['photography courses', 'photography courses coventry', 'beginner photography courses'],
  '/free-online-photography-course': ['photography lessons online', 'online photography course', 'free online photography course']
};

export function pathname(url) {
  if (!url) return '';
  try {
    return new URL(url, 'https://www.alanranger.com').pathname.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

/** Primary commercial noun from URL slug (stable), not volatile rank keyword. */
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

function titleLeadForPage(url, rankingKw) {
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
      return { lead: null, note: 'Do not target "online" on this URL — Academy owns online.', blocked: true };
    }
    return {
      lead: 'Photography Courses in Coventry',
      note: 'URL and tier hub own "courses + Coventry". Do not swap to "lessons" because a lower-volume rank keyword says so.'
    };
  }
  return { lead: rankingKw, note: null };
}

export function proposeTitleExample(lead, currentTitle) {
  if (!lead) return null;
  const tailMatch = currentTitle && currentTitle.match(/\|\s*[^|]{8,50}$/);
  const tail = tailMatch ? tailMatch[0] : ' | Learn from a Pro';
  let s = lead + tail;
  if (s.length > TITLE_MAX) {
    const room = TITLE_MAX - tail.length - 1;
    s = lead.slice(0, Math.max(room, 20)).trim() + tail;
  }
  return s;
}

function metaNeedsLead(meta, leadPhrase) {
  if (!meta || !leadPhrase) return false;
  const head = meta.slice(0, META_LEAD_MAX).toLowerCase();
  const needle = String(leadPhrase).toLowerCase().split(' ').slice(0, 3).join(' ');
  return needle.length > 4 && !head.includes(needle);
}

export function buildSerpCopyAdvice({ pageUrl, rankingKw, rank, searchVolume, title, meta }) {
  const { lead, note, blocked } = titleLeadForPage(pageUrl, rankingKw);
  const titleLen = title ? title.length : 0;
  const metaLen = meta ? meta.length : 0;
  const actions = [];
  const reasons = [];

  if (blocked) {
    return { blocked: true, note, actions: [], reasons: [note] };
  }

  const example = proposeTitleExample(lead, title);
  const titleHasLead = lead && title && title.toLowerCase().includes(String(lead).toLowerCase().slice(0, 12));

  if (titleLen > 60) reasons.push(`Title is ${titleLen}ch (truncate risk; aim ≤${TITLE_MAX}ch).`);
  if (title && /\bor\s+online\b/i.test(title) && pageHeadNounFromUrl(pageUrl) === 'courses') {
    const msg = 'Title still advertises "or Online" — drop it from the title (Academy owns online); mention online only in meta if needed.';
    reasons.push(msg);
    if (example) {
      actions.push({
        tag: 'title',
        confidence: 'medium',
        headline: 'Surgical title edit: remove "or Online"',
        detail: `${msg} Example without online: "${example}" (${example.length}ch).`
      });
    }
  }

  if (lead && !titleHasLead) {
    actions.push({
      tag: 'title',
      confidence: pageHeadNounFromUrl(pageUrl) === 'courses' && /lessons/i.test(String(rankingKw))
        ? 'medium'
        : 'high',
      headline: `Refine title (~${TITLE_MAX}ch) — lead with "${lead}"`,
      detail: [
        title ? `Current (${titleLen}ch): "${title}"` : 'Current title not captured.',
        example ? `Example: "${example}" (${example.length}ch).` : '',
        rank != null ? `Ranking #${rank} for "${rankingKw}" (${Number(searchVolume || 0).toLocaleString()}/mo vol).` : '',
        'Change title + meta in Squarespace only — do not change URL, H1, or body unless you run a deliberate page project.',
        note || ''
      ].filter(Boolean).join(' ')
    });
  }

  if (metaLen > META_MAX) {
    actions.push({
      tag: 'meta',
      confidence: 'high',
      headline: `Trim meta to ~${META_MAX}ch (now ${metaLen}ch)`,
      detail: 'Keep Coventry/courses in the first 80 characters; cut the tail so Google does not truncate mid-sentence.'
    });
  } else if (metaLen > 0 && metaLen < META_MIN) {
    actions.push({
      tag: 'meta',
      confidence: 'medium',
      headline: `Expand meta to ~140–${META_MAX}ch (now ${metaLen}ch)`,
      detail: `Add USP + CTA; work "${lead || rankingKw}" into the first ${META_LEAD_MAX}ch.`
    });
  } else if (meta && lead && metaNeedsLead(meta, lead)) {
    actions.push({
      tag: 'meta',
      confidence: 'medium',
      headline: 'Align meta opening (first ~80ch) with title lead',
      detail: `Meta length ${metaLen}ch is OK, but the opening does not echo "${lead}". Rewrite the first sentence only — not the whole page.`
    });
  }

  if (actions.length === 0 && titleHasLead && metaLen >= META_MIN && metaLen <= META_MAX) {
    reasons.push('Title length and meta length look acceptable; CTR lift may need FAQ/schema or SERP features, not a full rewrite.');
  }

  return {
    blocked: false,
    lead,
    titleExample: example,
    note,
    actions,
    reasons,
    usesCuratedKeyword: Boolean(
      HUB_CURATED[pathname(pageUrl)] && rankingKw
    )
  };
}
