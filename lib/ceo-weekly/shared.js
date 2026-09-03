/**
 * Monday CEO weekly report — shared helpers (London week boundaries).
 */
export const DEFAULT_PROPERTY = 'https://www.alanranger.com';
export const CEO_REPORT_TO = process.env.CEO_WEEKLY_REPORT_TO || 'info@alanranger.com';

/** Monday date (YYYY-MM-DD) in Europe/London for the week containing `d`. */
export function londonWeekStartYmd(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const offset = map[parts.weekday] ?? 0;
  const utc = Date.parse(`${ymd}T12:00:00Z`);
  return new Date(utc - offset * 86400000).toISOString().slice(0, 10);
}

export function addDaysYmd(ymd, days) {
  const t = Date.parse(`${ymd}T12:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function fmtGbp(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `£${Math.round(Number(n)).toLocaleString('en-GB')}`;
}

export function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Math.round(Number(n)).toLocaleString('en-GB');
}

export function deltaArrow(curr, prev) {
  if (curr == null || prev == null || !Number.isFinite(Number(curr)) || !Number.isFinite(Number(prev))) {
    return { delta: null, arrow: '→', label: 'n/a' };
  }
  const d = Number(curr) - Number(prev);
  if (Math.abs(d) < 0.0001) return { delta: 0, arrow: '→', label: '0' };
  const arrow = d > 0 ? '↑' : '↓';
  return { delta: d, arrow, label: `${arrow} ${fmtNum(Math.abs(d))}` };
}

export function authoriseCron(req) {
  if (String(req.headers['x-vercel-cron'] || '') === '1') return true;
  if (req.method === 'POST') return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers['x-cron-secret'] === secret || req.query?.secret === secret;
}

export function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
}
