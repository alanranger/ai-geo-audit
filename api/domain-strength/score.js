/**
 * Domain Strength scoring (v1)
 * Pure math only: no network / DB calls.
 */

function safeLog(x) {
  return Math.log(x + 1);
}

function logNorm(x, cap) {
  const c = Number.isFinite(cap) ? cap : 0;
  if (c <= 0) return 0;
  const num = safeLog(Math.max(0, Number.isFinite(x) ? x : 0));
  const den = safeLog(Math.max(1, c));
  if (den === 0) return 0;
  return Math.min(1, num / den);
}

export function computeDomainStrengthScore(metrics, caps) {
  const etv = Math.max(0, metrics?.etv || 0);
  const keywordsTotal = Math.max(0, metrics?.keywordsTotal || 0);
  const top10 = Math.max(0, metrics?.top10 || 0);

  // 1) Visibility V (0–1)
  const V = logNorm(etv, caps?.etvCap || 0);

  // 2) Breadth B (0–1)
  const B = logNorm(keywordsTotal, caps?.kwCap || 0);

  // 3) Quality Q (0–1) – Option A: share of top10, then sqrt
  let Q = 0;
  if (keywordsTotal > 0 && top10 > 0) {
    const share = Math.min(1, top10 / keywordsTotal);
    Q = Math.sqrt(share);
  }

  // Final score (0–100)
  const scoreRaw = 0.5 * V + 0.3 * Q + 0.2 * B;
  const score = Math.round(scoreRaw * 100 * 100) / 100; // 2 decimals

  // Band
  let band = "Very weak";
  if (score >= 80) band = "Very strong";
  else if (score >= 60) band = "Strong";
  else if (score >= 40) band = "Moderate";
  else if (score >= 20) band = "Weak";

  return { score, band, V, B, Q };
}

