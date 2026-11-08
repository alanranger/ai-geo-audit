/** Customer query / saved-group actions for /api/aigeo/marketing (admin key checked by the route for every action). */
import { customerDetail } from '../customers.mjs';
import { evalCtx, loadPeople, recentCampaigns } from '../overview.mjs';
import { OPTION_LABELS, catalogue } from './fields.mjs';
import { TOPICS, TOPIC_MAP_VERSION } from './topics.mjs';
import { groupVersions, listGroups, previewGroup, saveGroup } from './groups.mjs';
import { COLUMNS, PRESETS, runQuery } from './table.mjs';

const SET_BY = 'Alan (dashboard, admin key)';
const params = (p = {}) => ({ centre: p.centre, max_miles: p.max_miles, warm_days: p.warm_days, cooling_days: p.cooling_days });

async function run(sb, b) {
  const ctx = await evalCtx(sb, params(b.params));
  const t0 = Date.now();
  const { members, ...out } = runQuery(await loadPeople(sb), b.query, ctx, { sort: b.sort, dir: b.dir, page: b.page, columns: b.columns, show: b.show, q: b.q, summary: !!b.summary });
  return { ...out, centre: ctx.centre, as_of: new Date().toISOString(), engagement_coverage: ctx.engagement_coverage, academy_feed: ctx.academyFeed, ms: Date.now() - t0 };
}

async function preview(sb, b) {
  const ctx = await evalCtx(sb, params(b.params));
  return previewGroup(sb, b.segment_id, await loadPeople(sb), ctx, { record: !!b.record, by: SET_BY });
}

export const QUERY_GETS = {
  'query-fields': async (sb) => {
    const camps = await recentCampaigns(sb);
    return {
      fields: catalogue(), presets: PRESETS, option_labels: OPTION_LABELS,
      columns: Object.fromEntries(Object.entries(COLUMNS).map(([k, c]) => [k, { label: c.label, money: !!c.money, date: !!c.date, chips: !!c.chips }])),
      campaigns: camps.list.map(({ id, subject, sent_on }) => ({ id, subject, sent_on })), campaign_window_start: camps.start,
      topics: TOPICS.map(({ key, label }) => ({ key, label })), topic_map_version: TOPIC_MAP_VERSION
    };
  },
  groups: (sb) => listGroups(sb),
  'group-versions': (sb, q) => groupVersions(sb, q.segment_id)
};

export const QUERY_POSTS = {
  'query-run': run,
  'customer-why': async (sb, b) => customerDetail(sb, b.person_id, params(b.params), b.query || null),
  'group-save': (sb, b) => saveGroup(sb, b, SET_BY),
  'group-preview': preview
};
