// Phase C / C2 part 2 smoke test for per-product breakdown endpoint.
//
//   node scripts/c2-breakdown-smoke.mjs <page-slug>
//     defaults: private-photography-lessons, then landscape-photography-workshops

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import handler from '../api/aigeo/revenue-funnel-product-breakdown.js';

const PAGES = process.argv.length > 2
  ? process.argv.slice(2)
  : ['private-photography-lessons', 'landscape-photography-workshops', 'photography-workshops'];

function makeRes() {
  const out = { statusCode: null, headers: {}, body: null };
  return {
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
    _out: out
  };
}

async function runOne(page) {
  console.log(`\n===== ${page} =====`);
  const res = makeRes();
  await handler({ method: 'GET', query: { page, includeJlr: 'false', windowMonths: '17' } }, res);
  if (res._out.statusCode !== 200) {
    console.error('FAILED status:', res._out.statusCode, 'body:', res._out.body);
    return;
  }
  const p = res._out.body;
  console.log(JSON.stringify({
    page_slug: p.page_slug,
    page_seasonality_class: p.page_seasonality_class,
    products_on_page: p.products_on_page,
    totals: p.totals
  }, null, 2));
  console.log('\nProducts (top by lifetime non-JLR revenue):');
  for (const r of p.products) {
    console.log('  -', JSON.stringify({
      title: r.product_title,
      seasonality_type: r.seasonality_type,
      event_months: r.event_months,
      lifetime_nonjlr: r.lifetime_revenue_nonjlr,
      lifetime_total: r.lifetime_revenue_total,
      window_nonjlr: r.window_revenue_nonjlr,
      txn_count_lifetime: r.lifetime_txn_count,
      extends_before_window: r.extends_before_window
    }));
  }
}

for (const slug of PAGES) {
  try { await runOne(slug); } catch (err) { console.error('FATAL:', slug, err); }
}
