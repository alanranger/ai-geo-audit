// One-off / reusable: backfill GBP Performance monthly + discovery terms.
// Usage: node scripts/backfill-gbp-performance.mjs
// Optional: --from 2025-08 --to 2026-07

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import {
  resolveGbpLocation,
  fetchPerformanceMonthly,
  fetchDiscoveryTermsForMonth,
  withGbpToken,
} from '../lib/gbp/performance.js';

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

function parseYm(ym, fallback) {
  if (!ym) return fallback;
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m, day: 1 };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthIter(from, to) {
  const out = [];
  let y = from.year;
  let m = from.month;
  while (y < to.year || (y === to.year && m <= to.month)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endDefault = new Date();
  endDefault.setUTCDate(endDefault.getUTCDate() - 2);
  const to = parseYm(args.to, {
    year: endDefault.getUTCFullYear(),
    month: endDefault.getUTCMonth() + 1,
    day: 1,
  });
  // Walk back: try 18 months first; API empty months simply store zeros / skip terms
  const from = parseYm(args.from, {
    year: to.year - (to.month >= 6 ? 1 : 0),
    month: ((to.month - 6 + 11) % 12) + 1,
    day: 1,
  });
  // Simpler default: Feb 2026 if within window, else 6 months back
  const fromUse = args.from
    ? from
    : { year: 2026, month: 2, day: 1 };

  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

  const result = await withGbpToken(async (token) => {
    const loc = await resolveGbpLocation(token);
    console.error('Location:', loc);

    await supabase.from('gbp_location_registry').upsert({
      location_id: loc.location_id,
      title: loc.title,
      website_uri: loc.website_uri,
      account_name: loc.account_name,
      updated_at: new Date().toISOString(),
    });

    const endDay = {
      year: to.year,
      month: to.month,
      day: Math.min(endDefault.getUTCDate(), lastDayOfMonth(to.year, to.month)),
    };
    // If to month is current partial month, use lag day
    if (to.year === endDefault.getUTCFullYear() && to.month === endDefault.getUTCMonth() + 1) {
      endDay.day = endDefault.getUTCDate();
    } else {
      endDay.day = lastDayOfMonth(to.year, to.month);
    }

    console.error(`Fetching metrics ${fromUse.year}-${fromUse.month} .. ${endDay.year}-${endDay.month}-${endDay.day}`);
    const monthly = await fetchPerformanceMonthly(token, loc.location_id, fromUse, endDay);
    console.error(`Monthly metric rows: ${monthly.length}`);

    if (monthly.length) {
      const { error } = await supabase.from('gbp_performance_monthly').upsert(monthly, {
        onConflict: 'location_id,month',
      });
      if (error) throw new Error(`upsert performance: ${error.message}`);
    }

    const months = monthIter(fromUse, to);
    let termRows = 0;
    for (const { year, month } of months) {
      console.error(`Discovery terms ${year}-${String(month).padStart(2, '0')}`);
      try {
        const terms = await fetchDiscoveryTermsForMonth(token, loc.location_id, year, month);
        if (terms.length) {
          const { error } = await supabase.from('gbp_discovery_terms_monthly').upsert(terms, {
            onConflict: 'location_id,month,search_keyword',
          });
          if (error) throw new Error(`upsert terms: ${error.message}`);
          termRows += terms.length;
        }
      } catch (e) {
        console.error(`  terms failed: ${e.message}`);
      }
    }

    return { loc, monthlyCount: monthly.length, termRows, months: monthly };
  });

  console.log(JSON.stringify({
    ok: true,
    location_id: result.loc.location_id,
    performance_months: result.monthlyCount,
    discovery_term_rows: result.termRows,
    series: result.months,
  }, null, 2));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
