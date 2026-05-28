// scripts/local-dev-revenue-truth.mjs
//
// Tiny single-file dev server for VB5 / VB6 verification: serves the
// existing audit-dashboard.html statically and routes ONLY the two Revenue
// Truth API endpoints needed by the tab. Avoids Vercel CLI's 128-route
// implicit-build limit (the project has 172 api/*.js files).
//
// Usage: node scripts/local-dev-revenue-truth.mjs
//        # then open http://localhost:3001/audit-dashboard.html

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const PORT = 3001;

loadDotEnv(resolve(ROOT, '.env.local'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.csv':  'text/csv; charset=utf-8'
};

const API_ROUTES = new Map([
  ['/api/aigeo/revenue-truth-summary',           '../api/aigeo/revenue-truth-summary.js'],
  ['/api/aigeo/revenue-truth-findings',          '../api/aigeo/revenue-truth-findings.js'],
  // Phase C / C2 part 2 -- diagnosis section on the Revenue Truth tab.
  ['/api/aigeo/revenue-funnel-diagnosis',        '../api/aigeo/revenue-funnel-diagnosis.js'],
  ['/api/aigeo/revenue-funnel-product-breakdown','../api/aigeo/revenue-funnel-product-breakdown.js']
]);

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

function parseQuery(url) {
  const u = new URL(url, 'http://localhost');
  return Object.fromEntries(u.searchParams.entries());
}

async function handleApi(req, res, routePath) {
  const rel = API_ROUTES.get(routePath);
  if (!rel) { res.writeHead(404); res.end('not found'); return; }
  try {
    const modPath = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), rel)).href + '?t=' + Date.now();
    const mod = await import(modPath);
    const handler = mod.default;
    if (typeof handler !== 'function') throw new Error('handler not exported');
    const q = parseQuery(req.url);
    const wrappedRes = wrapRes(res);
    await handler({ method: req.method, query: q, headers: req.headers, url: req.url }, wrappedRes);
  } catch (err) {
    console.error('[api error]', routePath, err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
}

function wrapRes(res) {
  return {
    setHeader: (k, v) => res.setHeader(k, v),
    status(code) { res.statusCode = code; return this; },
    json(body) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    },
    end(body) { res.end(body); }
  };
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/audit-dashboard.html';
  const abs = join(ROOT, pathname);
  if (!abs.startsWith(ROOT) || !existsSync(abs) || statSync(abs).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + pathname);
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('content-type', MIME[extname(abs).toLowerCase()] || 'application/octet-stream');
  createReadStream(abs).pipe(res);
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (API_ROUTES.has(pathname)) {
    await handleApi(req, res, pathname);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`local-dev-revenue-truth: http://localhost:${PORT}/audit-dashboard.html`);
  console.log('  api routes mounted:');
  for (const k of API_ROUTES.keys()) console.log('    ' + k);
});
