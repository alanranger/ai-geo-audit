/**
 * Saved groups: a structured query stored in marketing_segments (definition.query, so audience snapshots and list
 * loads use it like any segment) with every edit kept in marketing_segment_versions. "Check now" records who matched;
 * the preview compares today's matches with the last check and says why each person joined or left.
 */
import { describe, validateQuery } from './english.mjs';
import { explain, runQuery } from './table.mjs';
import { rowCtx } from './evaluate.mjs';
import { badgeWatermark, badgesOf, isOwner } from '../client-health.mjs';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export async function listGroups(sb) {
  const { data: segs, error } = await sb.from('marketing_segments').select('segment_id, name, description, definition, updated_at, set_by').not('definition->query', 'is', null).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const { data: evals } = await sb.from('marketing_segment_evaluations').select('segment_id, version, evaluated_at, counts').order('evaluated_at', { ascending: false }).limit(500);
  const last = new Map();
  for (const e of evals || []) if (!last.has(e.segment_id)) last.set(e.segment_id, e);
  return { groups: (segs || []).map((s) => ({ segment_id: s.segment_id, name: s.name, description: s.description, version: s.definition.version, purpose: s.definition.purpose || null, english: s.definition.english, query: s.definition.query, updated_at: s.updated_at, last_check: last.get(s.segment_id) || null })) };
}

export async function saveGroup(sb, b, by) {
  const query = validateQuery(b.query);
  const name = String(b.name || '').trim().slice(0, 120);
  if (name.length < 3) throw new Error('give the group a name (3+ characters)');
  const id = b.segment_id || `q-${slug(name)}-${Date.now().toString(36)}`;
  const { data: prev } = await sb.from('marketing_segment_versions').select('version').eq('segment_id', id).order('version', { ascending: false }).limit(1).maybeSingle();
  if (b.segment_id && !prev) throw new Error('unknown group');
  const version = (prev?.version || 0) + 1;
  const english = describe(query.root);
  const row = { segment_id: id, version, name, description: b.description ? String(b.description).slice(0, 500) : null, purpose: b.purpose ? String(b.purpose).slice(0, 200) : null, query, english, set_by: by };
  const { error } = await sb.from('marketing_segment_versions').insert(row);
  if (error) throw new Error(error.message);
  const seg = { segment_id: id, name, description: row.description, definition: { query, version, english, purpose: row.purpose }, is_builtin: false, set_by: by, updated_at: new Date().toISOString() };
  const { error: e2 } = await sb.from('marketing_segments').upsert(seg, { onConflict: 'segment_id' });
  if (e2) throw new Error(e2.message);
  return { segment_id: id, version, english };
}

export async function groupVersions(sb, id) {
  const { data, error } = await sb.from('marketing_segment_versions').select('version, name, english, set_by, created_at').eq('segment_id', id).order('version', { ascending: false });
  if (error) throw new Error(error.message);
  return { versions: data || [] };
}

const firstFail = (ex) => ex.lines.find((l) => l.depth === 1 && l.result !== 'yes') || ex.lines.find((l) => l.result !== 'yes');
const personOf = (p, ctx) => ({ person_id: p.person_id, name: p.facts?.name || p.display_name || null, email: p.facts?.email || null, badges: badgesOf(p.facts || {}, rowCtx(p, ctx)) });

/** People / owner addresses / organisations in a list of records (people = what every header counts). */
function split(list) {
  const owner = list.filter((p) => isOwner(p.facts)).length;
  const organisations = list.filter((p) => !isOwner(p.facts) && p.facts?.record_type === 'organisation').length;
  return { people: list.length - owner - organisations, owner, organisations };
}

/** Today's members vs the last recorded check; `record` saves today's as the new check. Owners are counted apart. */
export async function previewGroup(sb, id, people, ctx, { record, by } = {}) {
  const { data: seg } = await sb.from('marketing_segments').select('segment_id, definition').eq('segment_id', id).maybeSingle();
  if (!seg?.definition?.query) throw new Error('unknown group');
  const run = runQuery(people, seg.definition.query, ctx, { columns: ['name'] });
  const now = new Set(run.members.map((p) => p.person_id));
  const { data: last } = await sb.from('marketing_segment_evaluations').select('version, evaluated_at, person_ids').eq('segment_id', id).order('evaluated_at', { ascending: false }).limit(1).maybeSingle();
  const before = new Set(last?.person_ids || []);
  const byId = new Map(people.map((p) => [p.person_id, p]));
  const joined = [...now].filter((x) => !before.has(x)).map((x) => byId.get(x));
  const left = [...before].filter((x) => !now.has(x)).map((x) => byId.get(x)).filter(Boolean);
  const h = run.header;
  const lastSplit = split([...before].map((x) => byId.get(x) || { facts: {} }));
  const j = split(joined);
  const l = split(left);
  const out = {
    segment_id: id, version: seg.definition.version, english: run.english, results: run.results, now: h.people, owner_addresses: h.owner_addresses, organisations: h.organisations, health: badgeWatermark(ctx),
    last_check: last ? { version: last.version, at: last.evaluated_at, count: lastSplit.people, owner_addresses: lastSplit.owner, organisations: lastSplit.organisations, records: before.size } : null,
    members: run.members.slice(0, 300).map((p) => personOf(p, ctx)),
    joined: joined.slice(0, 200).map((p) => ({ ...personOf(p, ctx), why: 'meets every condition now' })),
    left: left.slice(0, 200).map((p) => { const f = firstFail(explain(p, seg.definition.query, ctx)); return { ...personOf(p, ctx), why: f ? `${f.text} → ${f.result}${f.evidence ? ` (${f.evidence})` : ''}` : 'no longer in the sources' }; }),
    joined_count: j.people, joined_owner: j.owner, joined_organisations: j.organisations, left_count: l.people, left_owner: l.owner, left_organisations: l.organisations
  };
  if (record) {
    const { error } = await sb.from('marketing_segment_evaluations').insert({ segment_id: id, version: seg.definition.version, person_ids: [...now], counts: run.results, set_by: by });
    if (error) throw new Error(error.message);
    out.recorded = true;
  }
  return out;
}
