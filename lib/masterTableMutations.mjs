/**
 * Log writes to master tables (pages_master, etc.) for accountability.
 * Table: public.master_table_mutations
 */
export async function logMasterMutation(sb, {
  tableName,
  scriptName,
  args = '',
  rowCount = 0,
  notes = '',
  propertyUrl = 'https://www.alanranger.com'
}) {
  const { error } = await sb.from('master_table_mutations').insert({
    table_name: tableName,
    script_name: scriptName,
    args: String(args || ''),
    row_count: Number(rowCount) || 0,
    notes: String(notes || ''),
    property_url: propertyUrl
  });
  if (error) {
    console.warn('master_table_mutations log failed:', error.message || error);
  }
}
