/** Browser-only JLR toggle preference (Revenue Truth + Revenue Funnel). */
export const DASHBOARD_JLR_STORAGE_KEY = 'aigeo.includeJlr';

export function readIncludeJlr() {
  if (typeof localStorage === 'undefined') return true;
  const v = localStorage.getItem(DASHBOARD_JLR_STORAGE_KEY);
  if (v === null) return true;
  return v === '1' || v === 'true';
}

export function persistIncludeJlr(include) {
  const on = include === true;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DASHBOARD_JLR_STORAGE_KEY, on ? '1' : '0');
  }
  if (typeof window !== 'undefined') window.__dashboardIncludeJlr = on;
  syncJlrCheckboxes(on);
}

export function syncJlrCheckboxes(include) {
  if (typeof document === 'undefined') return;
  for (const id of ['rt-include-jlr', 'rf-include-jlr']) {
    const el = document.getElementById(id);
    if (el && el.checked !== include) el.checked = include;
  }
}
