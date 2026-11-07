/**
 * Product / event categories for customer history (GPT point 6). Booking channel (JLR) is kept apart from category.
 * Sources: Booking Sheet category numbers, canonical_products.category, and product / event names.
 */
export const CATEGORIES = {
  beginners: 'Beginners course',
  lightroom: 'Lightroom course',
  course: 'Any course / masterclass',
  abstract_macro: 'Abstract & macro',
  woodland: 'Woodland / bluebell',
  day_workshop: 'Day workshop / walk',
  residential: 'Residential workshop',
  one_to_one: '1-2-1 tuition',
  mentoring: 'Mentoring',
  academy: 'Academy',
  voucher_bought: 'Gift voucher bought',
  voucher_redeemed: 'Gift voucher redeemed',
  pick_n_mix: 'Pick n Mix plan'
};

const NAME_RULES = [
  [/beginner/i, ['beginners', 'course']],
  [/lightroom/i, ['lightroom', 'course']],
  [/abstract|macro/i, ['abstract_macro']],
  [/woodland|bluebell/i, ['woodland']],
  [/residential|weekend|[2-9]\s*-?\s*days?\b/i, ['residential']],
  [/lake district|anglesey|norfolk|yorkshire|dales|devon|hartland|exmoor|dartmoor|scotland|snowdonia|northumberland|cornwall|isle of|vyrnwy/i, ['residential']],
  [/workshop|photo ?walk|photography events|\bwalk\b/i, ['day_workshop']],
  [/masterclass|course|classes/i, ['course']],
  [/1-2-1|121|one[- ]to[- ]one|private (photography )?(lesson|tuition)/i, ['one_to_one']],
  [/mentor/i, ['mentoring']],
  [/academy/i, ['academy']],
  [/gift ?(card|voucher)/i, ['voucher_bought']],
  [/pick ?n ?mix|payment plan/i, ['pick_n_mix']]
];

/** Booking Sheet category number (1-12) → categories. */
const SHEET_CATEGORY = {
  1: ['course'], 2: ['day_workshop'], 3: ['residential'], 4: ['pick_n_mix'], 5: ['pick_n_mix'], 6: ['mentoring'],
  7: ['one_to_one'], 8: ['voucher_bought'], 9: ['voucher_redeemed'], 12: ['academy']
};

const CANONICAL = {
  'workshop (residential)': ['residential'], 'workshop (half-day)': ['day_workshop'], 'workshop (1-day)': ['day_workshop'],
  workshop: ['day_workshop'], course: ['course'], 'course (Lightroom)': ['lightroom', 'course'], '1-2-1': ['one_to_one'],
  mentoring: ['mentoring'], academy: ['academy'], 'gift voucher': ['voucher_bought'], 'subscription/payment-plan': ['pick_n_mix']
};

/** A residential location wins over the generic "workshop" → day workshop rule. */
export function categoriesFromName(name) {
  const out = new Set();
  for (const [re, cats] of NAME_RULES) if (re.test(String(name || ''))) cats.forEach((c) => out.add(c));
  if (out.has('residential')) out.delete('day_workshop');
  return out;
}

export const sheetCategoryNumber = (label) => Number(String(label || '').match(/^(\d+)/)?.[1]) || null;

export function categoriesFromSheet(label, eventLabel) {
  const out = categoriesFromName(eventLabel);
  (SHEET_CATEGORY[sheetCategoryNumber(label)] || []).forEach((c) => out.add(c));
  return out;
}

/** canonical_products rows → Map(lower product title → categories). */
export function canonicalIndex(rows) {
  return new Map((rows || []).map((r) => [String(r.product_title || '').trim().toLowerCase(), CANONICAL[r.category] || []]));
}

export function categoriesFromProduct(productName, index) {
  const out = categoriesFromName(productName);
  (index?.get(String(productName || '').trim().toLowerCase()) || []).forEach((c) => out.add(c));
  return out;
}

/** Workshop attendee row: theme text + multi-day flag; residential vs day is decided by the flag when the name is silent. */
export function categoriesFromWorkshop(theme, isMultiDay) {
  const out = categoriesFromName(theme);
  if (isMultiDay) { out.add('residential'); out.delete('day_workshop'); } else if (!out.has('residential')) out.add('day_workshop');
  return out;
}

export const isCancelledText = (s) => /refund|cancel/i.test(String(s || ''));
