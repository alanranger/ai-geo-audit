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

export async function createExport(sb, { segment_ids: ids, params = {}, campaign_key: campaignKey, list_name: name, created_by: by }, profileSync) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('choose at least one segment');
  const list = validListName(name);
  const sync = await profileSync();
  const segs = (await allSegments(sb)).filter((s) => ids.includes(s.segment_id));
  if (segs.length !== ids.length) throw new Error('unknown segment');
  const defs = segs.map((s) => withParams(s.definition, params));
  const people = await loadPeople(sb);
  const ctx = await evalCtx(sb, params);
  const r = evaluate(people, defs, ctx);
  const now = new Date().toISOString();
  const status = IMPORT_BLOCK.blocked ? 'blocked' : 'pending_import';
  const row = { segment_ids: ids, campaign_key: campaignKey || null, list_name: list, definition_snapshot: { segments: segs.map((s) => ({ segment_id: s.segment_id, name: s.name })), definitions: defs, params, centre: ctx.centre },
    source_sync_at: now, eligible_count: r.count, exclusions: r.exclusions, status, status_history: [{ status, at: now, by, note: IMPORT_BLOCK.blocked ? IMPORT_BLOCK.reason : null }], created_by: by };
  const { data, error } = await sb.from('marketing_segment_exports').insert(row).select('export_id').single();
  if (error) throw new Error(`marketing_segment_exports: ${error.message}`);
  const members = r.members.map((p) => ({ export_id: data.export_id, person_id: p.person_id, email: p.facts.email, first_name: splitName(p.facts, p.display_name).first, last_name: splitName(p.facts, p.display_name).last }));
  for (let i = 0; i < members.length; i += 500) {
    const { error: e2 } = await sb.from('marketing_segment_export_members').insert(members.slice(i, i + 500));
    if (e2) throw new Error(`marketing_segment_export_members: ${e2.message}`);
  }
  const reserved = campaignKey ? await reserveFor(sb, campaignKey, data.export_id, ids, r.count) : null;
  return { export_id: data.export_id, list_name: list, status, import_block: IMPORT_BLOCK.blocked ? IMPORT_BLOCK.reason : null, eligible_count: r.count, exclusions: r.exclusions, consent_recheck: sync, reserved };
}

/**
 * Test snapshot for proving the load checks: Alan's own @alanranger.com addresses only, list name must start
 * "ARP | TEST |". force_include (test only) puts a not-subscribed business address into the import so the after-check
 * can be shown catching the flip.
 */
export async function createTestExport(sb, { emails, force_include: force = [], list_name: name, created_by: by }) {
  const list = validListName(name);
  if (!list.startsWith('ARP | TEST |')) throw new Error('test list names must start "ARP | TEST |"');
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
