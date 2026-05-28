const PROP = encodeURIComponent('https://www.alanranger.com');
const summary = await fetch(`https://ai-geo-audit.vercel.app/api/aigeo/revenue-truth-summary?propertyUrl=${PROP}`, { cache: 'no-store' }).then(r => r.json());
const diag = await fetch(`https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-diagnosis?propertyUrl=${PROP}&windowMonths=3`, { cache: 'no-store' }).then(r => r.json());
const git = await fetch('https://ai-geo-audit.vercel.app/api/git/previous-commit', { cache: 'no-store' }).then(r => r.json());
const p = summary.currentMonthPulse;
console.log(JSON.stringify({
  url: 'https://ai-geo-audit.vercel.app',
  commitHash: git.commitHash,
  defcon: p?.defcon?.level,
  status: p?.defcon?.status,
  worstCase: p?.defcon?.projected_month_end,
  pace: p?.projection?.linear_month_end,
  blended: p?.projection?.blended_month_end,
  reconciliation: diag?.tier_reconciliation?.passes,
  delta2026: diag?.tier_reconciliation?.delta_vs_targets?.y2026_ytd
}, null, 2));
