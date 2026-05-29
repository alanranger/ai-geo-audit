/**
 * Compare post-Phase-3 diagnosis output to pre-baseline (ignoring policy_suppression_reason).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const prePath = path.resolve('test/baselines/revenue-funnel-diagnosis-baseline-pre-phase3.json');
const postPath = process.argv[2]
  || path.resolve('test/baselines/revenue-funnel-diagnosis-baseline-post-phase3.json');

const req = {
  method: 'GET',
  query: { propertyUrl: 'https://www.alanranger.com', windowMonths: 12, includeAllPages: 'true' }
};
const res = {
  status() { return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);
const post = res._body;
fs.mkdirSync(path.dirname(postPath), { recursive: true });
fs.writeFileSync(postPath, JSON.stringify(post, null, 2), 'utf8');

const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'));
const postSha = crypto.createHash('sha256').update(JSON.stringify(post, null, 2)).digest('hex');

console.log('Pre diagnostics:', pre.diagnostics.length);
console.log('Post diagnostics:', post.diagnostics.length);

let mismatches = 0;
for (let i = 0; i < pre.diagnostics.length; i++) {
  const a = pre.diagnostics[i];
  const b = post.diagnostics[i];
  const { policy_suppression_reason: _r, ...bRest } = b;
  const preJson = JSON.stringify(a);
  const postJson = JSON.stringify(bRest);
  if (preJson !== postJson) {
    mismatches += 1;
    if (mismatches <= 3) {
      console.log('MISMATCH row', i, a.page_slug, 'state', a.state, '->', b.state);
    }
  }
  if (b.policy_suppression_reason !== null) {
    mismatches += 1;
    console.log('Non-null policy_suppression_reason on', b.page_slug, b.policy_suppression_reason);
  }
}

const nullReasonCount = post.diagnostics.filter((d) => d.policy_suppression_reason === null).length;
console.log('policy_suppression_reason null on', nullReasonCount, '/', post.diagnostics.length, 'rows');
console.log('Post SHA256:', postSha);
console.log('Field mismatches (excluding policy_suppression_reason):', mismatches);
console.log('First post row keys include policy_suppression_reason:', Object.prototype.hasOwnProperty.call(post.diagnostics[0], 'policy_suppression_reason'));
process.exit(mismatches === 0 && post.diagnostics.length === pre.diagnostics.length ? 0 : 1);
