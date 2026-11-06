/**
 * Every row of a Supabase select, read a page at a time. Paging needs a unique, stable order: without one Postgres
 * can return a row on two pages and skip another. The `order` columns must together be unique (a primary key or a
 * unique index), e.g. ['-date', 'id'].
 */
export async function selectAllPaged(build, order, { pageSize = 1000, maxRows = Infinity } = {}) {
  if (!Array.isArray(order) || !order.length) throw new Error('selectAllPaged needs a unique order');
  const out = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await orderedQuery(build(), order).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || String(error));
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** `col` sorts ascending, `-col` descending; nulls always last. */
export function orderedQuery(query, order) {
  return order.reduce((q, col) => {
    const desc = col.startsWith('-');
    return q.order(desc ? col.slice(1) : col, { ascending: !desc, nullsFirst: false });
  }, query);
}
