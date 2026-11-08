/**
 * Re-read every Pick n Mix plan statement file on Alan's PC into Supabase (pnm_plans / _payments / _events / _files).
 * Read-only on the files. Drafts, options and conflicted copies are skipped by name; when one client has several
 * sheets for the same plan start, the most recently edited file wins (the others are listed as superseded).
 *   node --env-file=.env.local scripts/pnm-plans/import.mjs [--run-id=<marketing_collector_runs id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { serviceClient, upsertChunks } from '../../lib/marketing/store.mjs';
import { parseSheet, planSheets, SKIP_FILE, TEMPLATE_FILE } from './parse.mjs';

export const PLAN_ROOT = process.env.PNM_PLAN_ROOT || 'G:/Dropbox/1. Bookings/Pick n Mix Agreements';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'signatures' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const rel = (f) => path.relative(PLAN_ROOT, f).split(path.sep).join('/');

function readAll(files, onFile) {
  const parsed = [];
  const fileRows = [];
  files.forEach((f, i) => {
    const modified = fs.statSync(f).mtime.toISOString();
    onFile?.(i, files.length);
    if (SKIP_FILE.test(path.basename(f))) { fileRows.push({ source_file: rel(f), sheet: '*', status: 'skipped_name', problem: 'draft / option / conflicted copy', file_modified: modified }); return; }
    if (TEMPLATE_FILE.test(path.basename(f))) { fileRows.push({ source_file: rel(f), sheet: '*', status: 'skipped_name', problem: 'template (no client in the file name)', file_modified: modified }); return; }
    let wb;
    try { wb = XLSX.readFile(f); } catch (e) { fileRows.push({ source_file: rel(f), sheet: '*', status: 'unreadable', problem: String(e.message).slice(0, 200), file_modified: modified }); return; }
    for (const sheet of planSheets(wb)) {
      const r = parseSheet(wb.Sheets[sheet], path.basename(f));
      if (r.problem) fileRows.push({ source_file: rel(f), sheet, status: 'unparsed', problem: r.problem, file_modified: modified });
      else parsed.push({ ...r, source_file: rel(f), sheet, file_modified: modified });
    }
  });
  return { parsed, fileRows };
}

/** One plan per client + start date: the most recently edited file wins. */
function latestPerPlan(parsed) {
  const best = new Map();
  for (const p of parsed) {
    const who = p.plan.email || String(p.plan.client_name || '').toLowerCase().replace(/\s+/g, ' ');
    const k = `${who}|${p.plan.starts || p.sheet}`;
    if (!best.has(k) || p.file_modified > best.get(k).file_modified) best.set(k, p);
  }
  return new Set(best.values());
}

export async function importPlans(sb, { onProgress } = {}) {
  const files = walk(PLAN_ROOT).filter((f) => /\.xls[xm]$/i.test(f));
  const { parsed, fileRows } = readAll(files, (i, n) => onProgress?.(i, n, 'Reading plan files'));
  const keep = latestPerPlan(parsed);
  const plans = [];
  const payments = [];
  const events = [];
  for (const p of parsed) {
    const status = keep.has(p) ? 'imported' : 'superseded';
    fileRows.push({ source_file: p.source_file, sheet: p.sheet, status, problem: status === 'superseded' ? 'a later file for the same client and plan start exists' : null, file_modified: p.file_modified });
    if (status !== 'imported') continue;
    const plan_key = `${p.source_file}#${p.sheet}`;
    plans.push({ plan_key, source_file: p.source_file, sheet: p.sheet, file_modified: p.file_modified, ...p.plan, paid_total: Math.round(p.payments.filter((x) => !x.scheduled_only).reduce((a, x) => a + x.amount, 0) * 100) / 100, imported_at: new Date().toISOString() });
    payments.push(...p.payments.map((x) => ({ plan_key, line_no: x.line_no, amount: x.amount, paid_on: x.paid_on, raw_date: x.raw_date, date_reliable: x.date_reliable, scheduled_only: x.scheduled_only })));
    events.push(...p.events.map((x) => ({ plan_key, ...x })));
  }
  onProgress?.(files.length, files.length, 'Saving plans');
  await sb.from('pnm_plans').delete().neq('plan_key', '');
  await sb.from('pnm_plan_files').delete().neq('source_file', '');
  await upsertChunks(sb, 'pnm_plans', plans, 'plan_key');
  await upsertChunks(sb, 'pnm_plan_payments', payments, 'plan_key,line_no');
  await upsertChunks(sb, 'pnm_plan_events', events, 'plan_key,line_no');
  await upsertChunks(sb, 'pnm_plan_files', fileRows, 'source_file,sheet');
  const count = (s) => fileRows.filter((r) => r.status === s).length;
  return { files: files.length, plans: plans.length, payments: payments.length, paid_total: Math.round(plans.reduce((a, p) => a + p.paid_total, 0)), events: events.length, with_email: plans.filter((p) => p.email).length, superseded: count('superseded'), unparsed: count('unparsed'), skipped_name: count('skipped_name'), unreadable: count('unreadable') };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const sb = serviceClient();
  const runId = (process.argv.find((a) => a.startsWith('--run-id=')) || '').split('=')[1] || null;
  const progress = (i, n, step) => (runId ? sb.from('marketing_collector_runs').update({ heartbeat_at: new Date().toISOString(), items_done: i, items_total: n, checkpoint: { step } }).eq('run_id', runId).then(() => {}) : null);
  try {
    const out = await importPlans(sb, { onProgress: progress });
    if (runId) await sb.from('marketing_collector_runs').update({ status: 'ok', finished_at: new Date().toISOString(), items_done: out.files, items_total: out.files, summary: out }).eq('run_id', runId);
    console.log(JSON.stringify(out));
  } catch (e) {
    if (runId) await sb.from('marketing_collector_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: String(e.message).slice(0, 500) }).eq('run_id', runId);
    console.error(e.message);
    process.exitCode = 1;
  }
}
