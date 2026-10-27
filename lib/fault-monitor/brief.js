/**
 * Monday CEO brief line + dashboard summary for the silent fault monitor.
 * The brief shows NOTHING when there are no open red faults.
 */
import { loadOpenFindings, latestRun } from './store.js';
import { truncate } from './text.js';

function pageLabel(f) {
  if (!f.url) return f.check_id;
  return String(f.url).replace(/^https?:\/\/(www\.)?alanranger\.com/, '').replace(/^\/blog-on-photography\//, '') || '/';
}

/** Money-page faults first, then other page checks, then tool/data-sync aggregates, then per-URL sync rows. */
function briefPriority(f) {
  if (f.check_id === 'D5' && f.url) return 3;
  if (!f.url) return 2;
  return f.page_type === 'money' ? 0 : 1;
}

export async function loadFaultSummary(sb) {
  const open = await loadOpenFindings(sb);
  const red = open.filter((f) => f.severity === 'red').sort((a, b) => briefPriority(a) - briefPriority(b));
  const run = await latestRun(sb);
  return {
    red_count: red.length,
    amber_count: open.length - red.length,
    top_red: red.slice(0, 3).map((f) => ({ page: pageLabel(f), title: f.title })),
    last_run_at: run?.finished_at || run?.started_at || null
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** One red line for the brief header, or '' when nothing red is open. */
export function renderSilentFaultsLine(summary, ff = '') {
  if (!summary || !summary.red_count) return '';
  const names = summary.top_red.map((t) => `${esc(t.page)} (${esc(truncate(t.title, 70))})`).join('; ');
  const more = summary.red_count > summary.top_red.length ? `; +${summary.red_count - summary.top_red.length} more` : '';
  return `<tr><td style="padding:12px 28px 0;"><div style="border-left:4px solid #d92d20;background:#fef3f2;border-radius:8px;padding:10px 12px;color:#7a271a;font-size:13px;line-height:1.5;${ff}">🔴 <b>Silent faults: ${summary.red_count} red</b> — ${names}${more}. See <b>Silent faults</b> in the dashboard.</div></td></tr>`;
}
