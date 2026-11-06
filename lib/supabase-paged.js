/**
 * Every row of a Supabase select, read a page at a time. Paging needs a unique, stable order: without one Postgres
 * can return a row on two pages and skip another. The `order` columns must together be unique (a primary key or a
 * unique index), e.g. ['-date', 'id'].
 */
export async function selectAllPaged(build, order, opts = {}) {
  assertOrder(order);
  const pageSize = opts.pageSize || 1000;
  const maxRows = opts.maxRows || Infinity;
  const out = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const page = await readPage(orderedQuery(build(), order), from, pageSize);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

function assertOrder(order) {
  if (!Array.isArray(order) || !order.length) throw new Error('selectAllPaged needs a unique order');
}

async function readPage(query, from, pageSize) {
  const { data, error } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(error.message || String(error));
  return data || [];
}

/** `col` sorts ascending, `-col` descending; nulls always last. */
export function orderedQuery(query, order) {
  return order.reduce((q, col) => {
    const desc = col.startsWith('-');
    return q.order(desc ? col.slice(1) : col, { ascending: !desc, nullsFirst: false });
  }, query);
}
