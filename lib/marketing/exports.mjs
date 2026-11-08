/**
 * Segment → Squarespace import CSV. Nothing is sent and nothing is written to Squarespace from here: the dashboard makes
 * a CSV for ChatGPT / Alan to import, and keeps the audience snapshot server-side with status pending_import →
 * imported / cancelled / blocked. Consent is re-read from Squarespace when the export is made, and checked again
 * against the latest stored profiles + suppression list every time the CSV is downloaded.
 */
import { IMPORT_BLOCK } from './import-block.mjs';
import { consentReason, evaluate } from './segments.mjs';
import { allSegments, evalCtx, loadPeople, withParams } from './overview.mjs';
import { emailHash, selectAll } from './store.mjs';
import { isAdminEmail } from './identity.mjs';
import { badgeWatermark, badgesOf, isOwner } from './client-health.mjs';
import { rowCtx } from './query/evaluate.mjs';

export const STATUSES = ['pending_import', 'load_queued', 'loading', 'loaded', 'blocked_do_not_send', 'load_failed', 'imported', 'cancelled', 'blocked'];
const NAME_OK = /^[A-Za-z0-9 |&'()\-_.:]{3,75}$/;

export function listName(campaignShort, segmentName, isoDay) {
  const clean = (s) => String(s || '').replace(/[^A-Za-z0-9 &'()\-_.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `ARP | ${clean(campaignShort) || 'Campaign'} | ${clean(segmentName)} | ${isoDay}`;
}

export function validListName(name) {
  if (!NAME_OK.test(String(name || ''))) throw new Error('list name: 3-75 characters (Squarespace limit), letters, numbers, spaces and | & \' ( ) - _ . : only');
  return String(name);
}

/** Spreadsheet-safe text for review files (names only; email addresses are never altered). */
export const safeCell = (v) => {
  const s = String(v ?? '');
  const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const splitName = (f, display) => {
  const parts = String(f?.name || display || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
};

/** A list name already used by a live snapshot is refused (never renamed or appended to silently). */
export async function assertNameFree(sb, name) {
  const { data, error } = await sb.from('marketing_segment_exports').select('export_id, status, created_at').eq('list_name', name).neq('status', 'cancelled').limit(1);
  if (error) throw new Error(error.message);
  if (data?.length) throw new Error(`a snapshot called "${name}" already exists (${data[0].status}). Nothing was created. Next: give this one a different list name (e.g. add "v2"), or cancel the old snapshot first.`);
}

/** Snapshots frozen from 8 Nov 2026 20:28 hold client people + exactly 1 business copy; earlier ones are "pre-fix". */
export const FROZEN_RULE = 'people+1 business copy (from 8 Nov 2026)';
const isOrgRecord = (p) => !isOwner(p.facts) && p.facts?.record_type === 'organisation';

/**
 * What a snapshot freezes (same rule as the send budget's audienceSplit): client people, no organisations, and Alan's
 * business address once (matched or always-on); a second owner address is left out. Pure.
 */
export function freezeSet(r) {
  const owners = r.members.filter((p) => isOwner(p.facts));
  const business = owners.find((p) => p.facts?.admin) || null;
  const people = r.members.filter((p) => !isOwner(p.facts) && !isOrgRecord(p));
  return {
    members: business ? [...people, business] : people, people: people.length, business_copy_ids: business ? [business.person_id] : [],
    left_out: { organisations: r.members.filter(isOrgRecord).length, owner_addresses: owners.length - (business ? 1 : 0) }
  };
}
function frozenOwner(fs, includeOwner) {
  return {
    included: includeOwner, count: 0, kinds: {}, business_copy: fs.business_copy_ids.length, business_copy_ids: fs.business_copy_ids, person_ids: fs.business_copy_ids,
    left_out: fs.left_out, frozen_rule: FROZEN_RULE, note: 'client people + 1 business copy; organisations and any second owner address are left out (never counted as clients)'
  };
}

export async function createExport(sb, { segment_ids: ids, params = {}, campaign_key: campaignKey, list_name: name, created_by: by, include_owner: includeOwnerFlag }, profileSync) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('choose at least one segment');
  const list = validListName(name);
  if (list.startsWith('ARP | TEST |')) throw new Error('"ARP | TEST |" names are for test snapshots only');
  await assertNameFree(sb, list);
  const sync = await profileSync();
  const segs = (await allSegments(sb)).filter((s) => ids.includes(s.segment_id));
  if (segs.length !== ids.length) throw new Error('unknown segment');
  const defs = segs.map((s) => withParams(s.definition, params));
  const people = await loadPeople(sb);
  const ctx = await evalCtx(sb, params);
  const includeOwner = includeOwnerFlag !== false;
  const r = evaluate(people, defs, ctx, { includeOwner });
  const fs = freezeSet(r);
  const now = new Date().toISOString();
  const status = IMPORT_BLOCK.blocked ? 'blocked' : 'pending_import';
  const owner = frozenOwner(fs, includeOwner);
  const row = { segment_ids: ids, campaign_key: campaignKey || null, list_name: list, definition_snapshot: { segments: segs.map((s) => ({ segment_id: s.segment_id, name: s.name })), definitions: defs, params, centre: ctx.centre, owner, health: badgeWatermark(ctx) },
    source_sync_at: now, eligible_count: fs.people, exclusions: r.exclusions, status, status_history: [{ status, at: now, by, note: IMPORT_BLOCK.blocked ? IMPORT_BLOCK.reason : null }], created_by: by };
  const { data, error } = await sb.from('marketing_segment_exports').insert(row).select('export_id').single();
  if (error) throw new Error(`marketing_segment_exports: ${error.message}`);
  const members = fs.members.map((p) => ({ export_id: data.export_id, person_id: p.person_id, email: p.facts.email, first_name: splitName(p.facts, p.display_name).first, last_name: splitName(p.facts, p.display_name).last }));
  for (let i = 0; i < members.length; i += 500) {
    const { error: e2 } = await sb.from('marketing_segment_export_members').insert(members.slice(i, i + 500));
    if (e2) throw new Error(`marketing_segment_export_members: ${e2.message}`);
  }
  const reserved = campaignKey ? await reserveFor(sb, campaignKey, data.export_id, ids, fs.members.length) : null;
  return { export_id: data.export_id, list_name: list, status, import_block: IMPORT_BLOCK.blocked ? IMPORT_BLOCK.reason : null, eligible_count: fs.people, sends: fs.members.length, owner_included: 0, business_copy: owner.business_copy, left_out: fs.left_out, frozen_rule: FROZEN_RULE, exclusions: r.exclusions, consent_recheck: sync, reserved };
}

/* ---------- snapshot review (badges) and the manual exclusion list ---------- */

/** Snapshots whose membership may still be edited by hand: not loaded, not loading. */
const EDITABLE = ['pending_import', 'blocked', 'load_failed'];
const reviewRow = (p, ctx) => ({ person_id: p.person_id, name: p.facts?.name || p.display_name || null, email: p.facts?.email || null, owner: isOwner(p.facts), badges: badgesOf(p.facts || {}, rowCtx(p, ctx)) });

async function frozenReview(sb, id, people, ctx) {
  const { data: exp, error } = await sb.from('marketing_segment_exports').select('export_id, list_name, status, eligible_count, created_at, definition_snapshot, is_test').eq('export_id', id).maybeSingle();
  if (error || !exp) throw new Error('snapshot not found');
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email', (q) => q.eq('export_id', id));
  const excluded = await selectAll(sb, 'marketing_snapshot_exclusions', 'exclusion_id, person_id, reason, set_by, set_at', (q) => q.eq('export_id', id).is('restored_at', null));
  const byId = new Map(people.map((p) => [p.person_id, p]));
  const frozenOwners = new Set(exp.definition_snapshot?.owner?.person_ids || []);
  const copyIds = new Set(exp.definition_snapshot?.owner?.business_copy_ids || []);
  const rowOf = (pid, email) => { const p = byId.get(pid) || { person_id: pid, facts: { email } }; const r = reviewRow(p, ctx); return { ...r, owner: r.owner || frozenOwners.has(pid), business_copy: copyIds.has(pid) }; };
  const rows = members.map((m) => rowOf(m.person_id, m.email));
  return {
    mode: 'snapshot', export_id: id, list_name: exp.list_name, status: exp.status, frozen_count: exp.eligible_count, frozen_at: exp.created_at, owner: exp.definition_snapshot?.owner || null,
    frozen_rule: exp.definition_snapshot?.owner?.frozen_rule || 'pre-fix (frozen before 8 Nov 2026 20:28; may include an organisation and a second owner address)',
    clients: rows.filter((r) => !r.owner).length, owner_addresses: rows.filter((r) => r.owner && !r.business_copy).length, business_copy: rows.filter((r) => r.business_copy).length, editable: EDITABLE.includes(exp.status) && !exp.is_test,
    members: rows, excluded: excluded.map((x) => ({ ...rowOf(x.person_id, null), reason: x.reason, set_by: x.set_by, set_at: x.set_at })), health: badgeWatermark(ctx),
    note: 'Membership is frozen at the snapshot; badges are today\'s (same as-of as every other table). Nothing here rewrites the snapshot.'
  };
}

/** Review people with health badges: a saved snapshot (frozen members) or, before saving, the picked segments. */
export async function snapshotReview(sb, b) {
  const params = b.params || {};
  const ctx = await evalCtx(sb, params);
  const people = await loadPeople(sb);
  if (b.export_id) return frozenReview(sb, b.export_id, people, ctx);
  const segs = (await allSegments(sb)).filter((s) => (b.segment_ids || []).includes(s.segment_id));
  if (!segs.length) throw new Error('choose at least one segment');
  const r = evaluate(people, segs.map((s) => withParams(s.definition, params)), ctx, { includeOwner: b.include_owner !== false });
  const copyIds = new Set(r.business_copy_ids);
  const members = r.members.map((p) => ({ ...reviewRow(p, ctx), business_copy: copyIds.has(p.person_id) }));
  return { mode: 'preview', count: r.count, owner_addresses: r.owner_included, owner_kinds: r.owner_kinds, business_copy: r.business_copy, exclusions: r.exclusions, members, health: badgeWatermark(ctx) };
}

const reasonOf = (r) => {
  const s = String(r || '').trim();
  if (s.length < 10) throw new Error('give a reason (10+ characters)');
  return s.slice(0, 300);
};
async function editableExport(sb, id) {
  const { data, error } = await sb.from('marketing_segment_exports').select('export_id, status, is_test').eq('export_id', id).maybeSingle();
  if (error || !data) throw new Error('snapshot not found');
  if (!EDITABLE.includes(data.status) || data.is_test) throw new Error(`this snapshot is ${data.status}: its people can't be changed by hand (make a new snapshot instead)`);
  return data;
}

/** "Don't send this one to X": the member row moves to the exclusion log (typed reason); nobody is ever added. */
export async function excludeMember(sb, b, by) {
  const reason = reasonOf(b.reason);
  await editableExport(sb, b.export_id);
  const { data: m, error } = await sb.from('marketing_segment_export_members').select('*').eq('export_id', b.export_id).eq('person_id', b.person_id).maybeSingle();
  if (error || !m) throw new Error('that person is not in this snapshot');
  const { error: e1 } = await sb.from('marketing_snapshot_exclusions').insert({ export_id: b.export_id, person_id: b.person_id, member_row: m, reason, set_by: by });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.from('marketing_segment_export_members').delete().eq('export_id', b.export_id).eq('person_id', b.person_id);
  if (e2) throw new Error(e2.message);
  return { export_id: b.export_id, excluded: 1 };
}

/** Undo an exclusion: only the person's original snapshot row goes back (CSV and list loads re-check consent anyway). */
export async function restoreMember(sb, b, by) {
  const reason = reasonOf(b.reason);
  await editableExport(sb, b.export_id);
  const { data: x, error } = await sb.from('marketing_snapshot_exclusions').select('exclusion_id, member_row').eq('export_id', b.export_id).eq('person_id', b.person_id).is('restored_at', null).maybeSingle();
  if (error || !x) throw new Error('no active exclusion for that person on this snapshot');
  const { export_id: exportId, person_id: personId, email, first_name: first, last_name: last } = x.member_row;
  const { error: e1 } = await sb.from('marketing_segment_export_members').insert({ export_id: exportId, person_id: personId, email, first_name: first, last_name: last });
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.from('marketing_snapshot_exclusions').update({ restored_at: new Date().toISOString(), restored_by: by, restore_reason: reason }).eq('exclusion_id', x.exclusion_id);
  if (e2) throw new Error(e2.message);
  return { export_id: b.export_id, restored: 1 };
}

/**
 * Test snapshot for proving the load checks: Alan's own @alanranger.com addresses only, list name must start
 * "ARP | TEST |". force_include (test only) puts a not-subscribed business address into the import so the after-check
 * can be shown catching the flip.
 */
export async function createTestExport(sb, { emails, force_include: force = [], list_name: name, created_by: by }) {
  const list = validListName(name);
  if (!list.startsWith('ARP | TEST |')) throw new Error('test list names must start "ARP | TEST |"');
  await assertNameFree(sb, list);
  const all = [...new Set((emails || []).map((e) => String(e).trim().toLowerCase()))];
  if (!all.length || all.some((e) => !isAdminEmail(e))) throw new Error('test snapshots may only contain @alanranger.com addresses');
  const now = new Date().toISOString();
  const row = { segment_ids: [], list_name: list, is_test: true, definition_snapshot: { test: true, test_force_include: force.map((e) => emailHash(String(e).toLowerCase())) },
    source_sync_at: now, eligible_count: all.length, exclusions: {}, status: 'pending_import', status_history: [{ status: 'pending_import', at: now, by, note: 'test snapshot (business addresses only)' }], created_by: by };
  const { data, error } = await sb.from('marketing_segment_exports').insert(row).select('export_id').single();
  if (error) throw new Error(error.message);
  const persons = await selectAll(sb, 'customer_person', 'person_id, facts');
  const byEmail = new Map(persons.map((p) => [p.facts?.email, p.person_id]));
  const members = all.map((e) => ({ export_id: data.export_id, person_id: byEmail.get(e) || null, email: e, first_name: 'Alan', last_name: 'Ranger (test)' }));
  if (members.some((m) => !m.person_id)) throw new Error('address not found in customers; run a sync first');
  const { error: e2 } = await sb.from('marketing_segment_export_members').insert(members);
  if (e2) throw new Error(e2.message);
  return { export_id: data.export_id, list_name: list, members: members.length };
}

/** A snapshot made for a campaign record reserves its (deduplicated) audience size on that record's send budget. */
async function reserveFor(sb, campaignKey, exportId, segmentIds, count) {
  const { data, error } = await sb.from('strategy_campaigns').update({ reserved_sends: count, segment_ids: segmentIds, export_id: exportId, updated_at: new Date().toISOString() }).eq('campaign_key', campaignKey).select('campaign_key');
  if (error) throw new Error(error.message);
  return data?.length ? { campaign_key: campaignKey, reserved_sends: count } : { campaign_key: campaignKey, note: 'no campaign record with that key; nothing reserved' };
}

/** CSV for import: members still subscribed + unsuppressed right now; dropped ones are counted, not exported. */
export async function exportCsv(sb, exportId) {
  const { data: exp, error } = await sb.from('marketing_segment_exports').select('*').eq('export_id', exportId).maybeSingle();
  if (error || !exp) throw new Error('export not found');
  if (IMPORT_BLOCK.csv_blocked) throw new Error(`CSV download is off: ${IMPORT_BLOCK.reason}`);
  if (exp.status === 'blocked' || exp.status === 'cancelled') throw new Error(`export is ${exp.status}`);
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, first_name, last_name', (q) => q.eq('export_id', exportId));
  const people = new Map((await loadPeople(sb)).map((p) => [p.person_id, p.facts]));
  const suppressed = new Set((await selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')).filter((s) => !s.resolved_at).map((s) => s.email_hash));
  const keep = [];
  const dropped = {};
  for (const m of members) {
    const why = consentReason(people.get(m.person_id)) || (suppressed.has(emailHash(m.email)) ? 'suppressed' : null);
    if (why) dropped[why] = (dropped[why] || 0) + 1;
    else keep.push(m);
  }
  const csv = ['Email Address,First Name,Last Name', ...keep.map((m) => `${m.email},${safeCell(m.first_name)},${safeCell(m.last_name)}`)].join('\r\n');
  return { csv, rows: keep.length, dropped, list_name: exp.list_name };
}

export async function setExportStatus(sb, { export_id: id, status, note, by }) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  if (status !== 'cancelled') throw new Error('only cancelling is done by hand; load states are set by the consent-checked load');
  const { data: exp, error } = await sb.from('marketing_segment_exports').select('status_history').eq('export_id', id).maybeSingle();
  if (error || !exp) throw new Error('export not found');
  const history = [...(exp.status_history || []), { status, at: new Date().toISOString(), by, note: note ? String(note).slice(0, 300) : null }];
  const { error: e2 } = await sb.from('marketing_segment_exports').update({ status, status_history: history }).eq('export_id', id);
  if (e2) throw new Error(e2.message);
  return { export_id: id, status };
}
