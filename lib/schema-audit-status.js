/**
 * Header "Schema audit" line. A re-run on the same day updates that day's audit_results row (upsert on audit_date),
 * so created_at stays at the first run: the newest audit is the newest updated_at.
 */
/** audit_results stamps are UTC without a zone; say so, or browsers read them as local time. */
const asUtc = (s) => (s && !/(Z|[+-]\d\d:?\d\d)$/.test(String(s)) ? `${String(s).replace(' ', 'T')}Z` : s);
export const stampOf = (row) => asUtc(row?.updated_at || row?.created_at || null);

export function latestSchemaAudit(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Number(r?.schema_total_pages) > 0 && stampOf(r));
  return list.sort((a, b) => Date.parse(stampOf(b)) - Date.parse(stampOf(a)))[0] || null;
}

export function schemaAuditStatusFrom(row) {
  return {
    source: 'schema_audit',
    last_synced_at: stampOf(row),
    schema_total_pages: row ? Number(row.schema_total_pages) : null,
    url_list: row?.schema_foundation?.urlList || null,
    row_count: row ? 1 : 0
  };
}
