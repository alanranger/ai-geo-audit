const PAGE = 'https://www.alanranger.com/photo-workshops-uk';
const res = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0' } });
const html = await res.text();
const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
const services = [];

function walk(node, path = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, `${path}[${i}]`));
    return;
  }
  const types = [].concat(node['@type'] || []).map(String);
  if (types.some((t) => /service/i.test(t))) {
    services.push({
      path,
      types,
      name: node.name ?? null,
      id: node['@id'] ?? null,
      keys: Object.keys(node),
      snippet: JSON.stringify(node, null, 2).slice(0, 1200),
    });
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === '@context') continue;
    walk(v, path ? `${path}.${k}` : k);
  }
}

console.log('status', res.status, 'ld+json blocks', blocks.length);
blocks.forEach((b, i) => {
  try {
    walk(JSON.parse(b[1].trim()), `block${i}`);
  } catch (e) {
    console.log('parse fail block', i, e.message);
  }
});
console.log(JSON.stringify(services, null, 2));
