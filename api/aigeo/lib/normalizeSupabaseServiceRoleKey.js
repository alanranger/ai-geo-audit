/** HS256 JWT signature is 43 base64url chars; pasted keys often have trailing junk. */
export function normalizeSupabaseServiceRoleKey(raw) {
  const t = String(raw || '').trim();
  const p = t.split('.');
  if (p.length !== 3) return t;
  const sig = p[2];
  if (sig.length <= 43) return t;
  return `${p[0]}.${p[1]}.${sig.slice(0, 43)}`;
}
