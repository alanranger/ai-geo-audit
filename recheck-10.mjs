// Re-check the 10 source pages: crawl each, extract internal links, verify status.
const PAGES = [
  "https://www.alanranger.com/photography-workshops-near-me",
  "https://www.alanranger.com/which-photography-style-is-right-for-you",
  "https://www.alanranger.com/photography-services-near-me/four-private-photography-classes",
  "https://www.alanranger.com/blog-on-photography/photography-concepts-for-beginners",
  "https://www.alanranger.com/blog-on-photography/histogram-and-exposure-review",
  "https://www.alanranger.com/blog-on-photography/wildlife-photography-practice-assignment-free-lesson",
  "https://www.alanranger.com/blog-on-photography/triptych-project-photography-assignment-free-lesson",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractLinks(html) {
  const out = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let h = m[1];
    if (h.startsWith("/")) h = "https://www.alanranger.com" + h;
    if (!h.startsWith("https://www.alanranger.com")) continue;
    h = h.split("#")[0].split("?")[0];
    if (h.match(/\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|woff2?|pdf)$/i)) continue;
    out.add(h);
  }
  return [...out];
}

async function status(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": UA } });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      return r.status;
    } catch (e) { await sleep(800); }
  }
  return "ERR";
}

const checked = new Map();
async function check(url) {
  if (checked.has(url)) return checked.get(url);
  const s = await status(url);
  checked.set(url, s);
  await sleep(400);
  return s;
}

(async () => {
  for (const page of PAGES) {
    let html = "";
    try {
      const r = await fetch(page, { headers: { "User-Agent": UA } });
      html = await r.text();
    } catch (e) {
      console.log(`\n### ${page}\n  FAILED TO FETCH: ${e.message}`);
      continue;
    }
    const links = extractLinks(html).filter((l) => l !== page);
    const bad = [];
    for (const l of links) {
      const s = await check(l);
      if (s === 404 || s === 410 || s === "ERR") bad.push(`${s}  ${l}`);
    }
    console.log(`\n### ${page}`);
    console.log(`  links checked: ${links.length}`);
    if (bad.length === 0) console.log("  ✅ no broken links");
    else { console.log("  ❌ BROKEN:"); bad.forEach((b) => console.log("    " + b)); }
  }
  console.log("\nDONE");
})();
