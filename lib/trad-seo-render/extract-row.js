import { analyzeTraditionalSeoHtmlSignals } from '../../api/aigeo/content-extractability.js';
import { extractHtmlCanonicalFromHtml } from '../traditional-seo-canonical-rule.js';
import { extractBlogArticleText } from '../fault-monitor/vendor/article-body-extraction.mjs';

const NAMED = {
  amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026'
};

function decodeEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);
}

function titlePlain(html) {
  const m = String(html || '').match(/<title[^>]*>([^<]*)/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function introSnippet(html) {
  const text = decodeEntities(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
  return text.split(' ').slice(0, 150).join(' ');
}

function mainWordCount(html) {
  const article = extractBlogArticleText(html);
  if (article.found && article.words > 0) return article.words;
  const text = decodeEntities(String(html || '')
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(header|nav|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
  return text.split(/\s+/).filter(Boolean).length;
}

export function extractRowFromRendered(url, html, statusCode, extra = {}) {
  const seo = analyzeTraditionalSeoHtmlSignals(html, url);
  const canonical = extractHtmlCanonicalFromHtml(String(html || ''), url);
  const title = titlePlain(html);
  return {
    url,
    requestOk: Number(statusCode) === 200,
    statusCode: Number(statusCode) || 0,
    pageLifecycle: extra.pageLifecycle || (Number(statusCode) === 200 ? 'live' : 'unknown'),
    htmlLength: String(html || '').length,
    seoH1Count: seo.h1Count,
    seoFirstH1Length: seo.firstH1PlainLength,
    seoLongestH1Length: seo.longestH1PlainLength,
    seoFirstH1Plain: seo.firstH1PlainText || '',
    seoPrimaryH1Plain: seo.primaryH1PlainText || seo.firstH1PlainText || '',
    seoMetaDescription: seo.metaDescription || '',
    seoTitleTagLength: title.length,
    seoTitlePlain: title,
    seoIntroSnippet: introSnippet(html),
    seoMainWordCount: Number(extra.contentWords) > 0 ? Number(extra.contentWords) : mainWordCount(html),
    seoImgTotal: seo.imgTotal,
    seoImgMissingAlt: seo.imgMissingAlt,
    seoImgDecorativeExcluded: seo.imgDecorativeExcluded,
    seoInternalLinks: seo.internalLinkCount,
    seoInternalLinkTargets: seo.internalLinkTargets || [],
    seoExtOutbound: seo.extOutboundCount,
    seoExtMissingTargetBlank: seo.extMissingTargetBlank,
    seoCanonicalHref: canonical.seoCanonicalHref || '',
    seoCanonicalRaw: canonical.seoCanonicalRaw || '',
    seoCanonicalCount: Number(canonical.seoCanonicalCount) || 0,
    seoCanonicalBodyHref: canonical.seoCanonicalBodyHref || '',
    seoCanonicalBodyRaw: canonical.seoCanonicalBodyRaw || '',
    seoCanonicalBodyCount: Number(canonical.seoCanonicalBodyCount) || 0,
    hasNoindex: extra.hasNoindex === true
  };
}
