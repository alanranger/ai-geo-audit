// POST /api/aigeo/booking-sheet-upload
//
// Accepts the user's local Booking Sheet (.xlsm) as a base64-encoded
// JSON body, reads the row-18 Totals + per-category grid from each
// "Sales YYYY" tab (the SINGLE SOURCE OF TRUTH for total revenue), and
// upserts into:
//   - public.booking_sheet_monthly           (per-month per-tier truth)
//   - public.booking_sheet_monthly_category  (12-category audit trail)
//   - then refreshes booking_sheet_monthly_wide materialised view
//
// 2026-05-26 SINGLE-SOURCE-OF-TRUTH FIX: this endpoint previously called
// the LEGACY `parseBookingSheet` parser, which walked transactional rows
// and filtered to Bank+PayPal+Cash funding (excluding Stripe), then wrote
// to `revenue_snapshots` with source='booking_sheet'. The dashboard then
// SUMMED that source with `squarespace_api` + `stripe_supplemental`
// sources, producing double-counted headline figures because the three
// sources overlap (no transaction-level de-dup exists between SQ orders,
// Stripe charges and Booking Sheet receipts).
//
// The new behaviour reads the Booking Sheet's row-18 "Totals" line, which
// is the user's manually-reconciled master total -- it already includes
// every funding channel. The dashboard now reads from the new tables and
// no longer needs the SQ/Stripe sources to be summed for the headline.
// See Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md.
//
// We use JSON+base64 (not multipart/form-data) because:
//   - Vercel's default Node runtime doesn't parse multipart bodies
//   - the file is small (~50KB-1MB), so b64 overhead is negligible
//   - keeps server code small and stays under the 4.5MB request limit
//
// Request body:
//   {
//     filename:       "Booking Sheet 2026 - Alan Ranger Photography.xlsm",
//     contentBase64:  "UEsDBBQABg..."   // base64 of the .xlsm bytes
//     propertyUrl?:   "https://www.alanranger.com"
//     minYear?:       2025               // ignore sheets older than this
//   }
//
// Response:
//   {
//     ok: true,
//     tabs_read:   ["Sales 2025", "Sales 2026"],
//     verification: [ { sheet, year, derivedYearSum, ytdActualValue,
//                       ytdActualCell, reconciles } ],
//     tier_rows_written:     73,
//     category_rows_written: 133,
//     totals_by_year:        { "2025": 46567.46, "2026": 19598.04 },
//     warnings:              []
//   }

import { createClient } from '@supabase/supabase-js';
import {
  readWorkbookFromBuffer,
  parseBookingSheetTruth
} from '../../lib/booking-sheet-truth-parser.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateBody(body) {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.';
  if (!body.contentBase64 || typeof body.contentBase64 !== 'string') return 'Missing contentBase64.';
  if (body.contentBase64.length > 8 * 1024 * 1024) return 'File too large (base64 > 8MB).';
  return null;
}

function totalsByYear(perTierRows) {
  const out = {};
  for (const r of perTierRows) {
    out[r.year] = Number(((out[r.year] || 0) + Number(r.revenue_amount || 0)).toFixed(2));
  }
  return out;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function clearExistingForProperty(supabase, propertyUrl) {
  const del1 = await supabase.from('booking_sheet_monthly').delete().eq('property_url', propertyUrl);
  if (del1.error) throw new Error(`clear booking_sheet_monthly failed: ${del1.error.message}`);
  const del2 = await supabase.from('booking_sheet_monthly_category').delete().eq('property_url', propertyUrl);
  if (del2.error) throw new Error(`clear booking_sheet_monthly_category failed: ${del2.error.message}`);
}

async function upsertChunks(supabase, table, rows) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch);
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function refreshWideView(supabase) {
  const { error } = await supabase.rpc('refresh_booking_sheet_monthly_wide');
  if (error) throw new Error(`view refresh failed: ${error.message}`);
}

// Reconcile every parsed sheet against its own "YTD Actual" cell. If any
// sheet's category-grid sum does not match its YTD Actual cell to the penny,
// we refuse to import -- the user expects a perfect match.
function assertVerification(verification) {
  const fails = verification.filter(v => !v.reconciles);
  if (fails.length === 0) return null;
  return fails.map(v =>
    `${v.sheet}: derived £${v.derivedYearSum} != ${v.ytdActualCell}=£${v.ytdActualValue}`
  ).join('; ');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

  const { contentBase64, filename, propertyUrl, minYear } = req.body;
  const property = propertyUrl || DEFAULT_PROPERTY;
  try {
    const buf = Buffer.from(contentBase64, 'base64');
    const wb = readWorkbookFromBuffer(buf);
    const parsed = parseBookingSheetTruth(wb, {
      propertyUrl: property,
      minYear: Number.isFinite(Number(minYear)) ? Number(minYear) : 2025
    });

    if (parsed.verification.length === 0) {
      return res.status(400).json({
        ok: false,
        filename: filename || null,
        warnings: parsed.warnings,
        error: 'No "Sales YYYY" tabs (with year >= minYear) found in the workbook.'
      });
    }

    const reconciliationFailure = assertVerification(parsed.verification);
    if (reconciliationFailure) {
      return res.status(422).json({
        ok: false,
        filename: filename || null,
        verification: parsed.verification,
        warnings: parsed.warnings,
        error: `Reconciliation failed: ${reconciliationFailure}`
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await clearExistingForProperty(supabase, property);
    await upsertChunks(supabase, 'booking_sheet_monthly', parsed.monthlyPerTier);
    await upsertChunks(supabase, 'booking_sheet_monthly_category', parsed.monthlyPerCategory);
    await refreshWideView(supabase);

    return res.status(200).json({
      ok: true,
      filename: filename || null,
      tabs_read: parsed.verification.map(v => v.sheet),
      verification: parsed.verification,
      tier_rows_written: parsed.monthlyPerTier.length,
      category_rows_written: parsed.monthlyPerCategory.length,
      totals_by_year: totalsByYear(parsed.monthlyPerTier),
      warnings: parsed.warnings
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unknown error parsing Booking Sheet' });
  }
}
