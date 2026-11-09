/**
 * Surface visibility / Top of page dial "Score" lines: appends " · of N keywords" (fixed LOCKED cohort).
 * N = ranking_quality_detail.stability.cohort.size of the latest ranking scan (/api/aigeo/ranking-scan-quality),
 * else window.rankingDialCohort.lockedSize(). A held scan ("suspect: matching") shows the hold reason instead;
 * a "volatile capture" scan gets a small note under the Score line.
 * Classic browser script (no imports). Idempotent; re-applies when the dashboard re-renders the dials.
 */
(function attachRankingDialLabel(root) {
  const doc = root.document;
  if (!doc) return;

  const DIAL_TITLES = ['surface visibility', 'top of page'];
  const SUFFIX_ATTR = 'data-ranking-dial-suffix';
  const NOTE_ATTR = 'data-ranking-dial-note';
  const QUALITY_TTL_MS = 5 * 60 * 1000;
  let quality = null;
  let qualityAt = 0;
  let inflight = null;
  let scheduled = false;

  function lockedSize() {
    const fromCohort = root.rankingDialCohort?.lockedSize?.();
    if (fromCohort > 0) return fromCohort;
    const map = root.__KEYWORD_CLASS_LOCKED_BY_KEYWORD;
    return map && typeof map === 'object' ? Object.keys(map).length : 0;
  }

  function qualityUrl() {
    const path = '/api/aigeo/ranking-scan-quality';
    return typeof root.apiUrl === 'function' ? root.apiUrl(path) : path;
  }

  function loadQuality() {
    if (quality && Date.now() - qualityAt < QUALITY_TTL_MS) return Promise.resolve(quality);
    if (inflight) return inflight;
    inflight = fetch(qualityUrl(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((json) => {
        quality = json?.ok ? json : {};
        qualityAt = Date.now();
        inflight = null;
        return quality;
      });
    return inflight;
  }

  /** { suffix, note } for the current quality state. */
  function labelParts(q) {
    if (q?.suspect) return { suffix: ` · held: ${q.hold_reason || 'suspect: matching'}`, note: '' };
    const size = Number(q?.cohort_size) > 0 ? Number(q.cohort_size) : lockedSize();
    return { suffix: size ? ` · of ${size} keywords` : '', note: q?.volatility_note || '' };
  }

  function dialTitleOf(scoreEl) {
    const header = scoreEl.parentElement?.previousElementSibling;
    return String(header?.textContent || '').trim().toLowerCase();
  }

  /** The "Score N/100" lines inside the Surface visibility / Top of page dial cards. */
  function findScoreLines() {
    const host = doc.getElementById('ai-geo-health-dashboard');
    if (!host) return [];
    return Array.from(host.querySelectorAll('div')).filter((el) => {
      if (!/^Score\s/.test(String(el.firstChild?.nodeValue || '').trim())) return false;
      return DIAL_TITLES.includes(dialTitleOf(el));
    });
  }

  function ensureChild(parent, attr, tag, style) {
    let el = parent.querySelector(`[${attr}]`);
    if (!el) {
      el = doc.createElement(tag);
      el.setAttribute(attr, '1');
      el.setAttribute('style', style);
      parent.appendChild(el);
    }
    return el;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function applyTo(scoreEl, parts) {
    const suffix = ensureChild(scoreEl, SUFFIX_ATTR, 'span', 'font-weight:600;font-size:0.8rem;color:#64748b;');
    setText(suffix, parts.suffix);
    const note = ensureChild(scoreEl.parentElement, NOTE_ATTR, 'div',
      'margin-top:0.35rem;text-align:center;font-size:0.75rem;color:#92400e;line-height:1.35;');
    setText(note, parts.note);
    note.hidden = !parts.note;
  }

  function apply() {
    scheduled = false;
    const lines = findScoreLines();
    if (!lines.length) return;
    loadQuality().then((q) => {
      const parts = labelParts(q);
      findScoreLines().forEach((el) => applyTo(el, parts));
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 150);
  }

  function start() {
    schedule();
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
  }

  root.rankingDialLabel = { apply, labelParts, refresh: () => { qualityAt = 0; schedule(); } };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(globalThis);
