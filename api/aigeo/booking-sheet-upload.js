// POST /api/aigeo/booking-sheet-upload
//
// Accepts the user's local Booking Sheet (.xlsm) as a base64-encoded
// JSON body, parses every funded-but-not-Stripe row, aggregates per
// month per tier, and upserts into `revenue_snapshots` with
// source = 'booking_sheet'.
//
// We use JSON+base64 (not multipart/form-data) because:
//   - Vercel's default Node runtime doesn't parse multipart bodies
//   - the file is small (~50KB-1MB), so b64 overhead is negligible
//   - keeps server code small and stays under the 4.5MB request limit
//     comfortably (a 3MB xlsm becomes ~4MB after b64)
//
// Request body:
//   {
//     filename:       "Booking Sheet 2026 - Alan Ranger Photography.xlsm",
//     contentBase64:  "UEsDBBQABg..."  // base64 of the .xlsm bytes
//     years?:         [2025, 2026]     // optional, default = last 2 years
//     propertyUrl?:   "https://www.alanranger.com"
//   }
//
// Response:
//   {
//     ok: true,
//     tabs_read: ["Sales 2025", "Sales 2026"],
//     records_kept: 478,
//     records_skipped: { funding_excluded:Stripe: 260, no_date: 13, ... },
//     months_upserted: 17,
//     by_funding: { Bank: 22264.08, PayPal: 2840.78, ... },
//     by_month: [ { period_start, period_end, revenue_amount, tier_revenue, ... } ]
//   }

import { createClient } from '@supabase/supabase-js';
import { readWorkbookFromBuffer, parseBookingSheet } from '../../lib/booking-sheet-parser.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;

// Body parser on Vercel defaults to ~1MB; bump to 6MB so a ~3MB .xlsm
// (which becomes ~4MB once base64'd) goes through comfortably.
export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } }
};

function noop() {}

function defaultYears() {
  const y = new Date().getFullYear();
  return [y - 1, y];
}

function fundingTotals(records) {
  const out = {};
  for (const r of records) {
    out[r.funding] = (out[r.funding] || 0) + r.amount;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

function validateBody(body) {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.';
  if (!body.contentBase64 || typeof body.contentBase64 !== 'string') return 'Missing contentBase64.';
  if (body.contentBase64.length > 8 * 1024 * 1024) return 'File too large (base64 > 8MB).';
  return null;
}

async function upsertRows(rows) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .upsert(rows, { onConflict: 'property_url,period_start,period_end,source' })
    .select();
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  return data || [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
  }
  const err = validateBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const { contentBase64, filename, years, propertyUrl } = req.body;
  try {
    const buf = Buffer.from(contentBase64, 'base64');
    const wb = readWorkbookFromBuffer(buf);
    const parsed = parseBookingSheet(wb, {
      propertyUrl: propertyUrl || 'https://www.alanranger.com',
      years: Array.isArray(years) && years.length ? years : defaultYears()
    });
    if (!parsed.supabaseRows.length) {
      return res.status(200).json({
        ok: true,
        filename: filename || null,
        tabs_read: parsed.tabsRead,
        records_kept: 0,
        records_skipped: parsed.skipReasons,
        months_upserted: 0,
        by_funding: {},
        warning: 'No usable rows found - check the spreadsheet has tabs named "Sales YYYY".'
      });
    }
    const saved = await upsertRows(parsed.supabaseRows);
    return res.status(200).json({
      ok: true,
      filename: filename || null,
      tabs_read: parsed.tabsRead,
      records_kept: parsed.records.length,
      records_skipped: parsed.skipReasons,
      months_upserted: saved.length,
      by_funding: fundingTotals(parsed.records),
      by_month: parsed.supabaseRows.map(r => ({
        period_start: r.period_start,
        period_end: r.period_end,
        revenue_amount: r.revenue_amount,
        transactions: r.transactions,
        tier_revenue: r.tier_revenue
      }))
    });
  } catch (e) {
    noop(e);
    return res.status(500).json({ error: e?.message || 'Unknown error parsing Booking Sheet' });
  }
}
