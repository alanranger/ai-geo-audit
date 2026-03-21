const toNum = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

/** Max backlink rows stored per page URL for DFS page list (fetch + modal). Default 100; clamp 1–500. */
export function dfsPageBacklinksMax() {
  const n = toNum(process.env.DFS_PAGE_BACKLINKS_MAX, 100);
  return Math.max(1, Math.min(500, n || 100));
}

export function dfsClientLimits() {
  return { dfsPageBacklinksMax: dfsPageBacklinksMax() };
}
