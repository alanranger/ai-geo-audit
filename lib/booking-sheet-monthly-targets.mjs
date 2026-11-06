/** RAG vs that month's target (matches sheet Target % colours). Targets now come from the Targets panel (targets-master.mjs). */
export function classifyVsMonthTarget(actual, target) {
  const t = Number(target) || 0;
  if (t <= 0) return 'below_survival';
  const pct = (Number(actual) || 0) / t;
  if (pct >= 1) return 'thrive';
  if (pct >= 0.85) return 'comfortable';
  if (pct >= 0.5) return 'survival';
  return 'below_survival';
}
