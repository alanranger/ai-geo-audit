/**
 * Plain-English reading of a structured query, plus allowlist validation. The same text is shown above the results,
 * stored with each saved-group version, and used in a person's "why in / out" explanation.
 */
import { FIELD, QUERY_VERSION } from './fields.mjs';

const OP_TEXT = {
  is_true: 'is yes', is_false: 'is no', gte: 'is at least', lte: 'is at most', eq: 'is exactly', between: 'is between',
  after: 'is on or after', before: 'is before', within_last: 'is within the last', older_than: 'is more than', known: 'is known', unknown: 'is unknown',
  is: 'is', is_not: 'is not', in: 'is one of', not_in: 'is none of', exists: 'has at least one', none: 'has no'
};
const MATCH_TEXT = { all: 'ALL of', any: 'ANY of', none: 'NONE of' };
const ukDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '?');
const span = (w) => `${w?.n} ${w?.unit === 'months' ? 'months' : 'days'}`;

function recordText(m = {}) {
  const parts = [];
  if (m.cats?.length) parts.push(`in ${m.cats.join(' / ')}`);
  if (m.title_contains) parts.push(`named like "${m.title_contains}"`);
  if (m.url_contains) parts.push(`to a link containing "${m.url_contains}"`);
  if (m.time === 'past') parts.push('in the past');
  if (m.time === 'future') parts.push('still to come');
  if (m.within) parts.push(`in the last ${span(m.within)}`);
  if (m.after) parts.push(`on or after ${ukDate(m.after)}`);
  if (m.before) parts.push(`before ${ukDate(m.before)}`);
  if (m.on) parts.push(`on ${ukDate(m.on)}`);
  if (m.min_net != null) parts.push(`worth at least £${m.min_net}`);
  return parts.length ? ` (same record: ${parts.join(', ')})` : '';
}

function valueText(field, op, val) {
  if (['is_true', 'is_false', 'known', 'unknown'].includes(op)) return '';
  if (field.type === 'records') return recordText(val);
  if (op === 'between') return field.type === 'date' ? ` ${ukDate(val?.[0])} and ${ukDate(val?.[1])}` : ` ${val?.[0]} and ${val?.[1]}`;
  if (op === 'within_last') return ` ${span(val)}`;
  if (op === 'older_than') return ` ${span(val)} ago`;
  if (field.type === 'date') return ` ${ukDate(val)}`;
  return ` ${Array.isArray(val) ? val.join(', ') : val}`;
}

export function condText(node) {
  const field = FIELD.get(node.field);
  if (!field) return `unknown field "${node.field}"`;
  if (field.type === 'records') return `${OP_TEXT[node.op]} ${field.label.toLowerCase()}${valueText(field, node.op, node.value)}`;
  return `${field.label} ${OP_TEXT[node.op] || node.op}${valueText(field, node.op, node.value)}`;
}

export function describe(node, depth = 0) {
  if (node.type !== 'group') return condText(node);
  const items = (node.items || []).map((n) => describe(n, depth + 1));
  if (!items.length) return 'everyone';
  const body = items.length === 1 && node.match === 'all' ? items[0] : `${MATCH_TEXT[node.match || 'all']}: ${items.map((t) => (t.includes(': ') ? `(${t})` : t)).join('; ')}`;
  return depth ? body : `People where ${body}`;
}

const MAX_DEPTH = 4;
const MAX_ITEMS = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkCond(n) {
  const field = FIELD.get(n.field);
  if (!field) throw new Error(`unknown field: ${n.field}`);
  if (!field.ops.includes(n.op)) throw new Error(`${field.label}: operator ${n.op} not allowed`);
  const v = n.value;
  if (['after', 'before'].includes(n.op) && !DATE.test(String(v))) throw new Error(`${field.label}: date must be YYYY-MM-DD`);
  if (['within_last', 'older_than'].includes(n.op) && !(Number(v?.n) > 0 && ['days', 'months'].includes(v?.unit))) throw new Error(`${field.label}: give a number of days or months`);
  if (['gte', 'lte', 'eq'].includes(n.op) && !Number.isFinite(Number(v))) throw new Error(`${field.label}: number needed`);
  return { type: 'cond', field: n.field, op: n.op, value: v ?? null };
}

/** Rebuild the query from allowlisted parts only (anything unexpected is rejected). */
export function validateQuery(q) {
  let count = 0;
  const walk = (n, depth) => {
    count += 1;
    if (count > MAX_ITEMS || depth > MAX_DEPTH) throw new Error('query too large');
    if (n?.type !== 'group') return checkCond(n || {});
    if (!['all', 'any', 'none'].includes(n.match)) throw new Error('group must be ALL, ANY or NONE');
    return { type: 'group', match: n.match, items: (n.items || []).map((k) => walk(k, depth + 1)) };
  };
  return { version: QUERY_VERSION, root: walk(q?.root || { type: 'group', match: 'all', items: [] }, 0) };
}
