/** Full ① runs use source `trad_seo`. Playwright/sample/test runs must not be resumed as full. */

export function isFullTradSeoSource(source) {
  return String(source || '') === 'trad_seo';
}
