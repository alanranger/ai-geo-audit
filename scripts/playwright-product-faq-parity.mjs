/**
 * Rendered live product pages: visible FAQ questions vs FAQPage questions, plus review count/rating.
 * Reads every product URL from the live products-manifest.json. Paced 16 s between pages (Squarespace 429).
 * Usage: node scripts/playwright-product-faq-parity.mjs <out.json> [url ...]
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const MANIFEST = 'https://schema.alanranger.com/products-manifest.json';
const QUESTION_SELECTORS = 'details > summary, .accordion-item__title, h2, h3, h4, strong';

async function manifestUrls() {
  const m = await fetch(`${MANIFEST}?t=${Date.now()}`).then((r) => r.json());
  return (m.entries || []).map((e) => e.url);
}

function measure(selectors) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[’]/g, "'").trim();
  const chrome = 'header, footer, nav, #ar-chat, .ar-chat, [class*="chat"]';
  const visible = new Set();
  for (const el of document.querySelectorAll(selectors)) {
    const t = norm(el.textContent);
    if (t.length > 8 && t.endsWith('?') && !el.closest(chrome)) visible.add(t.toLowerCase());
  }
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript').forEach((el) => el.remove());
  const bodyText = norm(clone.textContent).toLowerCase();
  const out = { faqPages: 0, faqQuestions: [], aggregate: [], visibleQuestions: [...visible] };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let j;
    try { j = JSON.parse(s.textContent || ''); } catch { continue; }
    for (const n of (j['@graph'] || [j])) {
      if (!n) continue;
      if ([n['@type']].flat().includes('FAQPage')) {
        out.faqPages += 1;
        out.faqQuestions.push(...[n.mainEntity].flat().filter(Boolean).map((q) => norm(q.name).toLowerCase()));
      }
      if (n.aggregateRating) out.aggregate.push(`${n.aggregateRating.reviewCount}@${n.aggregateRating.ratingValue}`);
    }
  }
  out.faqNotInPageText = out.faqQuestions.filter((q) => !bodyText.includes(q));
  return out;
}

async function readPage(page, url) {
  await page.goto(`${url}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const r = await page.evaluate(measure, QUESTION_SELECTORS);
  const faqSet = new Set(r.faqQuestions);
  return {
    ...r,
    visibleCount: r.visibleQuestions.length,
    faqCount: r.faqQuestions.length,
    faqNotVisible: r.faqQuestions.filter((q) => !r.visibleQuestions.includes(q)),
    visibleNotInFaq: r.visibleQuestions.filter((q) => !faqSet.has(q)),
  };
}

const [outFile, ...args] = process.argv.slice(2);
const pages = args.length ? args : await manifestUrls();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const rows = [];
try {
  for (let i = 0; i < pages.length; i += 1) {
    if (i) await page.waitForTimeout(16000);
    const r = await readPage(page, pages[i]);
    rows.push({ url: pages[i], ...r });
    console.log(`${i + 1}/${pages.length} ${pages[i].replace('https://www.alanranger.com', '')} | visible?=${r.visibleCount} | FAQPage=${r.faqPages} q=${r.faqCount} notInText=${r.faqNotInPageText.length} | reviews=${r.aggregate.join(',') || '-'}`);
    fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
  }
} finally {
  await browser.close();
}
