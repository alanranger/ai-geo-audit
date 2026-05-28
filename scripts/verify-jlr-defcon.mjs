import fs from 'fs';
import path from 'path';
import handler from '../api/aigeo/revenue-truth-summary.js';
import { createClient } from '@supabase/supabase-js';
import { priorYearSameMonthFullNonJlr } from '../lib/revenue-truth-current-month-pulse.mjs';
import { BOOKING_SHEET_NON_JLR_TARGETS } from '../lib/revenue-tier-mapping.js';
import handlerDiag from '../api/aigeo/revenue-funnel-diagnosis.js';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

async function callSummary() {
  return new Promise((resolve, reject) => {
    handler({ method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } }, {
      setHeader() {},
      status() { return this; },
      json(d) { resolve(d); return this; }
    }).catch(reject);
  });
}

async function callDiag() {
  return new Promise((resolve, reject) => {
    handlerDiag({ method: 'GET', query: { propertyUrl: 'https://www.alanranger.com', windowMonths: '3' } }, {
      setHeader() {},
      status() { return this; },
      json(d) { resolve(d); return this; }
    }).catch(reject);
  });
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: txns } = await sb.from('booking_sheet_transactions')
  .select('year,txn_date,amount,is_jlr,is_redemption,booking_source')
  .eq('property_url', 'https://www.alanranger.com');

const mapped = (txns || []).map(t => ({ ...t, is_jlr: t.is_jlr === true, is_redemption: t.is_redemption === true }));
const summary = await callSummary();
const diag = await callDiag();
const pulse = summary.currentMonthPulse;
const may25 = priorYearSameMonthFullNonJlr(mapped, 2026, 5);
const may25bar = summary.monthly.find(m => m.year === 2025 && m.month === 5);

console.log('=== JLR VERIFICATION ===');
console.log('1. May 2025 non-JLR full month:', may25.toFixed(2), '(headline bar £' + may25bar?.headlineRevenue + ')');
console.log('2. Trailing 6 same-day avg (non-JLR):', pulse.comparisons.trailing_6_same_day_avg.amount);
console.log('3. Same-day May 2025 (non-JLR):', pulse.comparisons.prior_year_same_month.amount);
console.log('4. §1 May 25 bar:', may25bar?.headlineRevenue, 'basis=headline_gross JLR-incl');
console.log('5. Reconciliation targets:', BOOKING_SHEET_NON_JLR_TARGETS);
console.log('   API passes:', diag.tier_reconciliation?.passes, 'delta 2026:', diag.tier_reconciliation?.delta_vs_targets?.y2026_ytd);
console.log('\n=== DEFCON ===');
console.log('Best (blended):', pulse.projection.blended_month_end, 'DEFCON', pulse.defcon.best_case?.level);
console.log('Worst (pace):', pulse.projection.linear_month_end, 'DEFCON', pulse.defcon.worst_case?.level);
console.log('Overall DEFCON:', pulse.defcon.level, pulse.defcon.status, 'projected', pulse.defcon.projected_month_end);
console.log('Blend anchor:', pulse.projection.blend_anchor, pulse.projection.blend_anchor_label);
