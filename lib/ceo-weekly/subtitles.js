/**
 * Block subtitles computed from the figures the block shows (task 17 item 7) — never hard-coded.
 */
const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const fmt = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('en-GB'));

export function websiteSubtitle(acq) {
  const org = acq?.google_organic?.wow?.label;
  const dir = acq?.direct?.wow?.label;
  if (!org && !dir) return 'Visits by channel, last 28 days vs prior 28.';
  return `Google organic ${org || '—'} · direct ${dir || '—'} (last 28 days vs prior 28).`;
}

export function backlinksSubtitle(bl) {
  const rd = bl?.wow?.referring_domains;
  if (rd?.withheld) return `${fmt(bl.referring_domains)} referring domains · week-on-week not shown: ${rd.reason}.`;
  let change = rd && !rd.pending && rd.label ? ` (${rd.label} vs last Monday)` : '';
  if (rd && !rd.pending && Number(rd.delta) === 0) change = ' (unchanged vs last Monday)';
  return `${fmt(bl?.referring_domains)} referring domains${change} · ${bl?.follow_pct ?? '—'}% of links dofollow.`;
}

export function seoHealthSubtitle(sh) {
  const hy = sh?.hygiene || {};
  const fails = Number(hy.fail) || 0;
  const scope = sh?.score_wow?.withheld ? ` · week-on-week not shown: ${sh.score_wow.reason}` : '';
  return `Health ${fmt(sh?.score)}/100 · ${fails} hygiene fail${fails === 1 ? '' : 's'}, ${fmt(hy.warn)} warn${scope}.`;
}

export function moneySubtitle(rt) {
  const amount = rt?.rolling_4wk?.amount;
  const line = rt?.survival_sales_derived || rt?.survival;
  if (amount == null || !line) return 'Sales and conversion, rolling 28 days.';
  const gap = Number(amount) - Number(line);
  return `Sales (28 days) ${gbp(amount)}: ${gbp(Math.abs(gap))} ${gap < 0 ? 'below' : 'above'} the ${gbp(line)} survival line.`;
}

const STRONG = 50;
const WEAK = 20;

const pctOf = (bar) => Number(bar?.pct) || 0;

export function aiFrontSubtitle(surf = {}) {
  const classic = Math.max(pctOf(surf.map_pack), pctOf(surf.organic_top10)) >= STRONG;
  const answers = Math.max(pctOf(surf.ai_overview), pctOf(surf.paa));
  if (classic && answers < WEAK) return 'Strong in classic results (map pack, top 10); rarely shown in AI Overviews or People Also Ask.';
  if (classic && answers >= STRONG) return 'Strong in classic results and in AI answer surfaces.';
  if (!classic && answers >= STRONG) return 'Shown in AI answer surfaces more than in classic results.';
  return 'Mixed presence across classic results and AI answer surfaces.';
}

/** "Open fails" row: every failing hygiene rule (plus unindexed pages), not just the first. */
export function openFailsText(sh) {
  const list = Array.isArray(sh?.fail_rules) ? sh.fail_rules.slice() : [];
  if (/not indexed/.test(String(sh?.open_fail || ''))) list.unshift(sh.open_fail);
  if (!list.length) return sh?.open_fail && sh.open_fail !== 'none' ? sh.open_fail : 'none';
  return list.join(' · ');
}
