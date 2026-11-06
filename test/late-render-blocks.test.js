import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { launchRenderer, renderAndMeasure } from '../lib/fault-monitor/renderer.js';
import { blocksCheck } from '../lib/fault-monitor/page-checks.js';

function fixture(delayMs) {
  const inject = delayMs == null ? '' : `<script>setTimeout(() => document.body.classList.add('ar-academy-lesson'), ${delayMs});</script>`;
  return `<!doctype html><html><head><title>t</title></head><body><main><p>Lesson text.</p></main>${inject}</body></html>`;
}

let server;
let base;
let renderer;
before(async () => {
  server = http.createServer((req, res) => {
    const delay = { '/late3': 3000, '/late11': 11000 }[req.url];
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fixture(req.url === '/never' ? null : delay));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  renderer = await launchRenderer();
});
after(async () => {
  await renderer?.close();
  server?.close();
});

async function check(path) {
  const r = await renderAndMeasure(renderer, `${base}${path}`, { expectBlocks: ['ar-academy-lesson'] });
  return blocksCheck(`${base}${path}`, 'blog', r.measure, ['ar-academy-lesson']);
}

test('a key block injected 3s after load passes', { timeout: 60000 }, async () => {
  assert.equal((await check('/late3')).status, 'pass');
});

test('a key block injected 11s after load (past the first 8s wait) passes', { timeout: 60000 }, async () => {
  assert.equal((await check('/late11')).status, 'pass');
});

test('a key block that never appears still fails', { timeout: 60000 }, async () => {
  const r = await check('/never');
  assert.notEqual(r.status, 'pass');
  assert.match(String(r.message || r.summary || JSON.stringify(r)), /ar-academy-lesson/);
});
