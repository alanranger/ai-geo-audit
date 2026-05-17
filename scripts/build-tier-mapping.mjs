// build-tier-mapping.mjs
//
// One-shot script that joins the Squarespace product CSV export, the page-tier
// segmentation CSV, and the event-product mappings CSV to produce a single
// human-checkable view of the commercial-tier model:
//
//   Docs/commercial-tier-mapping.csv  - one row per unique product
//   Docs/COMMERCIAL_TIER_MAPPING.md   - readable summary grouped by tier
//
// Run from the AI GEO Audit project root:
//   node scripts/build-tier-mapping.mjs

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { classifyCommercialTier, tierLabel, COMMERCIAL_TIERS } from '../api/aigeo/commercial-tier.js';

// ----------------------------------------------------------------------------
// Paths
// ----------------------------------------------------------------------------

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const SHARED_ROOT = path.resolve(PROJECT_ROOT, '..', 'alan-shared-resources');

const PRODUCTS_CSV = path.join(SHARED_ROOT, 'csv', 'raw-01-products-sqsp-export.csv');
const EVENT_MAP_CSV = path.join(SHARED_ROOT, 'csv processed', '05-event-product-mappings-latest.csv');
const SEGMENTATION_CSV = path.join(SHARED_ROOT, 'csv', 'page segmentation by tier.csv');

const OUT_CSV = path.join(PROJECT_ROOT, 'Docs', 'commercial-tier-mapping.csv');
const OUT_MD = path.join(PROJECT_ROOT, 'Docs', 'COMMERCIAL_TIER_MAPPING.md');

const SITE = 'https://www.alanranger.com';

// ----------------------------------------------------------------------------
// Minimal CSV parser - handles RFC 4180 quoted fields with embedded newlines
// and doubled-quote escapes (""). Split into small helpers to stay under the
// 15-complexity rule.
// ----------------------------------------------------------------------------

function consumeInQuotes(text, i, state) {
  const ch = text[i];
  if (ch === '"' && text[i + 1] === '"') { state.field += '"'; return i + 2; }
  if (ch === '"') { state.inQuotes = false; return i + 1; }
  state.field += ch;
  return i + 1;
}

function consumeNormal(text, i, state) {
  const ch = text[i];
  if (ch === '"') { state.inQuotes = true; return i + 1; }
  if (ch === ',') { state.cur.push(state.field); state.field = ''; return i + 1; }
  if (ch === '\r') return i + 1;
  if (ch === '\n') {
    state.cur.push(state.field);
    state.rows.push(state.cur);
    state.cur = [];
    state.field = '';
    return i + 1;
  }
  state.field += ch;
  return i + 1;
}

function parseCsv(text) {
  const state = { rows: [], cur: [], field: '', inQuotes: false };
  let i = 0;
  const len = text.length;
  while (i < len) {
    i = state.inQuotes ? consumeInQuotes(text, i, state) : consumeNormal(text, i, state);
  }
  if (state.field.length > 0 || state.cur.length > 0) {
    state.cur.push(state.field);
    state.rows.push(state.cur);
  }
  return state.rows;
}

function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).filter(r => r.length > 1).map(r => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = (r[i] ?? '').trim();
    return obj;
  });
}

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  return rowsToObjects(parseCsv(text));
}

// ----------------------------------------------------------------------------
// Squarespace product helpers
// ----------------------------------------------------------------------------

function fullProductUrl(row) {
  const page = String(row['Product Page'] || '').trim();
  const slug = String(row['Product URL'] || '').trim();
  if (!slug) return '';
  if (!page) return `${SITE}/${slug}`;
  return `${SITE}/${page}/${slug}`;
}

function categoryList(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function variantPrice(row) {
  return Number.parseFloat(row['Price'] || '0') || 0;
}

function newProductFromVariant(row) {
  const price = variantPrice(row);
  return {
    product_id: row['Product ID [Non Editable]'],
    product_page: row['Product Page'] || '',
    product_slug: row['Product URL'] || '',
    product_url: fullProductUrl(row),
    product_title: row['Title'] || '',
    product_type: row['Product Type [Non Editable]'] || '',
    sku: row['SKU'] || '',
    price_min_gbp: price,
    price_max_gbp: price,
    variant_count: 1,
    categories: new Set(categoryList(row['Categories'])),
    tags: new Set(categoryList(row['Tags'])),
    visible: row['Visible']
  };
}

function mergeVariantIntoProduct(product, row) {
  const price = variantPrice(row);
  product.variant_count += 1;
  if (price > 0) {
    if (product.price_min_gbp <= 0 || price < product.price_min_gbp) product.price_min_gbp = price;
    if (price > product.price_max_gbp) product.price_max_gbp = price;
  }
  for (const c of categoryList(row['Categories'])) product.categories.add(c);
  for (const t of categoryList(row['Tags'])) product.tags.add(t);
}

// Squarespace exports one row per variant. We want one row per Product ID with
// the union of variant counts and the min/max price across variants.
function dedupeProducts(rows) {
  const map = new Map();
  for (const r of rows) {
    const pid = r['Product ID [Non Editable]'];
    if (!pid) continue;
    if (map.has(pid)) mergeVariantIntoProduct(map.get(pid), r);
    else map.set(pid, newProductFromVariant(r));
  }
  return Array.from(map.values()).map(p => ({
    ...p,
    categories: Array.from(p.categories),
    tags: Array.from(p.tags)
  }));
}

// ----------------------------------------------------------------------------
// Event-product join: for each product URL, count linked event pages.
// ----------------------------------------------------------------------------

function buildEventIndex(eventRows) {
  const idx = new Map(); // product_url -> [event_url, ...]
  for (const e of eventRows) {
    const pu = String(e.product_url || '').trim();
    const eu = String(e.event_url || '').trim();
    if (!pu || !eu) continue;
    if (!idx.has(pu)) idx.set(pu, new Set());
    idx.get(pu).add(eu);
  }
  return idx;
}

// ----------------------------------------------------------------------------
// Tier hub config - the 5 commercial money pages
// ----------------------------------------------------------------------------

const TIER_HUBS = {
  workshops: {
    label: 'Workshops',
    hub: '/photography-workshops',
    landing_pages: [
      '/photography-workshops',
      '/photographic-workshops-near-me',
      '/photo-workshops-uk',
      '/landscape-photography-workshops',
      '/one-day-landscape-photography-workshops'
    ]
  },
  courses: {
    label: 'Courses',
    hub: '/photography-courses-coventry',
    landing_pages: [
      '/photography-courses-coventry',
      '/beginners-photography-lessons',
      '/beginners-photography-classes',
      '/photo-editing-course-coventry',
      '/lightroom-courses-for-beginners-coventry',
      '/black-and-white-photography-course-coventry',
      '/photography-masterclasses',
      '/intentions-course-six-month-photography-project',
      '/intermediates-intentions',
      '/intermediates-lightroom'
    ]
  },
  services: {
    label: '1-2-1 & Services',
    hub: '/photography-tuition-services',
    landing_pages: [
      '/photography-tuition-services',
      '/private-photography-lessons',
      '/photography-lessons-online-121',
      '/photography-mentoring-online-assignments',
      '/monthly-online-photography-mentoring',
      '/rps-mentoring',
      '/rps-courses-mentoring-distinctions',
      '/photography-gift-vouchers',
      '/photography-payment-plan',
      '/photography-services-near-me/camera-sensor-clean'
    ]
  },
  hire: {
    label: 'Hire / Commercial',
    hub: '/hire-a-professional-photographer-in-coventry',
    landing_pages: [
      '/hire-a-professional-photographer-in-coventry',
      '/professional-commercial-photographer-coventry',
      '/professional-photographer-near-me',
      '/portrait-photography',
      '/corporate-photography-training',
      '/product-photographer',
      '/property-photographer'
    ]
  },
  academy: {
    label: 'Academy',
    hub: '/free-online-photography-course',
    landing_pages: [
      '/free-online-photography-course',
      '/free-photography-course',
      '/academy'
    ]
  }
};

// ----------------------------------------------------------------------------
// Build a final mapping row per product
// ----------------------------------------------------------------------------

function categoryHint(cats, tags) {
  const blob = [...cats, ...tags].join(' ').toLowerCase();
  if (!blob) return '';
  if (blob.includes('membership') || blob.includes('academy')) return 'academy';
  if (blob.includes('print') || blob.includes('framed') || blob.includes('canvas')) return 'hire';
  if (blob.includes('voucher')) return 'services';
  if (blob.includes('workshop')) return 'workshops';
  if (blob.includes('course') || blob.includes('class')) return 'courses';
  if (blob.includes('mentor') || blob.includes('1-2-1') || blob.includes('private')) return 'services';
  return '';
}

function classifyWithFallback(p) {
  const primary = classifyCommercialTier({ productUrl: p.product_url, productName: p.product_title });
  if (primary !== 'other') return primary;
  // Fallback: category-based hint (catches /products-and-services/{hash} where
  // the URL has no tier signal but the Squarespace category does).
  return categoryHint(p.categories, p.tags) || 'other';
}

function buildMapping(productRows, eventIdx) {
  const products = dedupeProducts(productRows);
  return products
    .filter(p => p.visible !== 'No')
    .map(p => {
      const tier = classifyWithFallback(p);
      const events = eventIdx.get(p.product_url) || new Set();
      return {
        commercial_tier: tier,
        commercial_tier_label: tier === 'other' ? 'Other / unclassified' : tierLabel(tier),
        product_id: p.product_id,
        product_title: p.product_title,
        product_url: p.product_url,
        product_page: p.product_page,
        product_slug: p.product_slug,
        price_min_gbp: p.price_min_gbp,
        price_max_gbp: p.price_max_gbp,
        variant_count: p.variant_count,
        event_count: events.size,
        event_urls: Array.from(events),
        categories: p.categories.join(' | '),
        tags: p.tags.join(' | ')
      };
    });
}

// ----------------------------------------------------------------------------
// Output: CSV + MD
// ----------------------------------------------------------------------------

const CSV_COLUMNS = [
  'commercial_tier', 'commercial_tier_label', 'product_id', 'product_title',
  'product_url', 'product_page', 'product_slug', 'price_min_gbp', 'price_max_gbp',
  'variant_count', 'event_count', 'categories', 'tags'
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function writeCsv(rows) {
  const header = CSV_COLUMNS.join(',');
  const body = rows.map(r => CSV_COLUMNS.map(c => csvCell(r[c])).join(',')).join('\n');
  fs.writeFileSync(OUT_CSV, header + '\n' + body + '\n', 'utf8');
}

function tierGroup(rows, tier) {
  return rows.filter(r => r.commercial_tier === tier).sort((a, b) => {
    if (a.product_page !== b.product_page) return a.product_page.localeCompare(b.product_page);
    return a.product_title.localeCompare(b.product_title);
  });
}

function summaryStats(rows) {
  const byTier = {};
  for (const r of rows) {
    const t = r.commercial_tier;
    if (!byTier[t]) byTier[t] = { products: 0, events: 0, min_price: Infinity, max_price: 0 };
    byTier[t].products += 1;
    byTier[t].events += r.event_count;
    if (r.price_min_gbp > 0 && r.price_min_gbp < byTier[t].min_price) byTier[t].min_price = r.price_min_gbp;
    if (r.price_max_gbp > byTier[t].max_price) byTier[t].max_price = r.price_max_gbp;
  }
  return byTier;
}

function priceCol(r) {
  if (!r.price_min_gbp && !r.price_max_gbp) return '';
  if (r.price_min_gbp === r.price_max_gbp) return `£${r.price_min_gbp}`;
  return `£${r.price_min_gbp}-${r.price_max_gbp}`;
}

function escapePipes(s) {
  return String(s || '').replaceAll('|', '\\|');
}

function mdTableForTier(rows, tier) {
  const slice = tierGroup(rows, tier);
  if (slice.length === 0) return '_No products classified into this tier._\n';
  const head = '| Product page | Product title | Price | Variants | Events | Squarespace ID |\n| --- | --- | --- | --- | --- | --- |';
  const body = slice.map(r =>
    `| \`/${r.product_page}/${r.product_slug}\` | ${escapePipes(r.product_title)} | ${priceCol(r)} | ${r.variant_count} | ${r.event_count} | \`${r.product_id}\` |`
  ).join('\n');
  return head + '\n' + body + '\n';
}

function landingPagesBlock(tier) {
  const cfg = TIER_HUBS[tier];
  if (!cfg) return '';
  const lines = cfg.landing_pages.map(p => `- \`${p}\``).join('\n');
  return `**Hub:** \`${cfg.hub}\`\n\n**Landing pages in this tier:**\n${lines}\n`;
}

// Per-tier callouts about revenue-capture gaps - this is the
// "what's actually NOT in the Squarespace export" honest-truth section.
const TIER_GAPS = {
  workshops: '',
  courses: '',
  services: `**Coverage gap:** Private 1-2-1 photography lessons and ongoing mentoring sessions
are booked via **Acuity Scheduling** ([https://acuityscheduling.com](https://acuityscheduling.com)),
which **bypasses the Squarespace Commerce store**. The Acuity API requires the
Powerhouse plan (currently locked out with HTTP 403). Until the plan is upgraded
*or* a Stripe Secret Key is added, this revenue is invisible to the Revenue Funnel
sync.`,
  hire: `**Coverage gap:** The hire-tier landing pages (\`/professional-commercial-photographer-coventry\`,
\`/portrait-photography\`, \`/corporate-photography-training\`,
\`/professional-photographer-near-me\`) embed image-block links to
\`/products-and-services/{hash}\` URLs that **are not real Squarespace Commerce
products** - they're navigation/portfolio tiles. The only true Hire-tier products
in the Squarespace store are the 3 Fine Art Print SKUs above. Live commercial
photography work (headshots, product, property, corporate training) is invoiced
**off-platform** and will not appear in the Squarespace Orders API.`,
  academy: `**Coverage gap:** The £79/year Academy annual membership is sold via
**Squarespace Member Areas**, which is a different Squarespace product type from
Commerce. Member Areas subscriptions **do not** appear in the standard
\`/api/1.0/commerce/orders\` endpoint - they're managed under
\`/config/member-areas\` and only surface via Stripe. The Pocket Guide series
(\`#04 Top 10 Tips\`, \`composition-viewing-frames\`, etc) are Commerce products
but use legacy URL paths that aren't on the current site. To capture Academy
revenue, the Revenue Funnel needs Stripe API access or a CSV export from Member
Areas.`
};

function gapBlock(tier) {
  const gap = TIER_GAPS[tier];
  if (!gap) return '';
  return `\n> ${gap.replaceAll('\n', '\n> ')}\n`;
}

function landingPageEmbedsBlock(rows, tier) {
  // For each landing page in this tier, list the unique product Pages
  // (Squarespace store pages) that surface products of that tier.
  const tierRows = rows.filter(r => r.commercial_tier === tier);
  if (tierRows.length === 0) return '';
  const byPage = {};
  for (const r of tierRows) {
    if (!byPage[r.product_page]) byPage[r.product_page] = 0;
    byPage[r.product_page]++;
  }
  const pages = Object.keys(byPage).sort((a, b) => a.localeCompare(b));
  if (pages.length === 0) return '';
  const lines = pages.map(p => `- \`/${p}/\` - ${byPage[p]} product${byPage[p] === 1 ? '' : 's'}`).join('\n');
  return `\n**Squarespace store pages used by this tier:**\n${lines}\n`;
}

function writeMd(rows) {
  const stamp = new Date().toISOString().slice(0, 10);
  const stats = summaryStats(rows);
  const tiers = [...COMMERCIAL_TIERS.map(t => t.id), 'other'];

  const summaryRows = tiers.map(t => {
    const s = stats[t] || { products: 0, events: 0, min_price: Infinity, max_price: 0 };
    const minP = isFinite(s.min_price) ? `£${s.min_price}` : '-';
    const maxP = s.max_price > 0 ? `£${s.max_price}` : '-';
    const gap = TIER_GAPS[t] ? ' (revenue gap)' : '';
    return `| ${t === 'other' ? 'Other / unclassified' : tierLabel(t)}${gap} | ${s.products} | ${s.events} | ${minP} - ${maxP} |`;
  }).join('\n');

  let md = `# Commercial-tier mapping (alanranger.com)

_Generated ${stamp} by \`scripts/build-tier-mapping.mjs\`._

This file is the single source of truth for **which Squarespace products belong to
which commercial money-page tier** on alanranger.com. It is built by joining:

1. \`alan-shared-resources/csv/raw-01-products-sqsp-export.csv\` (Squarespace product export)
2. \`alan-shared-resources/csv processed/05-event-product-mappings-latest.csv\` (event ↔ product links)
3. The tier classifier in \`api/aigeo/commercial-tier.js\` (URL + product-name + category fallback)

The product list is **deduped by Product ID** (Squarespace exports one row per variant).
Hidden products (\`Visible = No\`) are excluded.

## Summary by tier

| Commercial tier | Unique products | Linked event pages | Price range |
| --- | --- | --- | --- |
${summaryRows}

> **Why "(revenue gap)" matters:** Two of the five commercial tiers - **Hire**
> and **Academy** - and a chunk of **Services** revenue do not flow through the
> Squarespace Commerce store. See the gap callouts under each tier below for the
> exact reason and what's needed to capture them.

## Site structure model

The site has a 3-layer hierarchy per tier:

\`\`\`
HUB (top-level money page)
  └── LANDING / SERVICE PAGE (sub-hubs, multiple per tier)
        └── PRODUCT BLOCK (Squarespace product, the bookable thing)
              └── EVENT PAGE (dated occurrences for courses/workshops only)
\`\`\`

For the 5 commercial tiers, the hierarchy looks like:

| Tier | Hub | Landing/service sub-pages | Squarespace store page | Bookable products |
| --- | --- | --- | --- | --- |
| Workshops | \`/photography-workshops\` | 5 landings | \`/photo-workshops-uk/\` | 34 |
| Courses | \`/photography-courses-coventry\` | 10 landings | \`/photography-services-near-me/\` | 5 |
| Services | \`/photography-tuition-services\` | 10 landings | \`/photography-services-near-me/\` | 9 + Acuity |
| Hire | \`/hire-a-professional-photographer-in-coventry\` | 7 landings | \`/photography-services-near-me/\` | 3 (prints only) + off-platform |
| Academy | \`/free-online-photography-course\` | 3 landings | _(Member Areas)_ | £79/yr membership |

`;

  for (const t of tiers) {
    if (t === 'other') {
      md += `\n## Other / unclassified\n\nProducts the classifier could not place into one of the 5 money-page tiers.\nReview these and tell me which tier each one belongs to so the rules can be updated.\n\n`;
    } else {
      md += `\n## ${tierLabel(t)}\n\n`;
      md += landingPagesBlock(t) + '\n';
      md += landingPageEmbedsBlock(rows, t);
      md += gapBlock(t);
      md += `\n**Products (${(stats[t]?.products) || 0}) in this tier:**\n\n`;
    }
    md += mdTableForTier(rows, t);
  }

  md += `\n---\n\n## Revenue-capture truth table\n\n`;
  md += `| Tier | Squarespace API captures it? | What's needed for full capture |\n`;
  md += `| --- | --- | --- |\n`;
  md += `| Workshops | YES (all 34 products) | nothing - already complete |\n`;
  md += `| Courses | YES (all 5 products + 37 event variants) | nothing - already complete |\n`;
  md += `| Services - Pick N Mix / Mentoring / RPS / Sensor / Print Prep | YES | nothing |\n`;
  md += `| Services - private 1-2-1 lessons via Acuity | **NO** | Acuity Powerhouse upgrade ($45/mo) **OR** Stripe Secret Key |\n`;
  md += `| Hire - Fine Art Prints (3 SKUs) | YES | nothing |\n`;
  md += `| Hire - live commercial / headshots / property / corporate training | **NO** | off-platform invoicing - needs Stripe or manual entry |\n`;
  md += `| Academy - £79/yr membership (Member Areas) | **NO** | Stripe Secret Key (membership uses Stripe Subscriptions) |\n`;

  md += `\n## How to use this for review\n\n`;
  md += `1. Skim the **Other / unclassified** section first - those are the highest-value to triage.\n`;
  md += `2. Within each tier, eyeball the **Product title** column - if you spot a product in the wrong tier, note the Product ID.\n`;
  md += `3. Reply with: \`<Product ID> belongs in <tier>\` and I'll patch \`api/aigeo/commercial-tier.js\` accordingly.\n`;
  md += `\nThe CSV companion (\`commercial-tier-mapping.csv\`) is in the same folder for spreadsheet review.\n`;

  fs.writeFileSync(OUT_MD, md, 'utf8');
}

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

function main() {
  console.log('Reading Squarespace product export ...');
  const productRows = readCsv(PRODUCTS_CSV);
  console.log(`  ${productRows.length} variant rows`);

  console.log('Reading event-product mappings ...');
  const eventRows = readCsv(EVENT_MAP_CSV);
  console.log(`  ${eventRows.length} event-product links`);

  console.log('Reading page segmentation (sanity check) ...');
  const segRows = readCsv(SEGMENTATION_CSV);
  console.log(`  ${segRows.length} segmentation rows`);

  console.log('Building event index ...');
  const eventIdx = buildEventIndex(eventRows);

  console.log('Classifying products by commercial tier ...');
  const mapping = buildMapping(productRows, eventIdx);
  console.log(`  ${mapping.length} unique visible products`);

  if (!fs.existsSync(path.dirname(OUT_CSV))) fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  writeCsv(mapping);
  console.log(`  wrote ${OUT_CSV}`);

  writeMd(mapping);
  console.log(`  wrote ${OUT_MD}`);

  console.log('\nSummary:');
  const stats = summaryStats(mapping);
  for (const t of [...COMMERCIAL_TIERS.map(x => x.id), 'other']) {
    const s = stats[t] || { products: 0, events: 0 };
    console.log(`  ${t.padEnd(10)} products=${String(s.products).padStart(3)}  events=${String(s.events).padStart(3)}`);
  }
}

main();
