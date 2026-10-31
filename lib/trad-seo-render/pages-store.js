import { urlKey } from '../fault-monitor/prefetch.js';
import { extractRowFromRendered } from './extract-row.js';
import { findingsFromPage } from './findings.js';

const TABLE = 'traditional_seo_render_pages';

export async function saveRenderPage(sb, ctx) {
  const html = ctx.render?.measure?.rawHtml || ctx.render?.measure?.html || '';
  const status = ctx.http || ctx.render?.status || 0;
  const htmlForIndex = `${ctx.render?.measure?.html || html}`;
  const hasNoindex = /noindex/i.test(`${ctx.render?.measure?.robots || ''} ${ctx.render?.xRobots || ''}`)
    || /category-1-page-field-checklists/i.test(htmlForIndex);
  const extract = ctx.outcome === 'checked'
    ? extractRowFromRendered(ctx.url, ctx.render?.measure?.html || html, status, {
      pageLifecycle: status === 200 ? 'live' : 'unknown',
      hasNoindex,
      contentWords: ctx.render?.measure?.contentWords
    })
    : { url: ctx.url, requestOk: false, statusCode: status, pageLifecycle: 'unknown' };
  const findings = ctx.outcome === 'checked' ? findingsFromPage({ ...ctx, extract }) : {};
  const row = {
    run_id: ctx.runId,
    url_key: urlKey(ctx.url),
    page_url: ctx.url,
    checked_at: new Date().toISOString(),
    outcome: ctx.outcome,
    reason: ctx.reason || null,
    http_status: status || null,
    extract_row: extract,
    findings,
    html_len: html.length
  };
  const { error } = await sb.from(TABLE).upsert(row, { onConflict: 'run_id,url_key' });
  if (error) throw new Error(`render_page_save:${error.message}`);
  return row;
}

export async function loadRunPages(sb, runId) {
  const out = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await sb.from(TABLE).select('*').eq('run_id', runId).range(from, from + 199);
    if (error) throw new Error(`render_page_read:${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 200) break;
  }
  return out;
}

export async function loadLatestPage(sb, url) {
  const { data, error } = await sb.from(TABLE)
    .select('*')
    .eq('url_key', urlKey(url))
    .order('checked_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`render_page_read:${error.message}`);
  return data?.[0] || null;
}
