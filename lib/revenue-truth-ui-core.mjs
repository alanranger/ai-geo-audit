/** Shared Revenue Truth UI constants and formatters (browser + Node). */

export const SITE_ORIGIN = 'https://www.alanranger.com';

export const RECURRING_TIER_KEYS = new Set([
  'courses_masterclasses',
  'workshops_non_residential',
  'one_to_one_lessons',
  'commissions',
  'academy',
  'mentoring',
  'pick_n_mix_inc',
  'gift_vouchers_inc',
  'prints_royalties'
]);

export const VOLATILE_TIER_KEYS = new Set(['workshops_residential']);

export const BAND_COLOURS = {
  thrive: '#a855f7',
  comfortable: '#22c55e',
  survival: '#ea7e10',
  below_survival: '#ef4444',
  partial: '#64748b'
};

export const BAND_LABEL = {
  thrive: 'Thrive (£8k+)',
  comfortable: 'Comfortable (£5k–£8k)',
  survival: 'Survival (£3k–£5k)',
  below_survival: 'Below survival (<£3k)'
};

export const TIER_BAND_TARGETS = { survival: 36000, comfortable: 60000, thrive: 96000 };

export const RECURRING_BASELINE_TIP = 'Recurring baseline = headline minus voucher tiers (gift vouchers + Pick-n-Mix) and redemptions only. Residential workshops and seasonal event products (Bluebell, Heather, Lavender, etc.) are included as year-round baseline products. JLR follows the Include-JLR toggle.';

export const BASIS_LABELS = {
  nonjlr_net: 'Non-JLR / Net',
  nonjlr_gross_voucher: 'Non-JLR / Gross-of-voucher',
  jlr_incl: 'Gross JLR-incl',
  closed_only: 'Closed months only',
  headline_gross: 'Headline (12-category gross)',
  recurring_baseline: 'Recurring baseline'
};

const PLUMBING_RE = /voucher\/plan redemption|pick\s*n\s*mix\s*out|gift\s*vouchers\s*out|_out\b/i;

export function isPlumbingProduct(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  return PLUMBING_RE.test(t) || t.toLowerCase().includes('voucher/plan redemption');
}

export function normaliseSlug(slug) {
  let s = String(slug || '').trim();
  if (!s) return '';
  if (s.startsWith('http')) {
    try { s = new URL(s).pathname; } catch { /* keep */ }
  }
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+$/, '') || '/';
}

export function slugToUrl(slug) {
  const s = normaliseSlug(slug);
  if (!s || s === '/') return SITE_ORIGIN + '/';
  return SITE_ORIGIN + s;
}

export function slugLink(slug, label) {
  const url = slugToUrl(slug);
  const text = label ?? (normaliseSlug(slug) || '/');
  return `<a class="rt-slug-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

export function tip(abbr, full) {
  return `<abbr class="rt-tip" title="${escapeAttr(full)}">${escapeHtml(abbr)}</abbr>`;
}

export function basisBadge(kind) {
  const label = BASIS_LABELS[kind] || kind;
  const tipAttr = kind === 'recurring_baseline' ? ` title="${escapeAttr(RECURRING_BASELINE_TIP)}"` : '';
  return `<span class="rt-basis-badge" data-basis="${escapeAttr(kind)}"${tipAttr}>${escapeHtml(label)}</span>`;
}

export function recurringBaselineLabel(text = 'Recurring baseline') {
  return tip(text, RECURRING_BASELINE_TIP);
}

export function deltaChip(pct, label) {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  const n = Number(pct);
  const cls = n > 0.5 ? 'is-up' : (n < -0.5 ? 'is-down' : 'is-flat');
  const sign = n > 0 ? '+' : '';
  return `<span class="rt-delta-chip ${cls}">${sign}${n.toFixed(1)}%${label ? ' ' + escapeHtml(label) : ''}</span>`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export function fmtMoney(n, decimals = 0) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtN(n) {
  return (Number(n) || 0).toLocaleString('en-GB');
}
