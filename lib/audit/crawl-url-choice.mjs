/** Which URL list a schema audit crawls. A posted list is used only when this run asks for it. */

export function manualUrlsIfChosen(bodyUrls, useManualList) {
  if (useManualList !== true) {
    if (Array.isArray(bodyUrls) && bodyUrls.length) {
      console.log(`Ignoring ${bodyUrls.length} posted URLs; this run uses 06 unless useManualList is set`);
    }
    return null;
  }
  const urls = (Array.isArray(bodyUrls) ? bodyUrls : [])
    .filter((url) => typeof url === 'string' && url.startsWith('http'));
  return urls.length ? urls : null;
}

export function urlListRecord(kind, count) {
  const n = Number(count) || 0;
  if (kind === 'manual') {
    return { source: 'manual', count: n, notice: `Using manual list of ${n} URLs, not 06` };
  }
  if (kind === 'pages_master') {
    return { source: 'pages_master', count: n, notice: `Using pages master (${n} URLs); 06 was empty` };
  }
  return { source: '06', count: n, notice: `Using 06 (${n} URLs)` };
}

/** Saved audit records keep the URL source inside schema_foundation (no new column). */
export function attachUrlList(foundation, urlList) {
  if (!urlList || typeof urlList !== 'object') return foundation;
  foundation.urlList = {
    source: urlList.source || '06',
    count: Number(urlList.count) || 0,
    notice: String(urlList.notice || '')
  };
  return foundation;
}
