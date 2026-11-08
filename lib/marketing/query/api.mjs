/** Customer query / saved-group actions for /api/aigeo/marketing (admin key checked by the route for every action). */
import { customerDetail } from '../customers.mjs';
import { evalCtx, loadPeople, recentCampaigns } from '../overview.mjs';
import { clientHealth, healthSummary, londonDay, personHealth } from '../client-health.mjs';
import { OPTION_LABELS, catalogue } from './fields.mjs';
import { rowCtx } from './evaluate.mjs';
import { TOPICS, TOPIC_MAP_VERSION } from './topics.mjs';
import { groupVersions, listGroups, previewGroup, saveGroup } from './groups.mjs';
import { COLUMNS, PRESETS, runQuery } from './table.mjs';

const SET_BY = 'Alan (dashboard, admin key)';
const params = (p = {}) => ({ centre: p.centre, max_miles: p.max_miles, warm_days: p.warm_days, cooling_days: p.cooling_days });
/** Health tags count calendar months / days to the Europe/London day (ctx.today is the UTC day). */
const withAsOf = (ctx) => ({ ...ctx, asOf: londonDay(new Date().toISOString()) });

async function run(sb, b) {
  const ctx = withAsOf(await evalCtx(sb, params(b.params)));
  const t0 = Date.now();
  const { members, ...out } = runQuery(await loadPeople(sb), b.query, ctx, { sort: b.sort, dir: b.dir, page: b.page, columns: b.columns, show: b.show, q: b.q, summary: !!b.summary });
  return { ...out, centre: ctx.centre, as_of: new Date().toISOString(), engagement_coverage: ctx.engagement_coverage, academy_feed: ctx.academyFeed, ms: Date.now() - t0 };
}

async function preview(sb, b) {
  const ctx = await evalCtx(sb, params(b.params));
  return previewGroup(sb, b.segment_id, await loadPeople(sb), ctx, { record: !!b.record, by: SET_BY });
}

async function firstDay(sb, table, col) {
  const { data } = await sb.from(table).select(col).not(col, 'is', null).order(col, { ascending: true }).limit(1).maybeSingle();
  return data?.[col] ? String(data[col]).slice(0, 10) : null;
}

/** Client list health panel: every number with the exact query that reproduces it in Customers. */
async function health(sb) {
  const ctx = withAsOf(await evalCtx(sb));
  const coverage = {
    booking_sheet_from: await firstDay(sb, 'booking_sheet_transactions', 'txn_date'), squarespace_from: await firstDay(sb, 'sqs_orders', 'created_on'),
    last_collected_campaign: ctx.campaigns?.list?.[0]?.sent_on || null, engagement: ctx.engagement_coverage
  };
  const h = clientHealth(await loadPeople(sb), (p) => ({ ...rowCtx(p, ctx), windows: ctx.windows }), { asOf: ctx.asOf, coverage });
  return { ...h, summary: healthSummary(h), as_of: new Date().toISOString() };
}

async function personFacts(sb, personId) {
  const { data, error } = await sb.from('customer_person').select('person_id, anchor_key, facts').eq('person_id', personId).maybeSingle();
  if (error || !data) throw new Error('person not found');
  return data;
}

async function why(sb, b) {
  const out = await customerDetail(sb, b.person_id, params(b.params), b.query || null);
  const p = await personFacts(sb, b.person_id);
  const ctx = withAsOf(await evalCtx(sb, params(b.params)));
  return { ...out, health: personHealth(p.facts || {}, rowCtx(p, ctx)) };
}

const reasonOf = (b) => {
  const r = String(b.reason || '').trim();
  if (r.length < 10) throw new Error('give a reason (10+ characters)');
  return r.slice(0, 300);
};

/** The hold takes effect at once on this one person's facts; the next rebuild reads it from the holds table. */
async function patchHold(sb, p, hold) {
  const { error } = await sb.from('customer_person').update({ facts: { ...(p.facts || {}), relationship_hold: hold } }).eq('person_id', p.person_id);
  if (error) throw new Error(error.message);
}

async function holdSet(sb, b) {
  const reason = reasonOf(b);
  const p = await personFacts(sb, b.person_id);
  if (p.facts?.relationship_hold) throw new Error('this person already has a relationship hold (clear it first to change the reason)');
  const { data, error } = await sb.from('marketing_relationship_holds').insert({ person_id: p.person_id, anchor_key: p.anchor_key, reason, set_by: SET_BY }).select('hold_id, set_at').single();
  if (error) throw new Error(error.message);
  const hold = { hold_id: data.hold_id, reason, set_by: SET_BY, set_at: data.set_at };
  await patchHold(sb, p, hold);
  return { person_id: p.person_id, relationship_hold: hold };
}

async function holdClear(sb, b) {
  const reason = reasonOf(b);
  const p = await personFacts(sb, b.person_id);
  const { data, error } = await sb.from('marketing_relationship_holds').update({ cleared_at: new Date().toISOString(), cleared_by: SET_BY, clear_reason: reason }).eq('person_id', p.person_id).is('cleared_at', null).select('hold_id');
  if (error) throw new Error(error.message);
  await patchHold(sb, p, null);
  return { person_id: p.person_id, cleared: (data || []).length };
}

export const QUERY_GETS = {
  'query-fields': async (sb) => {
    const camps = await recentCampaigns(sb);
    return {
      fields: catalogue(), presets: PRESETS, option_labels: OPTION_LABELS,
      columns: Object.fromEntries(Object.entries(COLUMNS).map(([k, c]) => [k, { label: c.label, money: !!c.money, date: !!c.date, chips: !!c.chips, option: !!c.option }])),
      campaigns: camps.list.map(({ id, subject, sent_on }) => ({ id, subject, sent_on })), campaign_window_start: camps.start,
      topics: TOPICS.map(({ key, label }) => ({ key, label })), topic_map_version: TOPIC_MAP_VERSION
    };
  },
  groups: (sb) => listGroups(sb),
  'group-versions': (sb, q) => groupVersions(sb, q.segment_id),
  'client-health': (sb) => health(sb)
};

export const QUERY_POSTS = {
  'query-run': run,
  'customer-why': why,
  'group-save': (sb, b) => saveGroup(sb, b, SET_BY),
  'group-preview': preview,
  'client-health': (sb) => health(sb),
  'relationship-hold-set': holdSet,
  'relationship-hold-clear': holdClear
};
