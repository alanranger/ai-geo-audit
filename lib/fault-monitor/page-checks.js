/**
 * Per-page checks (A1–A6, B1, B2, B4, C1, C2, C3 raw). Pure: input is the
 * prefetch + render measurement, output is pass/fault results. No I/O.
 */
import { CONSOLE_NOISE, SQUARESPACE_ERROR_TEXTS, THRESHOLDS } from './monitor-config.js';
import { isSelfRedirect, urlKey } from './prefetch.js';
import {
  bodyStartsInPage, countDeep, hasType, normWords, parseJsonLd, questionLabels, sameText, truncate, typesOf, wordCount
} from './text.js';
import { extractBlogArticleText, findArticleContentStart } from './vendor/article-body-extraction.mjs';
import { extractFAQFromArticle } from './vendor/faq-extraction.mjs';

const MONEY_TYPES = new Set(['money', 'landing']);

function fault(check, url, severity, title, detail = {}) {
  return { check, url, status: 'fault', severity, title, detail };
}

function pass(check, url) {
  return { check, url, status: 'pass' };
}

function moneySeverity(pageType) {
  return pageType === 'money' ? 'red' : 'amber';
}

// ---------- A1–A3 BlogPosting ----------

function longestPosting(nodes) {
  const postings = nodes.filter((n) => hasType(n, 'BlogPosting') || hasType(n, 'NewsArticle'));
  return postings.sort((a, b) => String(b.articleBody || '').length - String(a.articleBody || '').length)[0] || null;
}

/** { full, own }: the post container text, and the same text after the title (what articleBody should be). */
function blogTexts(html, headline) {
  const art = extractBlogArticleText(html);
  if (!art.found) return null;
  const start = findArticleContentStart(art.text, headline || '');
  return { full: art.text, own: art.text.slice(Math.max(0, start)) };
}

function checkBodyLength(url, body, pageText) {
  const bodyWords = wordCount(body);
  const pageWords = wordCount(pageText);
  if (pageWords < 50 || bodyWords >= pageWords * THRESHOLDS.bodyMinRatio) return pass('A1', url);
  const pct = Math.round((bodyWords / pageWords) * 100);
  return fault('A1', url, 'red', `BlogPosting body is ${bodyWords.toLocaleString('en-GB')} words vs ${pageWords.toLocaleString('en-GB')} in the post (${pct}%)`, {
    expected: `≥ ${Math.round(THRESHOLDS.bodyMinRatio * 100)}% of ${pageWords} words`,
    found: `${bodyWords} words`,
    body_words: bodyWords,
    page_words: pageWords
  });
}

/** Either direction may line up within the window: a dropped intro fails both. */
function checkBodyStart(url, body, texts) {
  const n = THRESHOLDS.firstWords;
  const w = THRESHOLDS.firstWordsSearchWindow;
  if (bodyStartsInPage(texts.own, body, n, w) || bodyStartsInPage(body, texts.full, n, w)) return pass('A2', url);
  return fault('A2', url, 'red', 'BlogPosting body does not start where the post starts', {
    expected: truncate(texts.own, 160),
    found: truncate(body, 160)
  });
}

function checkStandIn(url, posting) {
  const body = String(posting.articleBody || '');
  const headline = posting.headline || posting.name || '';
  const bodyIsTitle = sameText(body, headline) || wordCount(body) <= THRESHOLDS.stubMaxWords;
  const descIsTitle = sameText(posting.description, headline);
  if (!bodyIsTitle && !descIsTitle) return pass('A3', url);
  const what = bodyIsTitle ? 'articleBody' : 'description';
  return fault('A3', url, 'red', `BlogPosting ${what} is just the headline`, {
    expected: 'the post text / a real summary',
    found: truncate(bodyIsTitle ? body : posting.description, 160)
  });
}

export function blogPostingChecks(url, nodes, html) {
  const posting = longestPosting(nodes);
  if (!posting) {
    return [fault('A1', url, 'red', 'No BlogPosting schema after render', { expected: 'BlogPosting with articleBody', found: 'none' }), pass('A2', url), pass('A3', url)];
  }
  const texts = blogTexts(html, posting.headline);
  if (texts == null) return [];
  const body = String(posting.articleBody || '');
  return [checkBodyLength(url, body, texts.own), checkBodyStart(url, body, texts), checkStandIn(url, posting)];
}

// ---------- A4 FAQ parity ----------

export function visibleFaqCount(measure) {
  const labelled = questionLabels(measure.faqLabels);
  const noLd = String(measure.html || '').replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, '');
  let extracted = 0;
  try { extracted = extractFAQFromArticle(noLd, '').pairs.length; } catch { extracted = 0; }
  return Math.max(labelled, extracted);
}

function largestFaqQuestions(faqNodes) {
  return faqNodes.reduce((best, n) => {
    const qs = [].concat(n.mainEntity || []).map((q) => String(q?.name || ''));
    return qs.length > best.length ? qs : best;
  }, []);
}

/** How many FAQPage questions actually appear in the rendered page text. */
function questionsOnPage(questions, bodyText) {
  const hay = normWords(bodyText).join(' ');
  return questions.filter((q) => {
    const needle = normWords(q).slice(0, 8).join(' ');
    return needle && hay.includes(needle);
  }).length;
}

export function faqParityCheck(url, pageType, nodes, measure) {
  const faqNodes = nodes.filter((n) => hasType(n, 'FAQPage'));
  const questions = largestFaqQuestions(faqNodes);
  const ldCount = questions.length;
  const visible = visibleFaqCount(measure);
  const sev = moneySeverity(pageType);
  if (!faqNodes.length) {
    return visible >= 3
      ? fault('A4', url, sev, `${visible} FAQs visible, FAQPage missing`, { expected: `FAQPage with ${visible} questions`, found: 'no FAQPage after render' })
      : pass('A4', url);
  }
  const onPage = questionsOnPage(questions, measure.bodyText);
  if (onPage < ldCount * 0.5) {
    return fault('A4', url, sev, `FAQPage has ${ldCount} questions, ${onPage} of them on the page (${visible} FAQs visible)`, {
      expected: `FAQPage = the ${visible} visible questions`, found: `stale FAQPage: ${truncate(questions.slice(0, 3).join(' | '), 160)}`
    });
  }
  if (ldCount !== visible && visible > 0) {
    return fault('A4', url, sev, `${visible} FAQs visible, FAQPage has ${ldCount}`, { expected: `FAQPage with ${visible} questions`, found: `FAQPage with ${ldCount}` });
  }
  return pass('A4', url);
}

// ---------- A5 Academy page ----------

function reviewStripCount(text) {
  const m = /from\s+(\d+)\s+reviews?/i.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

function academyMissing(nodes, reviewStripText) {
  const course = nodes.find((n) => hasType(n, 'Course'));
  if (!course) return ['Course'];
  const missing = [];
  if (countDeep(course, 'CourseInstance') < 1) missing.push('CourseInstance');
  if (countDeep(course, 'Offer') < 2) missing.push('2+ Offers');
  const rating = course.aggregateRating || nodes.find((n) => hasType(n, 'AggregateRating'));
  if (!rating) missing.push('AggregateRating');
  const strip = reviewStripCount(reviewStripText);
  if (strip == null) missing.push('visible review strip');
  const ratingCount = Number(rating?.reviewCount ?? rating?.ratingCount);
  if (rating && strip != null && ratingCount !== strip) missing.push(`review count match (strip ${strip} vs schema ${ratingCount})`);
  return missing;
}

export function academyCheck(url, nodes, measure) {
  const missing = academyMissing(nodes, measure.reviewStripText);
  if (!missing.length) return pass('A5', url);
  return fault('A5', url, 'red', `Academy page missing: ${missing.join(', ')}`, {
    expected: 'Course + CourseInstance + ≥2 Offers + AggregateRating, review strip with the same count',
    found: missing.join(', ')
  });
}

// ---------- A6 duplicates ----------

function typeKeySet(node) {
  return new Set(typesOf(node).map((t) => t.toLowerCase()).filter(Boolean));
}

function typeSetsCompatible(a, b) {
  if (!a.size || !b.size) return true;
  let aInB = true;
  let bInA = true;
  for (const t of a) if (!b.has(t)) aInB = false;
  for (const t of b) if (!a.has(t)) bInA = false;
  return aInB || bInA;
}

/** Same @id with a different @type is a conflict. Matching / subset type sets are not. */
function firstIncompatibleId(nodes) {
  const byId = new Map();
  for (const n of nodes || []) {
    const id = String(n['@id'] || '');
    if (!id) continue;
    const next = typeKeySet(n);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, next);
      continue;
    }
    if (!typeSetsCompatible(prev, next)) return id;
    if (next.size > prev.size) byId.set(id, next);
  }
  return '';
}

export function duplicateTypesCheck(url, nodes) {
  const list = nodes || [];
  const faqCount = list.filter((n) => hasType(n, 'FAQPage')).length;
  const howToCount = list.filter((n) => hasType(n, 'HowTo')).length;
  const conflictId = firstIncompatibleId(list);
  if (faqCount <= 1 && howToCount <= 1 && !conflictId) return pass('A6', url);
  const parts = [];
  if (faqCount > 1) parts.push(`${faqCount} FAQPage blocks`);
  if (howToCount > 1) parts.push(`${howToCount} HowTo blocks`);
  if (conflictId) parts.push(`@id type conflict (${truncate(conflictId, 60)})`);
  return fault('A6', url, 'amber', `Duplicate schema: ${parts.join('; ')}`, {
    expected: 'one FAQPage, one HowTo; shared @id only with matching types',
    found: parts.join('; ')
  });
}

// ---------- B1 / B2 / B4 ----------

export function noindexCheck(url, pageType, measure, prefetch, policy) {
  const robots = `${measure?.robots || ''} ${prefetch?.xRobots || ''}`.toLowerCase();
  if (!robots.includes('noindex') || policy?.intentionalNoindex) return pass('B1', url);
  return fault('B1', url, MONEY_TYPES.has(pageType) ? 'red' : 'amber', 'Page is noindex', {
    expected: 'indexable', found: truncate(robots, 120)
  });
}

export function canonicalCheck(url, measure) {
  const canonical = measure?.canonical || '';
  if (canonical && urlKey(canonical) === urlKey(url)) return pass('B2', url);
  return fault('B2', url, 'red', canonical ? 'Canonical points somewhere else' : 'No canonical tag', {
    expected: url, found: canonical || 'none'
  });
}

function pathOf(u) {
  try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return ''; }
}

function isPlannedRedirect(prefetch, policy) {
  const target = String(policy?.redirectTarget || '').replace(/\/+$/, '');
  return !!target && pathOf(prefetch.location) === target;
}

/** @returns {object|null} a B4 fault, or null when the page is served normally. */
export function statusFault(url, prefetch, policy) {
  const s = prefetch?.status;
  if (s == null || s === 429 || (s >= 200 && s < 300)) return null;
  if (s >= 300 && s < 400) {
    if (isSelfRedirect(url, prefetch.location) || isPlannedRedirect(prefetch, policy)) return null;
    return fault('B4', url, 'amber', `Redirects (${s}) to ${truncate(prefetch.location, 90)}`, { expected: '200', found: `${s} → ${prefetch.location}` });
  }
  return fault('B4', url, 'amber', `Returns ${s}`, { expected: '200', found: String(s) });
}

// ---------- C1 / C2 / C3 ----------

export function currentBlocks(measure) {
  const list = new Set(measure?.blockClasses || []);
  if ((measure?.blocks?.blog_body || 0) > 0) list.add('article.BlogItem');
  return Array.from(list).sort();
}

export function blocksCheck(url, pageType, measure, baseline) {
  const unfilled = measure?.unfilledLoaders || [];
  const now = currentBlocks(measure);
  const missing = Array.isArray(baseline) ? baseline.filter((b) => !now.includes(b)) : [];
  if (!unfilled.length && !missing.length) return pass('C1', url);
  const parts = [];
  if (missing.length) parts.push(`no longer renders: ${missing.join(', ')}`);
  if (unfilled.length) parts.push(`section loader empty: ${unfilled.join(', ')}`);
  return fault('C1', url, moneySeverity(pageType), `Block missing — ${truncate(parts.join('; '), 120)}`, {
    expected: (baseline || []).join(', ') || 'loaders filled',
    found: now.join(', ') || 'none',
    missing,
    unfilled
  });
}

export function errorTextCheck(url, measure) {
  const text = String(measure?.bodyText || '').toLowerCase();
  const hits = SQUARESPACE_ERROR_TEXTS.filter((t) => text.includes(t.toLowerCase()));
  if (!hits.length) return pass('C2', url);
  return fault('C2', url, 'red', `Squarespace error text on page: "${hits[0]}"`, { expected: 'no error text', found: hits.join(' | ') });
}

/** Site-code console errors (first line), third-party noise removed. Aggregated per run. */
export function siteCodeErrors(pageErrors) {
  const out = new Set();
  for (const e of pageErrors || []) {
    if (CONSOLE_NOISE.some((re) => re.test(e))) continue;
    out.add(String(e).split(' | ')[0].slice(0, 160));
  }
  return Array.from(out);
}

// ---------- orchestration for one page ----------

function typeChecks(ctx, nodes) {
  const { url, pageType, isAcademy, render } = ctx;
  const out = [];
  if (pageType === 'blog') out.push(...blogPostingChecks(url, nodes, render.measure.html));
  if (pageType === 'blog' || MONEY_TYPES.has(pageType)) {
    out.push(faqParityCheck(url, pageType, nodes, render.measure));
    out.push(canonicalCheck(url, render.measure));
  }
  if (isAcademy) out.push(academyCheck(url, nodes, render.measure));
  return out;
}

/**
 * @param {{ url, pageType, isAcademy, prefetch, render, policy, baseline }} ctx
 * @returns {{ results: object[], blocks: string[]|null, siteErrors: string[] }}
 */
export function runPageChecks(ctx) {
  const { url, pageType, prefetch, render, policy, baseline } = ctx;
  const b4 = statusFault(url, prefetch, policy);
  if (b4) return { results: [b4], blocks: null, siteErrors: [] };
  const results = [pass('B4', url)];
  const { nodes } = parseJsonLd(render.measure.ldTexts);
  results.push(...typeChecks(ctx, nodes));
  results.push(duplicateTypesCheck(url, nodes));
  results.push(noindexCheck(url, pageType, render.measure, prefetch, policy));
  results.push(blocksCheck(url, pageType, render.measure, baseline));
  results.push(errorTextCheck(url, render.measure));
  return { results, blocks: currentBlocks(render.measure), siteErrors: siteCodeErrors(render.pageErrors) };
}
