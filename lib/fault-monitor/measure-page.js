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
    return Array.from(document.querySelectorAll(
      'details > summary, .ar-faq-q, .accordion-item__title, .arp-faq-item h3, .faq-item h3'
    ))
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
  // Same visibility test as the hosted loaders (qVisible): question name found in page text.
  function loaderVisText() {
    if (!document.body) return '';
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript').forEach((el) => el.remove());
    return String(clone.textContent || '').replace(/['\u2019]/g, "'").toLowerCase();
  }
  function faqQuestionNames() {
    const names = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let j;
      try { j = JSON.parse(s.textContent || ''); } catch { continue; }
      for (const n of [].concat(j && j['@graph'] ? j['@graph'] : j)) {
        const types = [].concat(n && n['@type']);
        if (!types.includes('FAQPage')) continue;
        for (const q of [].concat(n.mainEntity || [])) if (q && q.name) names.push(String(q.name));
      }
    }
    return names;
  }
  function faqVisibility() {
    const text = loaderVisText();
    const names = faqQuestionNames();
    const visible = names.filter((raw) => {
      const name = raw.replace(/['\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
      return name.length > 8 && text.indexOf(name) !== -1;
    });
    return { total: names.length, visible: visible.length };
  }
  // Question items inside the page's FAQ section(s) only (not every accordion on the page).
  function faqSectionCount() {
    const roots = new Set(document.querySelectorAll('.ar-faq, .ar-faq-wrap, .arp-faq, [id*="faq" i]'));
    document.querySelectorAll('h1, h2, h3').forEach((h) => {
      if (!/\bfaqs?\b|frequently asked/i.test(h.textContent || '')) return;
      const scope = h.closest('.page-section, section, .sqs-block, .ar-faq-wrap') || h.parentElement;
      if (scope) roots.add(scope);
    });
    if (!roots.size) return null;
    const seen = new Set();
    roots.forEach((root) => {
      root.querySelectorAll('details > summary, .accordion-item__title, .ar-faq-q, .arp-faq-item h3, .faq-item h3').forEach((el) => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (t.length > 8 && /\?/.test(t)) seen.add(t);
      });
    });
    return seen.size || null;
  }
  // Rendered words of the content area: the post body on blog posts, otherwise the page minus chrome.
  function contentWords() {
    const article = document.querySelector('article.BlogItem');
    const root = (article || document.body).cloneNode(true);
    const chrome = ['script', 'style', 'noscript', 'template', 'header', 'footer', 'nav',
      '[role="banner"]', '[role="contentinfo"]', '[role="navigation"]', '.Header', '.Footer',
      '.sqs-cookie-banner-v2', '#sqs-cookie-banner', '.sqs-announcement-bar', ...(cfg.injected || [])];
    for (const sel of chrome) {
      try { root.querySelectorAll(sel).forEach((el) => el.remove()); } catch { /* bad selector */ }
    }
    return String(root.textContent || '').split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
  }
  const review = document.querySelector('.ar-rev-wrap');
  return {
    faqDrop: window.__AR_FAQ_DROP ? { ...window.__AR_FAQ_DROP } : null,
    faqVisibility: faqVisibility(),
    faqSectionCount: faqSectionCount(),
    contentWords: contentWords(),
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
