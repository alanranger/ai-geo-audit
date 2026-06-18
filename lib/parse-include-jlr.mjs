/** Shared ?includeJlr= query parsing — default true (Booking Sheet headline). */
export function parseIncludeJlr(raw) {
  if (raw == null || raw === '') return true;
  const v = String(raw).toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return v === 'true' || v === '1' || v === 'yes';
}
