// Vendored copy of Schema Tools scripts/article-body-extraction.mjs (v1.5.19). Keep in sync: the monitor must measure pages exactly as the generator does.
/**
 * BlogPosting articleBody extraction — shared by index.html (web + desktop) and the Node tests.
 *
 * Primary source: the post's own content container (Squarespace `<article class="BlogItem …">`)
 * minus title/meta/share/comments/pagination/newsletter and any script/style. The whole-page
 * text path is only a fallback, and must never publish a title-only body.
 */

const NAMED_ENTITIES = {
  amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018',
  rdquo: '\u201d', ldquo: '\u201c', laquo: '\u00ab', raquo: '\u00bb', pound: '\u00a3', euro: '\u20ac',
  times: '\u00d7', divide: '\u00f7', middot: '\u00b7', bull: '\u2022', rarr: '\u2192', larr: '\u2190',
  harr: '\u2194', uarr: '\u2191', darr: '\u2193', deg: '\u00b0', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', sup2: '\u00b2', plusmn: '\u00b1',
  eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0', ouml: '\u00f6', uuml: '\u00fc', auml: '\u00e4', ccedil: '\u00e7'
};

const STRIP_BLOCK_CLASS_RE =
  /\b(?:BlogItem-title|Blog-meta|BlogItem-meta|BlogItem-share|BlogItem-comments|BlogItem-pagination|sqs-block-newsletter|newsletter-block|sqs-share-buttons)\b/;

const BLOCK_TAGS = ['div', 'section', 'nav', 'footer', 'aside', 'header', 'h1', 'ul'];

/** Assignment-style headings only (uppercase); ordinary "before you…" / "This guide…" prose never counts. */
const CONTENT_START_MARKER_RE =
  /(LEARNING OBJECTIVES|THE ASSIGNMENT|BEFORE YOU START|TECHNICAL FOCUS|CREATIVE FOCUS|ASSIGNMENT TASKS|DO\s*\/\s*DON'T|REFLECTION QUESTIONS)/;

export function decodeEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

export function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function sliceEndOfElement(html, openEnd, tagName) {
  const lower = html.toLowerCase();
  const openTok = `<${tagName}`;
  const closeTok = `</${tagName}>`;
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    const nextClose = lower.indexOf(closeTok, i);
    if (nextClose < 0) return html.length;
    const nextOpen = lower.indexOf(openTok, i);
    if (nextOpen >= 0 && nextOpen < nextClose && /[\s>/]/.test(lower[nextOpen + openTok.length] || '')) {
      depth += 1;
      i = nextOpen + openTok.length;
      continue;
    }
    depth -= 1;
    i = nextClose + closeTok.length;
  }
  return i;
}

function removeBlocksByClass(html, classRe) {
  const openRe = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b[^>]*\\bclass=["']([^"']*)["'][^>]*>`, 'gi');
  let out = html;
  let m;
  openRe.lastIndex = 0;
  while ((m = openRe.exec(out)) !== null) {
    if (!classRe.test(m[2])) continue;
    const end = sliceEndOfElement(out, m.index + m[0].length, m[1].toLowerCase());
    out = out.slice(0, m.index) + ' ' + out.slice(end);
    openRe.lastIndex = m.index;
  }
  return out;
}

/** Inner HTML of the blog post `<article>`. Custom code blocks can nest their own <article> elements. */
export function extractBlogArticleHtml(html) {
  if (!html) return '';
  const m = html.match(/<article\b[^>]*\bclass=["'][^"']*\bBlogItem\b[^"']*["'][^>]*>/i) || html.match(/<article\b[^>]*>/i);
  if (!m) return '';
  const start = m.index + m[0].length;
  const afterClose = sliceEndOfElement(html, start, 'article');
  const end = html.toLowerCase().lastIndexOf('</article>', afterClose);
  return end > start ? html.slice(start, end) : '';
}

export function htmlFragmentToText(fragment) {
  let s = String(fragment || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // <svg> is kept: infographics carry real text; icon sprites contain only paths.
  s = s.replace(/<(script|style|noscript|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  s = removeBlocksByClass(s, STRIP_BLOCK_CLASS_RE);
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/\bTable of Contents\s+Show\b/gi, ' ').replace(/\bView fullsize\b/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Article text from the post container: { text, words, found }.
 * found=true with words≈0 means the post genuinely has no body text (e.g. a PDF-download checklist).
 */
export function extractBlogArticleText(html) {
  const fragment = extractBlogArticleHtml(html);
  if (!fragment) return { text: '', words: 0, found: false };
  const text = htmlFragmentToText(fragment);
  return { text, words: countWords(text), found: true };
}

/** PDF/iframe checklist posts: derive articleBody from the embed, never from page chrome. */
export function extractEmbedFallbackText(html, title) {
  const fragment = extractBlogArticleHtml(html);
  if (!fragment) return '';
  const iframe = fragment.match(/<iframe[^>]*\bsrc=["']([^"']+)["']/i);
  if (iframe) {
    let src = iframe[1];
    try { src = decodeURIComponent(src); } catch { /* keep */ }
    const file = (src.match(/([^/?#]+\.pdf)/i) || [])[1] || '';
    const name = file.replace(/_/g, ' ').replace(/\.pdf$/i, '').replace(/\+/g, ' ').trim();
    if (name) {
      const label = String(title || name).trim();
      return `${label}. 1-page field checklist PDF.`;
    }
  }
  const comment = fragment.match(/<!--\s*([^<>]{8,140}?)\s*-->/);
  if (comment) {
    const t = comment[1].replace(/\s+/g, ' ').trim();
    if (t && !/script|style/i.test(t)) return t;
  }
  return '';
}

/**
 * Text-path fallback: index where the article starts in whole-page text.
 * A title match at index 0 counts as found (the old `> 0` check treated it as missing and fell
 * through to case-insensitive "before you…" / "This guide…" markers, cutting intros).
 */
export function findArticleContentStart(text, title) {
  const s = String(text || '');
  const head = s.slice(0, 2000);
  const t = String(title || '').trim();
  if (t) {
    const at = head.toUpperCase().indexOf(t.toUpperCase());
    if (at >= 0) return at + t.length;
  }
  const marker = head.match(CONTENT_START_MARKER_RE);
  return marker ? marker.index : 0;
}

/** Whether a generated WebPage/BlogPosting may be saved/published. */
export function blogPostingSaveDecision({ htmlFetched, bodySource, articleWords, pageWords }) {
  if (!htmlFetched) return { save: false, reason: 'page HTML could not be fetched' };
  if (bodySource === 'title-fallback') return { save: false, reason: 'articleBody fell back to the page title' };
  if (bodySource === 'embed') return { save: true, reason: '' };
  if (articleWords < 100 && pageWords > 300) {
    return { save: false, reason: `articleBody has ${articleWords} words but the page has ${pageWords}` };
  }
  return { save: true, reason: '' };
}
