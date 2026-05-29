/** Shared Supabase writes for Booking Sheet truth import (upload + backfill). */

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsertChunks(supabase, table, rows) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch);
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

export async function refreshBookingSheetWideView(supabase) {
  const { error } = await supabase.rpc('refresh_booking_sheet_monthly_wide');
  if (error) throw new Error(`view refresh failed: ${error.message}`);
}

export async function clearBookingSheetForProperty(supabase, propertyUrl) {
  const tables = ['booking_sheet_monthly_category', 'booking_sheet_category_gp', 'booking_sheet_transactions'];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('property_url', propertyUrl);
    if (error) throw new Error(`clear ${table} failed: ${error.message}`);
  }
}

export function reconcileGpLabels(gpRows, catRows, warnings) {
  const canonicalByYearOrder = new Map();
  for (const r of catRows) {
    const key = `${r.year}|${r.category_order}`;
    if (!canonicalByYearOrder.has(key)) canonicalByYearOrder.set(key, r.category_label);
  }
  return (gpRows || []).map((g) => {
    const key = `${g.year}|${g.category_order}`;
    const canonical = canonicalByYearOrder.get(key);
    if (canonical && canonical !== g.category_label) {
      warnings.push(`GP label mismatch ${g.year}/cat ${g.category_order}: GP="${g.category_label}", revenue="${canonical}" — using revenue label`);
      return { ...g, category_label: canonical };
    }
    return g;
  });
}

function dropTxnGeneratedFields(rows) {
  return (rows || []).map((r) => {
    const { is_jlr, is_redemption, month, ...rest } = r;
    return rest;
  });
}

/** Full truth import: category grid + GP + transactions + wide refresh. */
export async function persistBookingSheetTruth(supabase, propertyUrl, parsed) {
  const warnings = [...(parsed.warnings || [])];
  const gpRows = reconcileGpLabels(parsed.gpPerCategory || [], parsed.monthlyPerCategory || [], warnings);
  const txnRows = dropTxnGeneratedFields(parsed.transactionRows || []);
  await clearBookingSheetForProperty(supabase, propertyUrl);
  await upsertChunks(supabase, 'booking_sheet_monthly_category', parsed.monthlyPerCategory || []);
  await upsertChunks(supabase, 'booking_sheet_category_gp', gpRows);
  await upsertChunks(supabase, 'booking_sheet_transactions', txnRows);
  await refreshBookingSheetWideView(supabase);
  return {
    category_rows_written: (parsed.monthlyPerCategory || []).length,
    gp_rows_written: gpRows.length,
    transaction_rows_written: txnRows.length,
    warnings
  };
}
