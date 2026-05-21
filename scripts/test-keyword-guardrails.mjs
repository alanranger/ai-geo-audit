import {
  applyKeywordGuardrails,
  safeTitleLead,
  ownerUrlForKeyword
} from '../lib/revenue-funnel-keyword-guardrails.js';

const ACADEMY = 'https://www.alanranger.com/free-online-photography-course';
const COVENTRY = 'https://www.alanranger.com/photography-courses-coventry';

function cand(sig, lever, url, kw, profit) {
  return {
    signature: sig,
    lever_id: lever,
    pages_affected: [url],
    weighted_score: profit * 10,
    estimated_lift_gbp_profit: profit,
    estimated_lift_gbp_revenue: profit,
    title: `Test ${lever} ${kw}`,
    _rebuild: lever === 'ctr'
      ? { type: 'ctr', args: { kwInfo: { keyword: kw, rank: 6, searchVolume: 1000 } } }
      : { type: 'rank', args: { keyword: kw, rank: 6, sv: 1000 } }
  };
}

const keywords = [
  { keyword: 'photography lessons online', best_url: ACADEMY, search_volume: 1000 },
  { keyword: 'photography lessons', best_url: COVENTRY, search_volume: 390 }
];

let failed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('OK:', msg);
}

const safeAcademy = safeTitleLead(ACADEMY, 'photography lessons');
ok(safeAcademy.lead === 'photography lessons online', 'Academy safe lead adds online');

const safeCov = safeTitleLead(COVENTRY, 'photography lessons');
ok(/Coventry/i.test(safeCov.lead), 'Coventry safe lead adds geo');

ok(ownerUrlForKeyword('photography lessons online', keywords) === ACADEMY, 'Online query owner is Academy');

const collected = [
  cand('ctr|academy', 'ctr', ACADEMY, 'photography lessons online', 97),
  cand('rank|academy', 'rank', ACADEMY, 'photography lessons online', 17),
  cand('ctr|cov', 'ctr', COVENTRY, 'photography lessons', 68)
];

const out = applyKeywordGuardrails(collected, { allKeywords: keywords });
const merged = out.find(c => String(c.signature || '').startsWith('merged|'));
ok(merged, 'Academy CTR+rank merged to one card');
ok(!out.some(c => c.guardrail_blocked_top3 && c.pages_affected[0] === ACADEMY), 'Academy not blocked');

const cov = out.find(c => c.pages_affected && c.pages_affected[0] === COVENTRY);
ok(cov && !cov.guardrail_blocked_top3, 'Coventry lessons card not blocked');

const bad = applyKeywordGuardrails(
  [cand('ctr|cov-bad', 'ctr', COVENTRY, 'photography lessons online', 50)],
  { allKeywords: keywords }
)[0];
ok(bad.guardrail_blocked_top3, 'Online query on Coventry URL blocked');

console.log(failed ? `\n${failed} failed` : '\nAll guardrail checks passed');
process.exit(failed ? 1 : 0);
