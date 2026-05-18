// List BS-Stripe-funded rows for Hire and Services and try to match against
// SQ orders + Stripe charges so we can see what's misclassified vs unseen.

import { readFileSync } from 'node:fs';

function csvParse(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const head = lines.shift().split(',');
  return lines.map(l => {
    const cells = l.match(/"[^"]*"|[^,]+/g) || [];
    const o = {};
    head.forEach((h, i) => {
      o[h] = String(cells[i] || '').replace(/^"|"$/g, '').replace(/""/g, '"');
    });
    return o;
  });
}

const fmtNum = (v) => Number(v).toFixed(2).padStart(7);
const pad = (s, n) => String(s || '').slice(0, n).padEnd(n);

function dumpBucket(label, tierCsv) {
  const rows = csvParse(tierCsv);
  const bsStripe = rows.filter(r => r.source === 'BS' && r.funding === 'Stripe');
  const sq = rows.filter(r => r.source === 'SQ');
  const st = rows.filter(r => r.source === 'Stripe');
  console.log(`\n========== ${label} ==========`);
  console.log(`\nBS rows funded "Stripe" (= Squarespace) tagged as this tier:`);
  console.log('  date        amount    customer                       description / event');
  let bsTot = 0;
  for (const r of bsStripe) {
    console.log(`  ${r.date}  GBP ${fmtNum(r.amount)}  ${pad(r.customer, 28)}  ${r.description}`);
    bsTot += Number(r.amount);
  }
  console.log(`  TOTAL BS-Stripe tier: GBP ${bsTot.toFixed(2)}`);
  console.log(`\nSQ orders that classifier put in this tier:`);
  let sqTot = 0;
  for (const r of sq) {
    console.log(`  ${r.date}  GBP ${fmtNum(r.amount)}  ${pad(r.customer, 28)}  ${r.description}`);
    sqTot += Number(r.amount);
  }
  console.log(`  TOTAL SQ tier: GBP ${sqTot.toFixed(2)}`);
  console.log(`\nStripe (direct) charges that classifier put in this tier:`);
  let stTot = 0;
  for (const r of st) {
    console.log(`  ${r.date}  GBP ${fmtNum(r.amount)}  ${pad(r.customer, 28)}  ${r.description}`);
    stTot += Number(r.amount);
  }
  console.log(`  TOTAL Stripe-direct tier: GBP ${stTot.toFixed(2)}`);
  console.log(`\nGap = BS-Stripe (${bsTot.toFixed(2)}) - SQ (${sqTot.toFixed(2)}) - Stripe-direct (${stTot.toFixed(2)}) = ${(bsTot - sqTot - stTot).toFixed(2)}`);
}

dumpBucket('HIRE / COMMERCIAL', 'tmp/reconcile-hire.csv');
dumpBucket('SERVICES (1-2-1 / mentoring / vouchers / pick n mix)', 'tmp/reconcile-services.csv');
