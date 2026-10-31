import { codeBlocksIntact } from './code-blocks.js';
import { urlKey } from '../fault-monitor/prefetch.js';

const CHECK_TO_RULE = {
  A1: 'schema_body_coverage',
  A2: 'schema_body_starts_with_page',
  A3: 'schema_not_title_only',
  A4: 'faq_schema_parity',
  A5: 'academy_course_schema',
  A6: 'no_duplicate_schema',
  C1: 'key_blocks_loaded',
  C2: 'no_squarespace_error_text',
  C3: 'no_site_script_errors'
};

function htmlIsNoindex(html) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  return tags.some((tag) => /robots/i.test(tag) && /noindex/i.test(tag));
}

function isChecklistCategory(render) {
  return /category-1-page-field-checklists/i.test(
    `${render?.measure?.rawHtml || ''}\n${render?.measure?.html || ''}`
  );
}

function isNoindex(render) {
  const html = `${render?.measure?.rawHtml || ''}\n${render?.measure?.html || ''}`;
  if (htmlIsNoindex(html)) return true;
  if (isChecklistCategory(render)) return true;
  return /noindex/i.test(`${render?.measure?.robots || ''} ${render?.xRobots || ''}`);
}

export function hiddenTagFinding(url, pageType, render, inCsv, intentional) {
  const noindex = isNoindex(render);
  const listed = inCsv && inCsv.has(urlKey(url));
  const money = pageType === 'money' || pageType === 'landing';
  const checklist = isChecklistCategory(render);
  if (intentional && !noindex) {
    return { status: 'warn', note: 'Policy says hidden, page is visible' };
  }
  if (intentional || checklist) return { status: 'pass', note: 'Intentional noindex (policy)' };
  if (noindex && listed) {
    return { status: 'fail', note: 'NOINDEX in HTML and this URL is still in 06' };
  }
  if (noindex && money) {
    return { status: 'fail', note: 'Money/landing page is noindex' };
  }
  return { status: 'pass', note: noindex ? 'Hidden and not in 06' : 'Indexable' };
}

/** Collection listing pages (blog index, event hubs, store indexes): word count is not the content. */
const LISTING_PATHS = new Set([
  '/blog-on-photography', '/photographic-workshops-near-me', '/beginners-photography-lessons',
  '/photo-workshops-uk', '/photography-services-near-me'
]);

export function isListingPage(url) {
  let p = '';
  try { p = new URL(url).pathname.replace(/\/+$/, '').toLowerCase(); } catch { return false; }
  return LISTING_PATHS.has(p) || /^\/blog-on-photography\/(category|tag)\//.test(p);
}

export function thinContentFinding(url, words) {
  if (isListingPage(url)) return { status: 'pass', note: 'Listing page — exempt from word count', page_url: url };
  if (!Number.isFinite(words)) return null;
  return {
    status: words >= 300 ? 'pass' : (words >= 150 ? 'warn' : 'fail'),
    note: `Rendered content: ${words} words`,
    page_url: url
  };
}

export function findingsFromPage(ctx) {
  const out = {};
  for (const r of ctx.results || []) {
    const key = CHECK_TO_RULE[r.check];
    if (!key) continue;
    out[key] = {
      status: r.status === 'fault' ? 'fail' : 'pass',
      note: r.title || r.detail?.found || ''
    };
  }
  if (isNoindex(ctx.render)) {
    out.schema_body_starts_with_page = { status: 'na', note: 'Noindex — not scored' };
    out.schema_not_title_only = { status: 'na', note: 'Noindex — not scored' };
  }
  const thin = thinContentFinding(ctx.url, Number(ctx.extract?.seoMainWordCount));
  if (thin) out.thin_content_guardrail = thin;
  const raw = ctx.render?.measure?.rawHtml || ctx.render?.measure?.html || '';
  out.code_blocks_intact = codeBlocksIntact(raw);
  out.hidden_tag_matches_lists = hiddenTagFinding(
    ctx.url, ctx.pageType, ctx.render, ctx.inCsv, ctx.intentionalNoindex
  );
  if (ctx.siteErrors?.length) {
    out.no_site_script_errors = {
      status: 'fail',
      note: ctx.siteErrors[0]
    };
  } else if (!out.no_site_script_errors) {
    out.no_site_script_errors = { status: 'pass', note: 'No uncaught site-code errors' };
  }
  return out;
}
