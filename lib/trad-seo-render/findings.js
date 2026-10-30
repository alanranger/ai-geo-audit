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

function isNoindex(render) {
  const html = `${render?.measure?.rawHtml || ''}\n${render?.measure?.html || ''}`;
  if (htmlIsNoindex(html)) return true;
  return /noindex/i.test(`${render?.measure?.robots || ''} ${render?.xRobots || ''}`);
}

export function hiddenTagFinding(url, pageType, render, inCsv, intentional) {
  const noindex = isNoindex(render);
  const listed = inCsv && inCsv.has(urlKey(url));
  const money = pageType === 'money' || pageType === 'landing';
  if (intentional) return { status: 'pass', note: 'Intentional noindex (policy)' };
  if (noindex && listed) {
    return { status: 'fail', note: 'NOINDEX in HTML and this URL is still in 06' };
  }
  if (noindex && money) {
    return { status: 'fail', note: 'Money/landing page is noindex' };
  }
  return { status: 'pass', note: noindex ? 'Hidden and not in 06' : 'Indexable' };
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
