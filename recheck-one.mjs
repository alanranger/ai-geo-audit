const page = process.argv[2];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function extractLinks(html) {
  const out = new Set();
  const re = /href=["']([^"']+)["']/gi; let m;
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
      const r = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA } });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      return r.status;
    } catch (e) { await sleep(800); }
  }
  return "ERR";
}
(async () => {
  const r = await fetch(page + "?v=" + Date.now(), { headers: { "User-Agent": UA, "Cache-Control": "no-cache" } });
  const html = await r.text();
  const links = extractLinks(html).filter((l) => l !== page);
  const bad = [];
  for (const l of links) {
    const s = await status(l);
    if (s === 404 || s === 410 || s === "ERR") bad.push(`${s}  ${l}`);
    await sleep(350);
  }
  console.log(`### ${page}`);
  console.log(`links checked: ${links.length}`);
  if (!bad.length) console.log("✅ no broken links");
  else { console.log("❌ BROKEN:"); bad.forEach((b) => console.log("  " + b)); }
})();
