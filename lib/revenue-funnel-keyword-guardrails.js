/**
 * Keyword ownership + cannibalization guardrails for Revenue Funnel smart priorities.
 * Prevents overlapping title/rank work on the same URL and cross-page stem conflicts.
 */

const ACADEMY_OWNER_URL = 'https://www.alanranger.com/free-online-photography-course';
const COURSES_OWNER_URL = 'https://www.alanranger.com/photography-courses-coventry';

function pathname(url) {
  if (!url) return '';
  try {
    return new URL(url, 'https://www.alanranger.com').pathname.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

export function cleanUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl, 'https://www.alanranger.com');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return String(rawUrl);
  }
}

export function intentClassForUrl(url) {
  const p = pathname(url);
  if (/free-online-photography-course|free-photography-course|\/academy|online-photography-course/.test(p)) {
    return 'academy_online';
  }
  if (/coventry|photography-courses-coventry|photography-course-coventry/.test(p)) {
    return 'local_courses';
  }
  if (/near-me|workshops-near-me/.test(p)) {
    return 'local_workshops';
  }
  return 'general';
}

export function queryStem(keyword) {
  if (!keyword) return '';
  return String(keyword)
    .toLowerCase()
    .replace(/\b(online|near me|near-me|coventry|uk|free|classes|courses)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function queriesShareStem(a, b) {
  const sa = queryStem(a);
  const sb = queryStem(b);
  if (!sa || !sb || sa.length < 8) return false;
  return sa === sb;
}

function keywordFromCandidate(c) {
  if (!c || !c._rebuild) return null;
  if (c._rebuild.type === 'ctr') return (c._rebuild.args.kwInfo || {}).keyword || null;
  if (c._rebuild.type === 'rank') return c._rebuild.args.keyword || null;
  if (c._rebuild.type === 'aio') return c._rebuild.args.keyword || null;
  return null;
}

function pageUrlOf(c) {
  const pages = c.pages_affected;
  return Array.isArray(pages) && pages[0] ? cleanUrl(pages[0]) : '';
}

/** GSC-style owner: modifier in query + tier hubs, else highest-volume best_url for exact keyword. */
export function ownerUrlForKeyword(keyword, keywords) {
  if (!keyword) return null;
  const k = String(keyword).toLowerCase();
  if (/\bonline\b/.test(k) || /\bfree\b.*\bcourse\b/.test(k)) return ACADEMY_OWNER_URL;
  if (/\bcoventry\b/.test(k) || /\bnear me\b/.test(k)) return COURSES_OWNER_URL;
  let best = null;
  let bestVol = -1;
  for (const row of keywords || []) {
    if (String(row.keyword || '').toLowerCase() !== k) continue;
    const url = cleanUrl(row.best_url || '');
    const vol = Number(row.search_volume) || 0;
    if (url && vol >= bestVol) { best = url; bestVol = vol; }
  }
  return best;
}

export function safeTitleLead(url, keyword) {
  const intent = intentClassForUrl(url);
  const kw = keyword ? String(keyword) : '';
  if (intent === 'academy_online') {
    if (kw && /photography lessons/i.test(kw) && !/\bonline\b/i.test(kw)) {
      return {
        lead: 'photography lessons online',
        note: 'Academy page owns the online modifier — use "photography lessons online" in the title, not bare "photography lessons".'
      };
    }
    return { lead: kw, note: null };
  }
  if (intent === 'local_courses') {
    if (kw && /photography lessons/i.test(kw) && !/coventry/i.test(kw)) {
      return {
        lead: 'Photography Lessons in Coventry',
        note: 'Local courses page — lead with Coventry/geo. Do not add "online" (owned by the Academy URL).'
      };
    }
    return { lead: kw, note: null };
  }
  return { lead: kw, note: null };
}

function isSpecialCandidate(c) {
  const sig = String(c.signature || '');
  return sig.startsWith('academy-tier-review')
    || sig.startsWith('funnel-enquiry-to-sale')
    || sig.startsWith('merged|');
}

function mergeActions(a, b) {
  const seen = new Set();
  const out = [];
  for (const list of [a, b]) {
    for (const item of list || []) {
      const key = String(item.headline || '') + '|' + String(item.tag || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out.map((item, i) => ({ ...item, step: i + 1 }));
}

function mergePair(base, other) {
  const kw = keywordFromCandidate(base) || keywordFromCandidate(other);
  const stem = queryStem(kw);
  const slug = pathname(pageUrlOf(base)).split('/').filter(Boolean).pop() || 'page';
  const merged = {
    ...base,
    signature: `merged|${pageUrlOf(base)}|${stem || 'page'}`,
    lever_id: base.lever_id === 'rank' || other.lever_id === 'rank' ? 'rank' : base.lever_id,
    title: kw
      ? `One plan for /${slug}: "${kw}" (CTR + rank)`
      : `One plan for /${slug} (CTR + rank)`,
    merged_levers: [base.lever_id, other.lever_id].filter(Boolean),
    weighted_score: Math.max(Number(base.weighted_score) || 0, Number(other.weighted_score) || 0),
    estimated_lift_gbp_profit: Math.max(
      Number(base.estimated_lift_gbp_profit) || 0,
      Number(other.estimated_lift_gbp_profit) || 0
    ),
    estimated_lift_gbp_revenue: Math.max(
      Number(base.estimated_lift_gbp_revenue) || 0,
      Number(other.estimated_lift_gbp_revenue) || 0
    ),
    guardrail_notes: [
      'Merged into one card: same URL and shared query intent (CTR + rank were separate).'
    ],
    primary_query: kw,
    keyword_owner_url: pageUrlOf(base)
  };
  if (base._rebuild && other._rebuild) {
    merged._rebuild = base._rebuild.type === 'rank' ? base._rebuild : other._rebuild;
    merged._rebuild_secondary = base._rebuild.type === 'ctr' ? base._rebuild : other._rebuild;
  }
  return merged;
}

function mergeSamePageCandidates(list) {
  const buckets = new Map();
  const specials = [];
  for (const c of list) {
    if (isSpecialCandidate(c)) { specials.push(c); continue; }
    const url = pageUrlOf(c);
    const kw = keywordFromCandidate(c);
    const key = `${url}|${String(kw || '').toLowerCase()}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  const out = [...specials];
  for (const group of buckets.values()) {
    if (group.length === 1) {
      out.push({ ...group[0], primary_query: keywordFromCandidate(group[0]) });
      continue;
    }
    const ctrRank = group.filter(g => g.lever_id === 'ctr' || g.lever_id === 'rank');
    const rest = group.filter(g => g.lever_id !== 'ctr' && g.lever_id !== 'rank');
    if (ctrRank.length >= 2) {
      let merged = ctrRank[0];
      for (let i = 1; i < ctrRank.length; i++) merged = mergePair(merged, ctrRank[i]);
      out.push(merged);
      out.push(...rest);
    } else {
      out.push(...group.map(g => ({ ...g, primary_query: keywordFromCandidate(g) })));
    }
  }
  return out;
}

function applyOwnershipRules(list, keywords) {
  return list.map((c) => {
    if (isSpecialCandidate(c)) return c;
    const kw = keywordFromCandidate(c) || c.primary_query;
    const url = pageUrlOf(c);
    if (!kw || !url) return c;
    const owner = ownerUrlForKeyword(kw, keywords);
    const notes = Array.isArray(c.guardrail_notes) ? [...c.guardrail_notes] : [];
    const intent = intentClassForUrl(url);
    const safe = safeTitleLead(url, kw);
    if (safe.note) notes.push(safe.note);
    c = {
      ...c,
      primary_query: kw,
      page_intent: intent,
      keyword_owner_url: owner,
      safe_title_lead: safe.lead,
      guardrail_notes: notes
    };
    if (intent === 'local_courses' && /\bonline\b/i.test(kw)) {
      c.guardrail_severity = 'cannibalization';
      c.guardrail_blocked_top3 = true;
      c.guardrail_notes = [...notes, 'Do not target "online" queries on the Coventry/courses URL — Academy owns online intent.'];
      c.weighted_score = (Number(c.weighted_score) || 0) * 0.1;
    } else if (owner && owner !== url) {
      c.guardrail_severity = 'cannibalization';
      c.guardrail_blocked_top3 = true;
      c.guardrail_notes = [
        ...notes,
        `GSC best URL for "${kw}" is ${owner.replace(/^https?:\/\/[^/]+/, '')} — avoid retargeting this page.`
      ];
      c.weighted_score = (Number(c.weighted_score) || 0) * 0.12;
    }
    return c;
  });
}

export function applyKeywordGuardrails(collected, snapshot) {
  const keywords = (snapshot && snapshot.allKeywords) || [];
  let list = mergeSamePageCandidates(collected);
  list = applyOwnershipRules(list, keywords);
  list.sort((a, b) => {
    const aScore = Number(a.weighted_score) || 0;
    const bScore = Number(b.weighted_score) || 0;
    if (aScore !== bScore) return bScore - aScore;
    const aProf = Number(a.estimated_lift_gbp_profit) || 0;
    const bProf = Number(b.estimated_lift_gbp_profit) || 0;
    return bProf - aProf;
  });
  return list.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 }));
}
