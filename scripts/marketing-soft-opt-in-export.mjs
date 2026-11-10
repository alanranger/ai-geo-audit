/**
 * Soft opt-in Stage 2 import CSV for the Squarespace mailing list "Existing customers – soft opt-in Nov 2026".
 * Re-checks consent right before export: only people whose stored facts carry consent_source =
 * soft_opt_in_existing_customer AND an active per-person consent_basis row, still not suppressed (stored facts and the
 * live suppression list), no unsubscribe event, not owner / held / pending, and not a Squarespace contact that is not
 * subscribed. Columns: Email, First Name, Last Name only. LOCAL ONLY: refuses a path inside the repo or Google Drive.
 * Never imports, never writes to the database or Squarespace. stdout = counts only.
 *   node scripts/marketing-soft-opt-in-export.mjs [--out=C:/TEMP/soft-opt-in/existing-customers-soft-opt-in-2026-11.csv]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFT_OPT_IN, consentBasisByHash } from '../lib/marketing/consent-basis.mjs';
import { BATCH, blockers } from './marketing-consent-basis-record.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = 'C:/TEMP/soft-opt-in/existing-customers-soft-opt-in-2026-11.csv';

/** Local-only guard: never the repo, never a synced Drive / Dropbox folder. */
export function safeOut(path) {
  const p = resolve(path).replace(/\\/g, '/').toLowerCase();
  const root = ROOT.replace(/\\/g, '/').toLowerCase();
  if (p.startsWith(root) || /google drive|dropbox|onedrive/.test(p)) throw new Error('refusing to write the CSV inside the repo or a synced folder');
  return resolve(path);
}

const cell = (v) => {
  const s = String(v ?? '').trim();
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** First word = first name, the rest = last name (the stored person name). */
export function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export function toCsv(people) {
  const lines = ['Email,First Name,Last Name', ...people.map((p) => { const n = splitName(p.facts?.name || p.display_name); return [p.email, n.first, n.last].map(cell).join(','); })];
  return `${lines.join('\r\n')}\r\n`;
}

function loadEnv() {
  for (const name of ['.env.vercel.prod', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(ROOT, name), 'utf8').split(/\r?\n/)) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      }
    } catch { /* optional */ }
  }
}

async function main() {
  loadEnv();
  const out = safeOut((process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || DEFAULT_OUT);
  const { serviceClient, selectAll, emailHash, normEmail } = await import('../lib/marketing/store.mjs');
  const { loadConsentBasis } = await import('../lib/marketing/consent-basis.mjs');
  const sb = serviceClient();
  const basis = consentBasisByHash(await loadConsentBasis(sb));
  const rows = await selectAll(sb, 'customer_person', 'person_id, email, display_name, facts', (q) => q.eq('facts->>consent_source', SOFT_OPT_IN));
  const live = rows.filter((p) => !p.facts?.stale).map((p) => ({ ...p, email: normEmail(p.email) }));
  const supp = await selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at');
  const unsub = await selectAll(sb, 'sqs_email_events', 'email', (q) => q.eq('event_type', 'UNSUBSCRIBED'));
  const ctx = { hash: emailHash, suppressedHashes: new Set(supp.filter((s) => !s.resolved_at).map((s) => s.email_hash)), unsubscribed: new Set(unsub.map((e) => normEmail(e.email))) };
  const checked = live.map((p) => ({ p, reasons: [...blockers(p, ctx), ...(basis.has(emailHash(p.email)) ? [] : ['no_active_basis_row'])] }));
  const ok = checked.filter((x) => !x.reasons.length).map((x) => x.p);
  const dropped = checked.filter((x) => x.reasons.length).map((x) => ({ person_id: x.p.person_id, reasons: x.reasons }));
  const ids = new Set(ok.map((p) => p.person_id));
  const notInBatch = [...ids].filter((id) => !BATCH.includes(id));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(ok.sort((a, b) => a.person_id.localeCompare(b.person_id))), 'utf8');
  console.log(JSON.stringify({ csv: out, rows: ok.length, columns: ['Email', 'First Name', 'Last Name'], dropped_at_recheck: dropped, batch_ids_missing: BATCH.filter((id) => !ids.has(id)), not_in_batch: notInBatch }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e.message || e); process.exit(1); });
