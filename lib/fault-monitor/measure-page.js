/**
 * Runs INSIDE the rendered page (page.evaluate). Must stay self-contained:
 * no imports, no outer-scope references. Returns raw material only; all
 * judging happens in Node (page-checks.js) so it can be unit-tested.
 *
 * @param {{ injected: string[], blocks: Record<string,string>, blockClassRe: string }} cfg
 */
export function measureRenderedPage(cfg) {
  function attr(sel, name) {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute(name) || '') : '';
  }
  function robotsMeta() {
    return Array.from(document.querySelectorAll('meta[name="robots"], meta[name="googlebot"]'))
      .map((m) => m.getAttribute('content') || '')
      .join(', ');
  }
  function ldTexts() {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent || '');
  }
  function blockCounts() {
    const out = {};
    for (const [key, sel] of Object.entries(cfg.blocks || {})) {
      try { out[key] = document.querySelectorAll(sel).length; } catch { out[key] = 0; }
    }
    return out;
  }
  function faqLabels() {
    return Array.from(document.querySelectorAll('details > summary, .ar-faq-q'))
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 200);
  }
  function blockClasses() {
    const re = new RegExp(cfg.blockClassRe || '^$');
    const found = new Set();
    document.querySelectorAll('[class*="ar-"]').forEach((el) => {
      el.classList.forEach((c) => { if (re.test(c)) found.add(c); });
    });
    return Array.from(found).sort();
  }
  function unfilledLoaders() {
    return Array.from(document.querySelectorAll('[data-wm-plugin="load"]'))
      .filter((el) => !(el.textContent || '').trim() && !el.querySelector('img'))
      .map((el) => el.getAttribute('data-target') || el.getAttribute('data-source') || 'section loader');
  }
  function cleanedHtml() {
    const root = document.documentElement.cloneNode(true);
    for (const sel of cfg.injected || []) {
      try { root.querySelectorAll(sel).forEach((el) => el.remove()); } catch { /* bad selector */ }
    }
    return `<!doctype html>${root.outerHTML}`;
  }
  const review = document.querySelector('.ar-rev-wrap');
  return {
    finalUrl: location.href,
    title: document.title || '',
    canonical: attr('link[rel="canonical"]', 'href'),
    robots: robotsMeta(),
    ldTexts: ldTexts(),
    blocks: blockCounts(),
    blockClasses: blockClasses(),
    faqLabels: faqLabels(),
    unfilledLoaders: unfilledLoaders(),
    reviewStripText: review ? (review.innerText || '').slice(0, 400) : null,
    bodyText: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 200000),
    html: cleanedHtml()
  };
}
