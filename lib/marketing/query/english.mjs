/**
 * Plain-English reading of a structured query, plus allowlist validation. The same text is shown above the results,
 * stored with each saved-group version, and used in a person's "why in / out" explanation.
 */
import { FIELD, OPTION_LABELS, QUERY_VERSION } from './fields.mjs';
import { TOPIC_MAP_VERSION, topicLabel } from './topics.mjs';

const OP_TEXT = {
  is_true: 'is yes', is_false: 'is no', gte: 'is at least', lte: 'is at most', eq: 'is exactly', between: 'is between',
  after: 'is on or after', before: 'is before', within_last: 'is within the last', older_than: 'is more than', known: 'is known', unknown: 'is unknown',
  is: 'is', is_not: 'is not', in: 'is one of', not_in: 'is none of', exists: 'has at least one', none: 'has no'
};
const MATCH_TEXT = { all: 'ALL of', any: 'ANY of', none: 'NONE of' };
const ukDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '?');
const span = (w) => `${w?.n} ${w?.unit === 'months' ? 'months' : 'days'}`;

const RECORD_PARTS = [
  [(m) => m.cats?.length, (m) => `in ${m.cats.join(' / ')}`],
  [(m) => m.title_contains, (m) => `named like "${m.title_contains}"`],
  [(m) => m.url_contains, (m) => `to a link containing "${m.url_contains}"`],
  [(m) => m.time === 'past', () => 'in the past'],
  [(m) => m.time === 'future', () => 'still to come'],
  [(m) => m.within, (m) => `in the last ${span(m.within)}`],
  [(m) => m.after, (m) => `on or after ${ukDate(m.after)}`],
  [(m) => m.before, (m) => `before ${ukDate(m.before)}`],
  [(m) => m.on, (m) => `on ${ukDate(m.on)}`],
  [(m) => m.min_net != null, (m) => `worth at least £${m.min_net}`],
  [(m) => m.email_id, (m) => `campaign "${m.campaign_label || m.email_id}"`],
  [(m) => m.email_ids?.length, (m) => m.campaign_label || `one of ${m.email_ids.length} chosen campaigns`],
  [(m) => m.topics?.length, (m) => `about ${m.topics.map(topicLabel).join(' / ')} (topic map v${TOPIC_MAP_VERSION})`]
];

function recordText(m = {}) {
  const parts = RECORD_PARTS.filter(([has]) => has(m)).map(([, text]) => text(m));
  return parts.length ? ` (same record: ${parts.join(', ')})` : '';
}

const AGG_TEXT = { count_gte: (m) => `at least ${m.count} ×`, count_lte: (m) => `at most ${m.count} ×`, sum_gte: (m) => `at least £${m.amount} of`, sum_lte: (m) => `at most £${m.amount} of` };

function valueText(field, op, val) {
  if (['is_true', 'is_false', 'known', 'unknown'].includes(op)) return '';
  if (field.type === 'records') return recordText(val);
  if (op === 'between') return field.type === 'date' ? ` ${ukDate(val?.[0])} and ${ukDate(val?.[1])}` : ` ${val?.[0]} and ${val?.[1]}`;
  if (op === 'within_last') return ` ${span(val)}`;
  if (op === 'older_than') return ` ${span(val)} ago`;
  if (field.type === 'date') return ` ${ukDate(val)}`;
  if (field.group === 'Client health' && Array.isArray(val)) return ` ${val.map((k) => OPTION_LABELS[k] || k).join(' / ')}`;
  return ` ${Array.isArray(val) ? val.join(', ') : val}`;
}

export function condText(node) {
  const field = FIELD.get(node.field);
  if (!field) return `unknown field "${node.field}"`;
  if (field.type === 'records' && AGG_TEXT[node.op]) return `has ${AGG_TEXT[node.op](node.value || {})} ${field.label.toLowerCase()}${valueText(field, node.op, node.value)}`;
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

/** [operator test, value is bad, message] — the first failing rule rejects the condition. */
const VALUE_RULES = [
  [(op) => ['after', 'before'].includes(op), (v) => !DATE.test(String(v)), 'date must be YYYY-MM-DD'],
  [(op) => ['within_last', 'older_than'].includes(op), (v) => !(Number(v?.n) > 0 && ['days', 'months'].includes(v?.unit)), 'give a number of days or months'],
  [(op) => ['gte', 'lte', 'eq'].includes(op), (v) => !Number.isFinite(Number(v)), 'number needed'],
  [(op) => /^count_/.test(op), (v) => v?.count == null || v.count === '' || !(Number(v.count) >= 0), 'how many times?'],
  [(op) => /^sum_/.test(op), (v) => !Number.isFinite(Number(v?.amount ?? NaN)), 'give an amount in £']
];

function checkCond(n) {
  const field = FIELD.get(n.field);
  if (!field) throw new Error(`unknown field: ${n.field}`);
  if (!field.ops.includes(n.op)) throw new Error(`${field.label}: operator ${n.op} not allowed`);
  if (field.stage === 'B') throw new Error(`${field.label}: not available yet — ${field.reason || 'Stage B'}`);
  const bad = VALUE_RULES.find(([applies, isBad]) => applies(n.op) && isBad(n.value));
  if (bad) throw new Error(`${field.label}: ${bad[2]}`);
  return { type: 'cond', field: n.field, op: n.op, value: n.value ?? null };
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
