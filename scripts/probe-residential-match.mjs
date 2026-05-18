// Compare BS-Stripe-funded Residential rows against SQ non-res orders to
// detect classifier mis-assignments. Investigation only.

import { readFileSync } from 'node:fs';

function csvParse(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const head = lines.shift().split(',');
  const out = [];
  for (const l of lines) {
    const cells = l.match(/"[^"]*"|[^,]+/g) || [];
    const o = {};
    head.forEach((h, i) => {
      const raw = String(cells[i] || '');
      o[h] = raw.replace(/^"|"$/g, '').replace(/""/g, '"');
    });
    out.push(o);
  }
  return out;
}

function fmtNum(v) { return Number(v).toFixed(2).padStart(7); }
function pad(s, n) { return String(s || '').slice(0, n).padEnd(n); }

const res = csvParse('tmp/reconcile-workshops_residential.csv');
const nonres = csvParse('tmp/reconcile-workshops_nonres.csv');

const bsRes = res.filter(r => r.source === 'BS' && r.funding === 'Stripe');
const sqRes = res.filter(r => r.source === 'SQ');
const sqNonres = nonres.filter(r => r.source === 'SQ');

console.log('=== BS rows tagged "3. Workshops Residential" funded Stripe (= Squarespace) ===');
console.log('  date        amount    customer                       event');
console.log('  ----------  --------  -----------------------------  --------------------');
let bsTotal = 0;
for (const r of bsRes) {
  console.log(`  ${r.date}  GBP ${fmtNum(r.amount)}  ${pad(r.customer, 28)}  ${r.description}`);
  bsTotal += Number(r.amount);
}
console.log(`  TOTAL BS residential funded Stripe: GBP ${bsTotal.toFixed(2)}`);

console.log('\n=== SQ orders that classifier put in workshops_residential ===');
console.log('  date        amount    customer                       product');
console.log('  ----------  --------  -----------------------------  --------------------');
let sqResTotal = 0;
for (const r of sqRes) {
  console.log(`  ${r.date}  GBP ${fmtNum(r.amount)}  ${pad(r.customer, 28)}  ${r.description}`);
  sqResTotal += Number(r.amount);
}
console.log(`  TOTAL SQ residential: GBP ${sqResTotal.toFixed(2)}`);

console.log('\n=== SQ orders that classifier put in workshops_nonres (possible misses) ===');
console.log('  date        amount    customer                       product');
console.log('  ----------  --------  -----------------------------  --------------------');
let sqNonTotal = 0;
for (const r of sqNonres) {
  console.log(`  ${r.date}  GBP ${fmtNum(r.amount)}  ${pad(r.customer, 28)}  ${r.description}  [${r.url}]`);
  sqNonTotal += Number(r.amount);
}
console.log(`  TOTAL SQ non-res: GBP ${sqNonTotal.toFixed(2)}`);

console.log(`\nGap to explain: BS-Stripe-Res (${bsTotal.toFixed(2)}) - SQ-Res (${sqResTotal.toFixed(2)}) = ${(bsTotal - sqResTotal).toFixed(2)}`);
