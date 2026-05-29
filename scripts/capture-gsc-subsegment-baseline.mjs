/**
 * Capture gsc-subsegment-page-activity-counts baseline.
 * Usage: node scripts/capture-gsc-subsegment-baseline.mjs [outPath] [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outPath = process.argv[2]
  || path.resolve('test/baselines/gsc-subsegment-page-activity-counts-baseline-pre-phase5a.json');
const baseUrl = (process.argv[3] || 'https://ai-geo-audit.vercel.app').replace(/\/$/, '');
const qs = new URLSearchParams({
  property: 'https://www.alanranger.com',
  startDate: '2026-04-28',
  endDate: '2026-05-26'
});
const url = `${baseUrl}/api/aigeo/gsc-subsegment-page-activity-counts?${qs}`;

const res = await fetch(url, { cache: 'no-store' });
const payload = await res.json();
if (payload?.status !== 'ok') {
  console.error('Bad response', payload);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(payload, null, 2);
fs.writeFileSync(outPath, json, 'utf8');
const sha = crypto.createHash('sha256').update(json).digest('hex');
const keys = Object.keys(payload.data || {});

console.log('Wrote', outPath);
console.log('Segment groups:', keys.length, keys.join(', '));
console.log('Sample landing:', JSON.stringify(payload.data?.landing));
console.log('Sample event:', JSON.stringify(payload.data?.event));
console.log('SHA256:', sha);
