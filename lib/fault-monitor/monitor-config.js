/**
 * Silent fault monitor — every tunable list in one place.
 * A new injected widget or a noisy third-party script is a one-line change here.
 */

export const SITE_ORIGIN = 'https://www.alanranger.com';

export const GOOGLEBOT_SMARTPHONE_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/131.0.6778.204 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/** UI injected by site scripts that is not part of the post's own text. */
export const INJECTED_UI_SELECTORS = [
  '#ar-bookmark-widget',
  '.reading-time',
  '#ar-lesson-member-strip',
  '.ar-lesson-signup-cta',
  '#ar-module-footer-cta',
  '.ar-toc',
  '#ar-toc',
  '.table-of-contents',
  '[data-wm-plugin="load"]'
];

/** Visible text that means a Squarespace block or code block is broken. */
export const SQUARESPACE_ERROR_TEXTS = [
  'needs a storage option',
  'This block contains embedded code that has been disabled',
  'Script Disabled',
  'Something went wrong'
];

/** Console errors matching any of these are third-party noise, not site code. */
export const CONSOLE_NOISE = [
  /ResizeObserver loop/i,
  /googletagmanager|google-analytics|gtag|doubleclick/i,
  /facebook|fbevents|hotjar|clarity\.ms|tiktok|pinterest/i,
  /Script error\.?$/i,
  /Failed to load resource/i,
  /assets\.squarespace\.com|static1\.squarespace\.com|squarespace-cdn\.com/i,
  /Cannot create a badge hook/i,
  /sprout-api\.thegoodapi\.com|loadSproutProductBadge|mobileElement/i,
  /^(Object|\[object Object\]|undefined|null)(\s*\|[\s\S]*)?$/i
];

/** Counted on every render (A5 review strip, blog body presence). */
export const BLOCK_SELECTORS = {
  review_strip: '.ar-rev-wrap',
  faq_accordion: '.ar-faq, .ar-faq-wrap, details',
  blog_body: 'article.BlogItem'
};

/**
 * The site's own content blocks (ar-hero-wrap, ar-rev-wrap, ar-faq-bluebell …).
 * Remembered per page on first render; a block that later stops rendering is a C1 fault.
 * Modifier/child classes (-- / __) are ignored so login state can't trip it.
 */
export const BLOCK_CLASS_RE = '^ar-(?:[a-z0-9]+-)*wrap$|^ar-(?:faq|revs|router|related|money|academy-lesson)$';

export const THRESHOLDS = {
  bodyMinRatio: 0.8,
  firstWords: 12,
  firstWordsSearchWindow: 40,
  stubMaxWords: 12,
  renderWaitMs: 4000,
  renderCapMs: 12000,
  navTimeoutMs: 30000,
  tickBudgetMs: 200000,
  pageGapMs: 4000,
  cooldown429Ms: 45000,
  retry429AfterMs: 90000,
  staleEntityDays: 2,
  syncHeartbeatMaxHours: 24
};

export const ACADEMY_PATH = '/free-online-photography-course';

/** Blog posts are split into 4 rotation slots so every post is checked every 4 weeks. */
export const BLOG_ROTATION_SLOTS = 4;

export const AREAS = { A: 'Schema', B: 'Indexing', C: 'Rendering', D: 'Tools' };

/** label + fix hint per check id. Severity is decided per finding (money pages escalate). */
export const CHECKS = {
  A1: { label: 'A1 BlogPosting body length', fix: 'Re-run Schema Tools for this post (single URL) and deploy.' },
  A2: { label: 'A2 BlogPosting body start', fix: 'Re-run Schema Tools for this post so the body starts at the first paragraph.' },
  A3: { label: 'A3 Title stand-in', fix: 'Re-run Schema Tools for this post; the body or description is just the headline.' },
  A4: { label: 'A4 FAQ parity', fix: 'Re-run the FAQ generator for this page so FAQPage matches the visible questions.' },
  A5: { label: 'A5 Academy Course schema', fix: 'Re-run the landing generator for the Academy page and paste the header schema.' },
  A6: { label: 'A6 Duplicate schema types', fix: 'Remove the duplicate FAQPage/HowTo (inline header copy vs injected file).' },
  B1: { label: 'B1 noindex', fix: 'Remove noindex in Squarespace page SEO settings (or record it in page_indexability_policy if intended).' },
  B2: { label: 'B2 Canonical', fix: 'Fix the canonical so it points at this URL.' },
  B3: { label: 'B3 Google index status', fix: 'Open URL Inspection in Search Console and request indexing once the page is fixed.' },
  B4: { label: 'B4 Redirect / 404', fix: 'Restore the page, or retire the URL so the 06 sync prunes it.' },
  C1: { label: 'C1 Expected blocks', fix: 'Check the page in Squarespace: a block or section loader that used to render is missing.' },
  C2: { label: 'C2 Squarespace error text', fix: 'Open the page editor and fix the broken block / code block.' },
  C3: { label: 'C3 Console errors', fix: 'Check the site code block named in the error.' },
  D1: { label: 'D1 Dead key', fix: 'Replace the key the tool uses (Supabase publishable key).' },
  D2: { label: 'D2 Schema Tools run', fix: 'Re-run the posts listed; check the Supabase key if query errors > 0.' },
  D3: { label: 'D3 Sync freshness', fix: 'Check Task Scheduler AlanSharedResourcesAutoSync on the PC and the sync log.' },
  D4: { label: 'D4 Stale export', fix: 'Click Export 09 keywords in Traditional SEO run controls — it saves and commits by itself. Or run: node scripts/export-09-url-target-keywords.mjs' },
  D5: { label: 'D5 Supabase sync', fix: 'Dead CSV rows are dropped on the next catalog prune + import. If a live page is listed, re-import that CSV in the ingest app.' },
  D6: { label: 'D6 Ingest run', fix: 'Fix the ingest failures listed, then re-run the ingest.' }
};
