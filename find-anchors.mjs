// Find anchor text for specific broken hrefs on the two pages.
const TARGETS = {
  "https://www.alanranger.com/blog-on-photography/photography-concepts-for-beginners": [
    "composition-in-photography-why-the-camera-isnt-the-artist",
    "mastering-exposure-outdoor-photography-exposure-calculator",
    "why-photography-is-an-art-of-observation-a-deep-dive",
  ],
  "https://www.alanranger.com/blog-on-photography/histogram-and-exposure-review": [
    "what-is-dynamic-range",
  ],
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

for (const [page, slugs] of Object.entries(TARGETS)) {
  const r = await fetch(page, { headers: { "User-Agent": UA } });
  const html = await r.text();
  console.log(`\n### ${page}`);
  // grab every anchor with href + inner text
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const found = {};
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    for (const slug of slugs) {
      // for what-is-dynamic-range, avoid matching the -in-photography version
      const isExact = slug === "what-is-dynamic-range";
      const hit = isExact
        ? /\/what-is-dynamic-range(?:["'\/]|$)/.test(href) && !href.includes("what-is-dynamic-range-in-photography")
        : href.includes(slug);
      if (hit) {
        if (!found[slug]) found[slug] = [];
        found[slug].push({ href, text });
      }
    }
  }
  for (const slug of slugs) {
    const items = found[slug] || [];
    console.log(`\n  Broken slug: ${slug}`);
    if (!items.length) console.log("    (no anchor found in raw HTML - may be injected via JS/related-posts)");
    items.forEach((it) => console.log(`    text: "${it.text}"\n    href: ${it.href}`));
  }
}
