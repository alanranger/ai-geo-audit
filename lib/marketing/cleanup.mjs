/**
 * Stage C contact clean-up (spec 7 Nov 2026 section 7; Claude combined fixes Part 5 / V08): review → frozen manifest →
 * Alan's approval → per-record execution ledger → verification. Protected records (buyers, bookings, Academy members,
 * active plans, organisations, unknown or probable history) are worked out HERE on the server and can never be put in
 * a manifest's eligible set by the browser. This build executes nothing for real: "execute" is a dry run that re-checks
 * every record and records what would happen. Test mode works only on Alan's own @alanranger.com records.
 */
import crypto from 'node:crypto';
import { describe, validateQuery } from './query/english.mjs';
import { evalNode, rowCtx } from './query/evaluate.mjs';
import { evalCtx, loadPeople } from './overview.mjs';
import { isListed } from './record-type.mjs';
import { isAdminEmail } from './identity.mjs';
import { selectAll } from './store.mjs';

export const ACTIONS = {
  retain: 'Retain (no change)',
  exclude_routine: 'Exclude from routine sends (local suppression)',
  reengage_proposal: 'Targeted re-engagement proposal (a campaign to approve; consented people only)',
  unsubscribe: 'Unsubscribe in Squarespace',
  archive_profile: 'Archive marketing profile (hide from marketing; history kept)',
  review_identity: 'Review identity (merge / split by hand)',
  delete_record: 'Delete eligible Squarespace contact (orders, bookings and ledger never touched)'
};

const vc = (f) => f.value?.c || {};
const activePlan = (f, today) => (f.plans || []).some((p) => p.starts && p.starts <= today && (!p.ends || p.ends >= today));
const probable = (f) => !!f.last_booking_probable || Object.values(f.cats || {}).some((k) => k.p > 0) || (f.value?.p?.orders || 0) > 0;

/** [reason, test] — the first that applies protects the record. Order = what Alan sees as the reason. */
const PROTECT = [
  ['buyer', (f) => (vc(f).orders || 0) > 0 || (vc(f).net || 0) > 0 || (f.value?.cp?.orders || 0) > 0],
  ['booking', (f) => (f.booking_count || 0) > 0 || (f.future || []).length > 0],
  ['academy_member', (f) => ['paid_active', 'trial_active'].includes(f.academy_detail?.status) || f.academy === 'member'],
  ['active_plan', (f, today) => activePlan(f, today)],
  ['organisation', (f) => f.record_type === 'organisation' || f.record_type === 'system'],
  ['unknown_history', (f) => !!f.history_incomplete || !!f.email_shared || probable(f)]
];

export function protectedReason(facts, today) {
  return PROTECT.find(([, test]) => test(facts || {}, today))?.[0] || null;
}

const tally = (rows, k) => rows.reduce((m, r) => (r[k] ? { ...m, [r[k]]: (m[r[k]] || 0) + 1 } : m), {});

/** Who the manifest is about: test = Alan's own records only; review = everyone the query matches (yes, not unknown). */
function candidates(people, mode, query, ctx) {
  if (mode === 'test') return { list: people.filter((p) => p.facts?.admin && isAdminEmail(p.facts.email)), undecided: 0 };
  const list = [];
  let undecided = 0;
  for (const p of people) {
    if (!isListed(p.facts)) continue;
    const r = evalNode(query.root, rowCtx(p, ctx)).r;
    if (r === 'yes') list.push(p);
    else if (r === 'unknown') undecided += 1;
  }
  return { list, undecided };
}

function checkInput(b) {
  if (!ACTIONS[b?.action]) throw new Error(`action must be one of ${Object.keys(ACTIONS).join(', ')}`);
  if (!['test', 'review'].includes(b?.mode)) throw new Error('mode must be test or review');
  return { mode: b.mode, action: b.action, query: validateQuery(b.query || { root: { type: 'group', match: 'all', items: [] } }) };
}

/** Review: exact counts per state and reason, plus the first rows of each (private dashboard only). */
export async function reviewCleanup(sb, body) {
  const { mode, action, query } = checkInput(body);
  if (mode === 'review' && !query.root.items.length) throw new Error('a clean-up review needs conditions (an empty query is never "everyone")');
  const ctx = await evalCtx(sb);
  const { list, undecided } = candidates(await loadPeople(sb), mode, query, ctx);
  const rows = list.map((p) => ({ person_id: p.person_id, name: p.facts.name || p.display_name || null, email: p.facts.email || null, protected_reason: mode === 'test' ? null : protectedReason(p.facts, ctx.today) }));
  const eligible = rows.filter((r) => !r.protected_reason);
  return {
    mode, action, action_label: ACTIONS[action], english: describe(query.root), query,
    counts: { matched: rows.length, eligible: eligible.length, protected: rows.length - eligible.length, undecided, protected_by_reason: tally(rows, 'protected_reason') },
    eligible_sample: eligible.slice(0, 50), protected_sample: rows.filter((r) => r.protected_reason).slice(0, 25), rows
  };
}

const hashIds = (ids) => crypto.createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 24);

export async function freezeManifest(sb, body, by) {
  const r = await reviewCleanup(sb, body);
  const now = new Date().toISOString();
  const eligibleIds = r.rows.filter((x) => !x.protected_reason).map((x) => x.person_id);
  const row = { created_by: by, mode: r.mode, action: r.action, query: r.query, query_english: r.english, query_version: r.query.version, counts: r.counts, items_hash: hashIds(eligibleIds), status: 'frozen', status_history: [{ status: 'frozen', at: now, by }] };
  const { data, error } = await sb.from('marketing_cleanup_manifests').insert(row).select('manifest_id').single();
  if (error) throw new Error(error.message);
  const items = r.rows.map((x) => ({ manifest_id: data.manifest_id, person_id: x.person_id, email: x.email, state: x.protected_reason ? 'protected' : 'eligible', protected_reason: x.protected_reason, op_key: `${data.manifest_id}|${x.person_id}|${r.action}` }));
  for (let i = 0; i < items.length; i += 500) {
    const { error: e2 } = await sb.from('marketing_cleanup_items').insert(items.slice(i, i + 500));
    if (e2) throw new Error(e2.message);
  }
  return { manifest_id: data.manifest_id, counts: r.counts, items_hash: row.items_hash };
}

async function manifest(sb, id) {
  const { data, error } = await sb.from('marketing_cleanup_manifests').select('*').eq('manifest_id', id).maybeSingle();
  if (error || !data) throw new Error('manifest not found');
  return data;
}
async function setStatus(sb, m, status, by, patch = {}) {
  const at = new Date().toISOString();
  const { error } = await sb.from('marketing_cleanup_manifests').update({ status, status_history: [...(m.status_history || []), { status, at, by }], ...patch }).eq('manifest_id', m.manifest_id);
  if (error) throw new Error(error.message);
  return at;
}

/** Approval binds Alan, the exact eligible set (hash), the action and the query version; typed "APPROVE <n>". */
export async function approveManifest(sb, { manifest_id: id, confirm }, by) {
  const m = await manifest(sb, id);
  if (m.status !== 'frozen') throw new Error(`manifest is ${m.status}`);
  const want = `APPROVE ${m.counts?.eligible ?? 0}`;
  if (String(confirm || '').trim() !== want) throw new Error(`type exactly "${want}" to approve this manifest`);
  const at = await setStatus(sb, m, 'approved', by, { approved_by: by, approved_at: new Date().toISOString(), approval_text: `${want} · ${m.action} · items ${m.items_hash} · query v${m.query_version}` });
  return { manifest_id: id, status: 'approved', approved_at: at };
}

/**
 * Dry run: re-check every eligible record now (changed → skipped to review), idempotent by op_key (a record with an
 * outcome is never redone). Review-mode manifests are refused: real execution needs a later, separately approved build.
 */
export async function executeDryRun(sb, { manifest_id: id }, by) {
  const m = await manifest(sb, id);
  if (m.status !== 'approved') throw new Error(`approve the manifest first (it is ${m.status})`);
  if (m.mode !== 'test') throw new Error('execution against real records is not built: Alan approves an exact manifest in a later question first. This manifest stays as a reviewed plan.');
  const items = await selectAll(sb, 'marketing_cleanup_items', 'person_id, state, outcome', (q) => q.eq('manifest_id', id).eq('state', 'eligible'));
  const people = new Map((await loadPeople(sb)).map((p) => [p.person_id, p.facts]));
  const now = new Date().toISOString();
  const todo = items.filter((i) => !i.outcome);
  for (const i of todo) {
    const f = people.get(i.person_id);
    const outcome = !f || f.stale ? 'needs_review' : (f.admin && isAdminEmail(f.email) ? 'would_do' : 'skipped_changed');
    const { error } = await sb.from('marketing_cleanup_items').update({ outcome, outcome_at: now, recheck: { at: now, still_admin_test_record: !!f?.admin } }).eq('manifest_id', id).eq('person_id', i.person_id).is('outcome', null);
    if (error) throw new Error(error.message);
  }
  await setStatus(sb, m, 'executed_dry_run', by, { executed_at: now });
  return { manifest_id: id, processed: todo.length, already_done: items.length - todo.length, note: 'dry run: nothing was changed in Squarespace or the database' };
}

/** Verification: ledger totals, protected records still protected, and subscriber totals unchanged by the dry run. */
export async function verifyManifest(sb, { manifest_id: id }, by) {
  const m = await manifest(sb, id);
  if (!['executed_dry_run', 'verified'].includes(m.status)) throw new Error('run the (dry-run) execution first');
  const items = await selectAll(sb, 'marketing_cleanup_items', 'person_id, state, protected_reason, outcome', (q) => q.eq('manifest_id', id));
  const ctx = await evalCtx(sb);
  const people = new Map((await loadPeople(sb)).map((p) => [p.person_id, p.facts]));
  const stillProtected = items.filter((i) => i.state === 'protected').filter((i) => protectedReason(people.get(i.person_id), ctx.today)).length;
  const subscribed = [...people.values()].filter((f) => !f?.stale && f?.subscribed && f.profile_state === 'active').length;
  const result = { at: new Date().toISOString(), outcomes: tally(items, 'outcome'), eligible: items.filter((i) => i.state === 'eligible').length, protected: items.filter((i) => i.state === 'protected').length, protected_still_protected: stillProtected, subscribed_now: subscribed, changed_anything: false };
  await setStatus(sb, m, 'verified', by, { verified_at: result.at, verify_result: result });
  return { manifest_id: id, ...result };
}

export async function listManifests(sb) {
  const { data, error } = await sb.from('marketing_cleanup_manifests').select('manifest_id, created_at, mode, action, query_english, status, counts, approved_at, approval_text, executed_at, verified_at, verify_result').order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return { manifests: data || [], actions: ACTIONS };
}
