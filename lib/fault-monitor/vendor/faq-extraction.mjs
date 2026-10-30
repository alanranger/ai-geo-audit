/**
 * FAQ extraction for blog articles — shared by the browser tool (dynamic import)
 * and Node regression tests. No third-party dependencies.
 *
 * Visible formats understood (priority order in extractFAQFromArticle):
 * - arp-faq: #arp-*-faq containers with details/summary, .arp-faq-item, .faq-item (scoped), .arp-lXX-answer
 * - details: any <details><summary> whose summary is a question (faq-accordion, ar-faq, ▼ toggles)
 * - list: FAQ-section <ul><li><strong>Q?</strong> answer (❓ Frequently Asked Questions)
 * - A: FAQPage JSON-LD (skipped when live arp FAQ markup is present)
 * - B: Squarespace summary-title / summary-description blocks
 * - accordion: Squarespace accordion items whose titles are questions (?)
 * - C: FAQ section paragraphs (numbered/unnumbered <strong> Qs, or plain Q paragraphs)
 * - C-headings: h2–h4 question headings (only inside a confirmed FAQ section)
 *
 * If a visible FAQ heading exists and accepted pairs < visible questions, the result
 * sets keepExisting (callers must not delete or shrink _faq.json).
 */

const QUESTION_PREFIX_RE = /^(How|What|Why|When|Where|Which|Should|Can|Do|Does|Is|Are)\s+/i;
const CRUFT_PREFIX_RE = /^(read more|click here|learn more|find out more)\b/i;

/** Stray author byline / sign-off before end of answer (JSON-LD Strategy A). */
const FAQ_ANSWER_BYLINE_TAIL_RE =
  /\b(Alan Ranger|Alan)\b\s*[.\u2014\u2013\u2012\u2212-]?\s*(Remember|Note|See|Read|Check|Visit|Browse)\b[\s\S]*$/i;
const FAQ_ANSWER_PROMO_READ_POST_RE = /\bRead my post on\b[\s\S]*$/i;
const FAQ_ANSWER_PROMO_SEE_POST_RE = /\bSee my (?:post|guide|article) on\b[\s\S]*$/i;
const FAQ_ANSWER_PROMO_MORE_RE = /\bMore on this in\b[\s\S]*$/i;

/** Legacy in-app generic FAQ template — one match poisons the whole strategy output. */
export const KNOWN_BAD_FAQ_QUESTIONS = [
  'What is this photography technique about?',
  'How do I apply these techniques?',
  'What camera settings should I use?',
  'Do I need special equipment?',
  'How can I improve my results?',
  'Is this suitable for beginners?',
  'What are the most common mistakes to avoid?',
  'Where can I practice these techniques?'
];

const KNOWN_BAD_FAQ_QUESTION_SET = new Set(KNOWN_BAD_FAQ_QUESTIONS);

function normaliseQuestionForDenyList(q) {
  return String(q ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawPairsContainDenyListedQuestion(rawList, dbg) {
  if (!Array.isArray(rawList) || !rawList.length) return false;
  for (const raw of rawList) {
    const qn = normaliseQuestionForDenyList(raw?.question);
    if (KNOWN_BAD_FAQ_QUESTION_SET.has(qn)) {
      if (typeof dbg === 'function') {
        dbg('FAQ extraction: rejected — deny-list-match (legacy template question detected)');
      }
      return true;
    }
  }
  return false;
}

function stripTags(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]+>/g, ' ');
}

const NAMED_TEXT_ENTITIES = {
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018',
  rdquo: '\u201d', ldquo: '\u201c', pound: '\u00a3', euro: '\u20ac', times: '\u00d7'
};

function decodeBasicEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&(mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo|pound|euro|times);/gi, (_, n) => NAMED_TEXT_ENTITIES[n.toLowerCase()])
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlBlockToPlainText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n');
  s = stripTags(s);
  s = decodeBasicEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return s;
}

export function extractMainContentHtml(html) {
  if (!html) return '';
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];
  const contentMatch = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) return contentMatch[1];
  const h1Match = html.indexOf('<h1');
  const h2Match = html.indexOf('<h2');
  const contentStart = Math.min(h1Match > 0 ? h1Match : html.length, h2Match > 0 ? h2Match : html.length);
  let mainContentHtml = html.substring(contentStart);
  const footerStart = Math.floor(mainContentHtml.length * 0.8);
  mainContentHtml = mainContentHtml.substring(0, footerStart);
  return mainContentHtml;
}

/**
 * Strip stray bylines / internal promos from FAQ answers taken from JSON-LD (Strategy A).
 * Conservative: only removes known trailing patterns, not mid-sentence "Alan teaches…".
 */
export function cleanExtractedFaqAnswerText(text) {
  let s = String(text ?? '').trim();
  if (!s) return s;
  s = s.replace(FAQ_ANSWER_PROMO_READ_POST_RE, '').trimEnd();
  s = s.replace(FAQ_ANSWER_PROMO_SEE_POST_RE, '').trimEnd();
  s = s.replace(FAQ_ANSWER_PROMO_MORE_RE, '').trimEnd();
  s = s.replace(FAQ_ANSWER_BYLINE_TAIL_RE, '').trimEnd();
  s = s.replace(/[ \t\u00a0]+$/g, '');
  s = s.replace(/(?:\s*[,;:])+$/g, '');
  return s.trimEnd();
}

function collectMainEntityPairs(mainEntity, pairs) {
  const list = Array.isArray(mainEntity) ? mainEntity : mainEntity ? [mainEntity] : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = item.name || item.text;
    const ans = item.acceptedAnswer;
    let text = '';
    if (typeof ans === 'string') text = ans;
    else if (ans && typeof ans === 'object') {
      const t = ans.text;
      text = Array.isArray(t) ? t.join('\n\n') : t || '';
    }
    if (q && text) {
      const cleaned = cleanExtractedFaqAnswerText(String(text).trim());
      pairs.push({ question: String(q).trim(), answer: cleaned });
    }
  }
}

function walkJsonLdNode(node, pairs) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkJsonLdNode(n, pairs));
    return;
  }
  if (node['@graph']) walkJsonLdNode(node['@graph'], pairs);
  const types = node['@type'];
  const typeList = Array.isArray(types) ? types : [types];
  if (typeList.some((t) => String(t || '').toLowerCase() === 'faqpage')) {
    collectMainEntityPairs(node.mainEntity, pairs);
  }
}

export function extractFromJsonLdFaq(html) {
  const pairs = [];
  if (!html) return pairs;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const roots = Array.isArray(data) ? data : [data];
    for (const root of roots) walkJsonLdNode(root, pairs);
  }
  return pairs;
}

export function extractFromSquarespaceFaqBlocks(html) {
  const pairs = [];
  if (!html) return pairs;
  const re =
    /<div[^>]*class="[^"]*summary-title[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*summary-description[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const question = htmlBlockToPlainText(m[1]).replace(/\s+/g, ' ').trim();
    const answer = htmlBlockToPlainText(m[2]).trim();
    pairs.push({ question, answer });
  }
  return pairs;
}

/**
 * Squarespace accordion blocks — only items whose title is a real question (ends with ?).
 * Product detail accordions (Dates / Description) are ignored.
 */
export function extractFromSquarespaceAccordion(html) {
  const pairs = [];
  if (!html) return pairs;
  const liRe = /<li[^>]*class=["'][^"']*accordion-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[1];
    const titleMatch = block.match(/accordion-item__title[^>]*>([\s\S]*?)<\/span>/i);
    if (!titleMatch) continue;
    const question = cleanFaqQuestionText(htmlBlockToPlainText(titleMatch[1]));
    if (!question.endsWith('?')) continue;
    const descMatch = block.match(/accordion-item__description[^>]*>([\s\S]*?)<\/div>/i);
    const answer = descMatch ? htmlBlockToPlainText(descMatch[1]).trim() : '';
    if (question && answer) pairs.push({ question, answer });
  }
  return pairs;
}

/**
 * Collapsible FAQ: <details><summary>Question?</summary>answer</details>
 * Works for .faq-accordion, ar-faq, and ▼-toggle summaries. HowTo step
 * summaries without a trailing ? are ignored.
 */
export function extractFromDetailsQuestions(html) {
  const pairs = [];
  if (!html) return pairs;
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let dm;
  while ((dm = detailsRe.exec(html)) !== null) {
    const block = dm[1];
    const sum = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sum) continue;
    const h3 = sum[1].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const question = cleanFaqQuestionText(htmlBlockToPlainText(h3 ? h3[1] : sum[1]));
    if (!question.endsWith('?')) continue;
    const after = block.slice(block.indexOf(sum[0]) + sum[0].length);
    const answer = cleanFaqAnswerText(htmlBlockToPlainText(after));
    if (question && answer) pairs.push({ question, answer });
  }
  return pairs;
}

function stripFaqHeadingPrefix(text) {
  return String(text || '')
    .replace(/^[\s\u00a0]*[\u2753❓]\s*/u, '')
    .replace(/^frequently\s+asked\s+questions\s*[-–—:]?\s*/i, '')
    .replace(/^faqs?\s*[-–—:]\s*/i, '')
    .trim();
}

/**
 * ❓ / FAQ-section list: <ul><li><strong>Question?</strong> answer</li>
 */
export function extractFromFaqListItems(html) {
  const pairs = [];
  if (!html) return pairs;
  const start = findFaqSectionStart(html);
  if (start < 0) return pairs;
  const slice = html.slice(start, start + 40000);
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(slice)) !== null) {
    const inner = m[1];
    const sm = inner.match(/<strong>\s*([^<]+?\?)\s*<\/strong>/i);
    if (!sm) continue;
    const question = cleanFaqQuestionText(stripTags(sm[1]).replace(/\s+/g, ' ').trim());
    const after = inner.slice(sm.index + sm[0].length);
    const answer = cleanFaqAnswerText(htmlBlockToPlainText(after));
    if (question && answer) pairs.push({ question, answer });
  }
  return pairs;
}

function findRestatedQuestionAnswer(html, question) {
  if (!html || !question) return '';
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(html)) !== null) {
    const plain = htmlBlockToPlainText(m[1]).replace(/\s+/g, ' ').trim();
    if (!plain.toLowerCase().startsWith(question.toLowerCase())) continue;
    const rest = plain.slice(question.length).replace(/^[\s:—–-]+/, '').trim();
    if (rest.length >= 30) return rest;
  }
  return '';
}

/**
 * Visible Academy FAQ blocks:
 * - #arp-*-faq / .arp-*-faq on <section> or <div>
 * - .arp-faq-item, .faq-item (only inside arp-*-faq), .arp-lXX-answer, or <details><summary>
 * Prefer the first matching container so CSS/style copies of the id do not pollute pairs.
 */
export function cleanFaqQuestionText(q) {
  return decodeBasicEntities(String(q || ''))
    .replace(/^[\s\u00a0]*[\u2753❓]\s*/u, '')
    .replace(/^[\s\u00a0]*\?[\s\u00a0]+/, '')
    .replace(/^[\s\u00a0]*(?:Q(?:uestion)?\s*\d+\s*[:.\-)–—]\s*)/i, '')
    .replace(/^[\s\u00a0]*\d{1,2}[.)]\s+/, '')
    .replace(/^[\s\u00a0]*[\-\u2013\u2014\u2212+•·*]+\s*/u, '')
    .replace(/[\s\u00a0]*[▼▾▽▽]+[\s\u00a0]*$/u, '')
    .replace(/\?[\s\u00a0]*[+\u2212\u2013\u2014\-\u00d7\u2715▼▾▽]+[\s\u00a0]*$/u, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanFaqAnswerText(a) {
  let s = String(a || '')
    .replace(/^[\s\u00a0]*(?:A(?:nswer)?\s*\d+\s*[:.\-)–—]\s*)/i, '')
    .trim();
  return cleanExtractedFaqAnswerText(s);
}

export function pageHasVisibleArpFaq(html) {
  if (!html) return false;
  return /<(?:section|div)[^>]*(?:\bid=["']arp-[^"']*-faq["']|class=["'][^"']*arp-[^"']*faq[^"']*["'])/i.test(
    html
  );
}

/** True when body looks like FAQ cards (arp or generic .faq-item). */
function bodyHasFaqCards(body) {
  return /arp-faq-item|arp-l\d+-answer|<details[\s>]|class=["'][^"']*\bfaq-item\b/i.test(body);
}

function sliceUntilMatchingClose(html, openEnd, tagName) {
  const openTok = `<${tagName}`;
  const closeTok = `</${tagName}>`;
  const lower = html.toLowerCase();
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    const nextOpen = lower.indexOf(openTok, i);
    const nextClose = lower.indexOf(closeTok, i);
    if (nextClose < 0) return '';
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const ch = lower[nextOpen + openTok.length];
      if (ch === ' ' || ch === '>' || ch === '\n' || ch === '\r' || ch === '\t') {
        depth += 1;
        i = nextOpen + openTok.length;
        continue;
      }
      i = nextOpen + openTok.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(openEnd, nextClose);
    i = nextClose + closeTok.length;
  }
  return '';
}

function findArpFaqScope(html) {
  const openRe =
    /<(section|div)[^>]*(?:\bid=["']arp-[^"']*-faq["']|class=["'][^"']*arp-[^"']*faq[^"']*["'])[^>]*>/gi;
  let match;
  while ((match = openRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const body = sliceUntilMatchingClose(html, openRe.lastIndex, tag);
    if (bodyHasFaqCards(body)) return body;
  }
  // Loose fallback: arp-specific cards / details only — never bare .faq-item on the whole page.
  const loose =
    /class=["'][^"']*(?:arp-faq-item|arp-l\d+-answer)[^"']*["']|<details\b[^>]*>\s*<summary/i.test(
      html
    );
  return loose ? html : '';
}

function extractArpDetailsPairs(scope, pairs) {
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let dm;
  let found = 0;
  while ((dm = detailsRe.exec(scope)) !== null) {
    const block = dm[1];
    const sum = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sum) continue;
    const h3 = sum[1].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const question = cleanFaqQuestionText(htmlBlockToPlainText(h3 ? h3[1] : sum[1]));
    const after = block.slice(block.indexOf(sum[0]) + sum[0].length);
    const answer = cleanFaqAnswerText(htmlBlockToPlainText(after));
    if (question && answer) {
      pairs.push({ question, answer });
      found += 1;
    }
  }
  return found;
}

function extractArpItemPairs(scope, pairs) {
  // Inside confirmed arp-*-faq scope: .arp-faq-item, .faq-item, or .arp-lXX-answer.
  // \bfaq-item\b matches both "faq-item" and "arp-faq-item"; excludes "arp-faq-answer".
  const openRe = /<div[^>]*class=["'][^"']*(?:\bfaq-item\b|arp-l\d+-answer)[^"']*["'][^>]*>/gi;
  const opens = [];
  let om;
  while ((om = openRe.exec(scope)) !== null) {
    opens.push({ index: om.index, end: openRe.lastIndex });
  }
  for (let i = 0; i < opens.length; i++) {
    const blockEnd = i + 1 < opens.length ? opens[i + 1].index : scope.length;
    const block = scope.slice(opens[i].end, blockEnd);
    const qMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!qMatch) continue;
    const question = cleanFaqQuestionText(htmlBlockToPlainText(qMatch[1]));
    const afterH3 = block.slice(qMatch.index + qMatch[0].length);
    const answer = cleanFaqAnswerText(htmlBlockToPlainText(afterH3));
    if (question && answer) pairs.push({ question, answer });
  }
}

export function extractFromArpFaqItems(html) {
  const pairs = [];
  if (!html) return pairs;
  const scope = findArpFaqScope(html);
  if (!scope) return pairs;

  const detailsFound = extractArpDetailsPairs(scope, pairs);
  if (detailsFound >= 3) return pairs;
  if (detailsFound > 0) pairs.length = 0;

  extractArpItemPairs(scope, pairs);
  return pairs;
}

/** FAQ section headings: "FAQ(s)", "Frequently Asked Questions", "Common Questions About…", "…questions, answered". */
const FAQ_SECTION_HEADING_RE =
  /\bFAQs?\b|frequently\s+asked\s+questions|^common\s+questions\b|\bquestions,?\s+answered\b/i;

function findFaqSectionStart(html) {
  if (!html) return -1;
  // FAQ must appear in the heading text itself — not in following body copy
  // (e.g. "FAQ answer length" in a normal paragraph must not unlock C-headings).
  const headingRe = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm;
  while ((hm = headingRe.exec(html)) !== null) {
    const text = stripTags(hm[2]).replace(/\s+/g, ' ').trim();
    if (FAQ_SECTION_HEADING_RE.test(text)) return hm.index;
  }
  const strongFaq = html.match(/<strong>\s*FAQs?\b/i);
  if (strongFaq && strongFaq.index != null) return strongFaq.index;
  const low = html.toLowerCase();
  const idx = low.indexOf('frequently asked questions');
  if (idx >= 0) return idx;
  return -1;
}

const STRONG_QUESTION_RE = /<strong>\s*(?:\d+\.\s*)?([^<]+?\?)\s*<\/strong>/i;

function isFaqQuestionParagraph(inner) {
  if (STRONG_QUESTION_RE.test(inner)) return true;
  const plain = htmlBlockToPlainText(inner).replace(/\s+/g, ' ').trim();
  const cleaned = cleanFaqQuestionText(plain);
  if (!cleaned.endsWith('?') || cleaned.length < 10 || cleaned.length > 300) return false;
  if ((cleaned.match(/\?/g) || []).length !== 1) return false;
  return QUESTION_PREFIX_RE.test(cleaned);
}

function collectFollowingAnswers(paragraphs, startIdx) {
  const chunks = [];
  for (let j = startIdx; j < paragraphs.length; j++) {
    if (isFaqQuestionParagraph(paragraphs[j])) break;
    const t = htmlBlockToPlainText(paragraphs[j]).trim();
    if (t) chunks.push(t);
    if (chunks.join('\n\n').length > 1000) break;
  }
  return chunks.join('\n\n').trim();
}

/**
 * FAQ section paragraph formats used across Squarespace blog posts:
 * - <p><strong>1. Question?</strong> Answer…</p>
 * - <p><strong>Question?</strong></p><p>Answer…</p>
 * - <p>Question?</p><p>Answer…</p>
 */
function listHtmlAfter(slice, fromIndex, untilIndex) {
  const region = slice.slice(fromIndex, untilIndex);
  const um = region.match(/<ul\b[\s\S]*?<\/ul>/i);
  if (!um || um.index > 500) return '';
  return htmlBlockToPlainText(um[0]).trim();
}

export function extractFromFaqSectionParagraphs(fullHtml) {
  const pairs = [];
  const html = fullHtml || '';
  const start = findFaqSectionStart(html);
  if (start < 0) return pairs;
  const slice = html.slice(start, start + 25000);
  const paragraphs = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(slice)) !== null) {
    paragraphs.push({ inner: m[1], index: m.index, end: pRe.lastIndex });
  }

  function nextQuestionPos(fromIdx) {
    for (let k = fromIdx; k < paragraphs.length; k++) {
      if (isFaqQuestionParagraph(paragraphs[k].inner) || STRONG_QUESTION_RE.test(paragraphs[k].inner)) {
        return paragraphs[k].index;
      }
    }
    return slice.length;
  }

  const headingMatch = slice.match(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/i);
  if (headingMatch) {
    const headingText = stripTags(headingMatch[2]).replace(/\s+/g, ' ').trim();
    const hq = cleanFaqQuestionText(stripFaqHeadingPrefix(headingText));
    if (hq.endsWith('?') && hq.length >= 10 && hq.toLowerCase() !== headingText.toLowerCase()) {
      const until = nextQuestionPos(0);
      let answer = htmlBlockToPlainText(slice.slice(headingMatch[0].length, until)).trim();
      if (!answer || answer.length < 30) answer = findRestatedQuestionAnswer(html, hq);
      if (answer && answer.length >= 30) pairs.push({ question: hq, answer });
    }
  }

  for (let i = 0; i < paragraphs.length; i++) {
    const inner = paragraphs[i].inner;
    const packed = [];
    const strongRe = /<strong>\s*(?:\d+\.\s*)?([^<]+?\?)\s*<\/strong>/gi;
    let sm;
    while ((sm = strongRe.exec(inner)) !== null) {
      packed.push({ question: stripTags(sm[1]).replace(/\s+/g, ' ').trim(), index: sm.index, end: strongRe.lastIndex });
    }
    if (packed.length) {
      for (let p = 0; p < packed.length; p++) {
        const sliceEnd = p + 1 < packed.length ? packed[p + 1].index : inner.length;
        let answer = htmlBlockToPlainText(
          inner.slice(packed[p].end, sliceEnd).replace(/^\s*(?:<br\s*\/?>)+\s*/i, '')
        ).trim();
        if (!answer && packed.length === 1) {
          answer = collectFollowingAnswers(paragraphs.map((x) => x.inner), i + 1);
        }
        const until = i + 1 < paragraphs.length ? nextQuestionPos(i + 1) : slice.length;
        const listText = listHtmlAfter(slice, paragraphs[i].end, until);
        if (listText) answer = [answer, listText].filter(Boolean).join('\n\n');
        if (packed[p].question && answer) pairs.push({ question: packed[p].question, answer });
      }
      continue;
    }
    const plain = htmlBlockToPlainText(inner).replace(/\s+/g, ' ').trim();
    if (!isFaqQuestionParagraph(inner) || /<strong>/i.test(inner)) continue;
    if (/^faqs?\b/i.test(plain)) continue;
    let answer = collectFollowingAnswers(paragraphs.map((x) => x.inner), i + 1);
    const until = i + 1 < paragraphs.length ? nextQuestionPos(i + 1) : slice.length;
    const listText = listHtmlAfter(slice, paragraphs[i].end, until);
    if (listText) answer = [answer, listText].filter(Boolean).join('\n\n');
    if (plain && answer) pairs.push({ question: plain, answer });
  }
  return pairs;
}

/** @deprecated Use extractFromFaqSectionParagraphs — kept for callers/tests. */
export function extractFromNumberedFaqParagraphs(fullHtml, _mainHtml) {
  return extractFromFaqSectionParagraphs(fullHtml);
}

function isQuestionHeadingText(text) {
  if (!text || text.length < 6) return false;
  const t = text.trim();
  if (t.endsWith('?')) return true;
  return QUESTION_PREFIX_RE.test(t);
}

export function extractFromQuestionHeadings(html) {
  const pairs = [];
  if (!html) return pairs;
  // Require a confirmed FAQ section so ordinary article h2/h3 questions are excluded.
  const start = findFaqSectionStart(html);
  if (start < 0) return pairs;
  const scoped = html.slice(start);
  const headingRe = /<h([2-4])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const matches = [];
  let m;
  while ((m = headingRe.exec(scoped)) !== null) {
    matches.push({ level: +m[1], index: m.index, end: headingRe.lastIndex, inner: m[3] });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const text = cleanFaqQuestionText(stripTags(cur.inner).replace(/\s+/g, ' ').trim());
    if (!isQuestionHeadingText(text)) continue;
    if (/^faqs?\b/i.test(text) && !/\?\s*$/.test(text)) continue;
    let endPos = scoped.length;
    for (let j = i + 1; j < matches.length; j++) {
      if (matches[j].level <= cur.level) {
        endPos = matches[j].index;
        break;
      }
    }
    let segment = scoped.slice(cur.end, endPos);
    const tailIdx = segment.search(
      /BlogItem-pagination|BlogItem-meta|BlogItem-share|sqs-share-buttons|newsletter-form|sqs-block-newsletter/i
    );
    if (tailIdx >= 0) segment = segment.slice(0, segment.lastIndexOf('<', tailIdx));
    const answer = cleanFaqAnswerText(htmlBlockToPlainText(segment));
    pairs.push({ question: text, answer });
  }
  return pairs;
}

/** Long-form blog FAQ answers (e.g. best-cameras-for-beginners) run to ~1,700 chars. */
const MAX_FAQ_ANSWER_CHARS = 2000;

function validateQuestion(q) {
  const t = (q || '').replace(/\s+/g, ' ').trim();
  if (t.length < 10 || t.length > 300) return false;
  if (!t.endsWith('?')) return false;
  if ((t.match(/\?/g) || []).length !== 1) return false;
  if (t.includes('\n')) return false;
  // Numbered checklist items ("1 Does …?" or "1Does …?" from a badge span) are not FAQs.
  // Real numbered FAQs use "1. What is ISO?" — cleanFaqQuestionText already stripped those.
  if (/^\d+\s/.test(t) || /^\d+[A-Za-z]/.test(t)) return false;
  const before = t.slice(0, -1);
  if (before.includes('. ')) return false;
  return true;
}

function validateAnswer(a, q) {
  if (!a) return false;
  if (/<script|<style/i.test(a)) return false;
  const t = a.trim();
  if (t.length < 30 || t.length > MAX_FAQ_ANSWER_CHARS) return false;
  if (CRUFT_PREFIX_RE.test(t)) return false;
  if (t.toLowerCase() === (q || '').toLowerCase()) return false;
  return true;
}

function normalizeAnswerWhitespace(a) {
  const lines = String(a).split('\n').map((line) => line.replace(/\s+/g, ' ').trim());
  return lines.filter(Boolean).join('\n\n').trim();
}

export function validateAndDedupePairs(pairs, debugLog) {
  const seen = new Set();
  const out = [];
  for (const raw of pairs) {
    let q = cleanFaqQuestionText(raw.question || '');
    let a = normalizeAnswerWhitespace(cleanFaqAnswerText(raw.answer || ''));
    if (!validateQuestion(q)) {
      if (debugLog) debugLog(`Pair dropped: question failed validation — ${q.slice(0, 70)}`);
      continue;
    }
    if (!validateAnswer(a, q)) {
      if (debugLog) debugLog(`Pair dropped: answer failed validation — ${q.slice(0, 70)}`);
      continue;
    }
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question: q, answer: a });
  }
  return out;
}

function addVisibleQuestion(seen, raw) {
  const q = cleanFaqQuestionText(raw || '');
  if (!validateQuestion(q)) return;
  seen.add(q.toLowerCase());
}

/** Count on-page FAQ questions (details summaries, list items, section paragraphs, FAQ heading-as-Q). */
export function countVisibleFaqQuestions(html) {
  const seen = new Set();
  if (!html) return 0;
  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let dm;
  while ((dm = detailsRe.exec(html)) !== null) {
    const sum = dm[1].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sum) continue;
    addVisibleQuestion(seen, htmlBlockToPlainText(sum[1]));
  }
  const start = findFaqSectionStart(html);
  if (start >= 0) {
    const slice = html.slice(start, start + 40000);
    const headingMatch = slice.match(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (headingMatch) {
      const ht = stripTags(headingMatch[2]).replace(/\s+/g, ' ').trim();
      const hq = cleanFaqQuestionText(stripFaqHeadingPrefix(ht));
      if (
        hq.endsWith('?') &&
        hq.toLowerCase() !== ht.toLowerCase() &&
        findRestatedQuestionAnswer(html, hq)
      ) {
        addVisibleQuestion(seen, hq);
      }
    }
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let lm;
    while ((lm = liRe.exec(slice)) !== null) {
      const sm = lm[1].match(/<strong>\s*([^<]+?\?)\s*<\/strong>/i);
      if (sm) addVisibleQuestion(seen, sm[1]);
    }
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = pRe.exec(slice)) !== null) {
      const strongRe = /<strong>\s*(?:\d+\.\s*)?([^<]+?\?)\s*<\/strong>/gi;
      let sm;
      while ((sm = strongRe.exec(pm[1])) !== null) addVisibleQuestion(seen, sm[1]);
    }
  }
  return seen.size;
}

/**
 * @param {string} html
 * @param {string} articleBody
 * @param {function|null} debugLog
 * @returns {{ strategy: string, pairs: {question:string, answer:string}[], extractedCount: number, acceptedCount: number, visibleCount?: number, visibleFaqFailed?: boolean, keepExisting?: boolean, shortfall?: boolean }}
 */
export function extractFAQFromArticle(html, articleBody = '', debugLog = null) {
  const dbg = (msg) => {
    if (typeof debugLog === 'function') debugLog(msg);
  };
  const sourceHtml = html || '';

  dbg(`FAQ extraction: HTML length ${sourceHtml.length}, articleBody length ${(articleBody || '').length}`);

  if (!sourceHtml.trim() && !(articleBody || '').trim()) {
    dbg('FAQ extraction: aborted — empty HTML and article body');
    return { strategy: 'none', pairs: [], extractedCount: 0, acceptedCount: 0, visibleCount: 0 };
  }

  const primaryHtml = sourceHtml.trim() ? sourceHtml : '';
  const mainHtml = extractMainContentHtml(primaryHtml);
  const hasVisibleArp = pageHasVisibleArpFaq(primaryHtml);
  const hasVisibleFaqSection = findFaqSectionStart(primaryHtml) >= 0;
  const visibleCount = countVisibleFaqQuestions(primaryHtml);
  dbg(`FAQ extraction: visible question count ${visibleCount}`);

  const withShortfall = (result) => {
    if (!result) return null;
    result.visibleCount = visibleCount;
    if ((hasVisibleFaqSection || hasVisibleArp) && visibleCount > result.pairs.length) {
      dbg(
        `FAQ extraction: shortfall ${result.pairs.length}/${visibleCount} — keep existing file, do not shrink`
      );
      result.keepExisting = true;
      result.shortfall = true;
    }
    return result;
  };

  const run = (strategyLabel, rawList) => {
    if (rawPairsContainDenyListedQuestion(rawList, dbg)) {
      dbg(`${strategyLabel}: rejected — deny-list-match`);
      return null;
    }
    const extractedCount = rawList.length;
    const pairs = validateAndDedupePairs(rawList, dbg);
    dbg(`${strategyLabel}: ${extractedCount} raw pair(s), ${pairs.length} passed validation`);
    if (pairs.length >= 3) {
      dbg(
        `${strategyLabel} succeeded (preview question: ${pairs[0].question.slice(0, 96)}${pairs[0].question.length > 96 ? '…' : ''})`
      );
      return withShortfall({ strategy: strategyLabel, pairs, extractedCount, acceptedCount: pairs.length });
    }
    return null;
  };

  const visibleFail = (strategy) => {
    dbg('FAQ extraction: visible FAQ found but pairs do not match — keep existing file');
    return {
      strategy,
      pairs: [],
      extractedCount: 0,
      acceptedCount: 0,
      visibleCount,
      visibleFaqFailed: true,
      keepExisting: true
    };
  };

  // Prefer visible Academy FAQ markup over stale injected JSON-LD / heading scans.
  let r = run('arp-faq', extractFromArpFaqItems(primaryHtml));
  if (r) return r;

  // Visible arp-*-faq present but no valid pairs: fail hard — do not fall back to JSON-LD.
  if (hasVisibleArp) {
    dbg('A skipped — visible arp-*-faq section present; refusing stale JSON-LD FAQPage');
    return visibleFail('arp-faq-failed');
  }

  r = run('details', extractFromDetailsQuestions(primaryHtml));
  if (r) return r;
  r = run('list', extractFromFaqListItems(primaryHtml));
  if (r) return r;

  if (hasVisibleFaqSection) {
    dbg('A skipped — visible FAQ section heading present; using on-page questions only');
    r = run('C', extractFromFaqSectionParagraphs(primaryHtml));
    if (r) return r;
    r = run('C-headings', extractFromQuestionHeadings(primaryHtml || mainHtml));
    if (r) return r;
    r = run('accordion', extractFromSquarespaceAccordion(primaryHtml));
    if (r) return r;
    return visibleFail('visible-faq-failed');
  }

  r = run('A', extractFromJsonLdFaq(primaryHtml));
  if (r) return r;
  r = run('B', extractFromSquarespaceFaqBlocks(primaryHtml));
  if (r) return r;
  r = run('accordion', extractFromSquarespaceAccordion(primaryHtml));
  if (r) return r;
  r = run('C', extractFromFaqSectionParagraphs(primaryHtml));
  if (r) return r;
  r = run('C-headings', extractFromQuestionHeadings(primaryHtml || mainHtml));
  if (r) return r;

  dbg('FAQ extraction: no strategy returned 3+ valid pairs');
  return { strategy: 'none', pairs: [], extractedCount: 0, acceptedCount: 0, visibleCount };
}
