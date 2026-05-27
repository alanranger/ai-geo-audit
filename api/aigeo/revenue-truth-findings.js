// Phase B endpoint -- powers the "What's Changed & Why" section on the
// Revenue Truth tab.
//
// Reads booking_sheet_transactions + canonical_products, runs them through
// lib/revenue-truth-findings.mjs, returns a structured FINDINGS object.
//
// The analyser is correlations-only: it surfaces the £ figures and the
// source decomposition behind a change, never claims causation.
//
// Method: GET
// Query:  ?propertyUrl=https://www.alanranger.com   (optional, default below)

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { buildFindings } from '../../lib/revenue-truth-findings.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const TXN_PAGE_SIZE = 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  try {
    const propertyUrl = (req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
    const supabase = createSupabase();
    const [transactions, canonicalProducts] = await Promise.all([
      fetchAllTransactions(supabase, propertyUrl),
      fetchCanonicalProducts(supabase)
    ]);
    const findings = buildFindings({ transactions, canonicalProducts });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(findings);
  } catch (err) {
    console.error('[revenue-truth-findings] failed:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
}

function createSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

// PostgREST defaults to 1000-row pages, so paginate explicitly otherwise the
// 918-row transactions table truncates and reconciliations fall under target.
async function fetchAllTransactions(supabase, propertyUrl) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('booking_sheet_transactions')
      .select('year, month, txn_date, client_name, category_label, funding, amount, booking_source, channel, client_type, canonical_product, landing_page_url, is_jlr, is_redemption')
      .eq('property_url', propertyUrl)
      .order('txn_date', { ascending: true })
      .range(from, from + TXN_PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < TXN_PAGE_SIZE) break;
    from += TXN_PAGE_SIZE;
  }
  return out;
}

async function fetchCanonicalProducts(supabase) {
  const { data, error } = await supabase
    .from('canonical_products')
    .select('product_title, product_url, category, service_page_url, service_page_title, is_redemption, is_retired');
  if (error) throw error;
  return data || [];
}
