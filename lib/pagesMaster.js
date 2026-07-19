/**
 * pages_master reader (Phase 2 SoT for page tier).
 * Maps DB letter tiers → short names used by tier-segmentation consumers.
 */
import { createClient } from '@supabase/supabase-js';

const PROPERTY_DEFAULT = 'https://www.alanranger.com';

const TIER_TO_SHORT = {
  A_landing: 'landing',
  B_product: 'product',
  C_event: 'event',
  D_blog: 'blog',
  E_academy: 'academy',
  F_unmapped: 'unmapped'
};

function getServiceClient() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Collapse // and trailing slash (except root). */
export function normalizePagePath(raw) {
  let p = String(raw || '').trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname || '/';
  } catch {
    p = p.replace(/^https?:\/\/[^/]+/i, '');
  }
  p = p.split(/[?#]/)[0] || '/';
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  p = p.toLowerCase() || '/';
  if (p === '/home') return '/';
  return p;
}

function shortTier(letter) {
  return TIER_TO_SHORT[String(letter || '').trim()] || 'unmapped';
}

/**
 * @returns {Promise<Array<{url:string,tier:string,path:string,money_role:?string}>>}
 */
export async function fetchPagesMasterEntries(options = {}) {
  const sb = options.supabase || getServiceClient();
  if (!sb) return [];
  const propertyUrl = String(options.propertyUrl || PROPERTY_DEFAULT).trim() || PROPERTY_DEFAULT;
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from('pages_master')
      .select('url,path,tier,money_role')
      .eq('property_url', propertyUrl)
      .order('path', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`pages_master read failed: ${error.message}`);
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows.map((r) => {
    const path = normalizePagePath(r.path || r.url);
    const url = String(r.url || `${propertyUrl}${path}`).trim();
    return {
      url,
      path,
      tier: shortTier(r.tier),
      money_role: r.money_role || null
    };
  }).filter((r) => r.path);
}

export { TIER_TO_SHORT };
