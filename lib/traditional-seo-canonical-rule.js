/**
 * Traditional SEO: HTML <link rel="canonical"> (not schema @id).
 * Pure helpers for content-extractability + dashboard evaluation.
 */

function hasForbiddenCanonicalChars(raw) {
  return /[\s\u0000-\u001F\u007F]/.test(String(raw || ''));
}

/**
 * Compare key: keep protocol, port, path, query. www host alias only.
 * Rejects whitespace/control in the raw string (no relative reinterpretation).
 */
function normalizeUrlForCanonicalCompare(raw, baseUrl = '') {
  const original = String(raw || '');
  if (!original.trim()) return null;
  if (hasForbiddenCanonicalChars(original)) return null;
  try {
    const u = baseUrl ? new URL(original.trim(), baseUrl) : new URL(original.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const port = u.port ? `:${u.port}` : '';
    const path = u.pathname || '/';
    const query = u.search || '';
    return `${u.protocol}//${host}${port}${path}${query}`;
  } catch {
    return null;
  }
}

function linkTagHasCanonicalRel(tag) {
  const quoted = /\brel\s*=\s*(["'])(.*?)\1/i.exec(tag);
  const unquoted = !quoted ? /\brel\s*=\s*([^\s>]+)/i.exec(tag) : null;
  const relVal = quoted ? String(quoted[2] || '') : String(unquoted?.[1] || '');
  if (!relVal) return false;
  return relVal
    .split(/[\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .includes('canonical');
}

function readHrefFromLinkTag(tag) {
  const quoted = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag);
  if (quoted) return String(quoted[2] || '').trim();
  const unquoted = /\bhref\s*=\s*([^\s>]+)/i.exec(tag);
  if (!unquoted) return '';
  return String(unquoted[1] || '').trim().replace(/^['"]|['"]$/g, '');
}

/**
 * First canonical href from HTML, plus count of canonical link tags found.
 * Multi-value rel supported. Missing/malformed href still counted.
 */
function extractHtmlCanonicalFromHtml(html = '', pageUrl = '') {
  const tags = String(html || '').match(/<link\b[^>]*>/gi) || [];
  const hrefs = [];
  tags.forEach((tag) => {
    if (!linkTagHasCanonicalRel(tag)) return;
    hrefs.push(readHrefFromLinkTag(tag));
  });
  const raw = hrefs.length ? String(hrefs[0] || '') : '';
  let absolute = '';
  if (raw && !hasForbiddenCanonicalChars(raw)) {
    try {
      absolute = new URL(raw, pageUrl || undefined).href;
    } catch {
      absolute = raw;
    }
  } else if (raw) {
    absolute = raw;
  }
  return {
    seoCanonicalHref: absolute || raw,
    seoCanonicalRaw: raw,
    seoCanonicalCount: hrefs.length
  };
}

function hasCanonicalEvidenceField(extractSignal) {
  if (!extractSignal || typeof extractSignal !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(extractSignal, 'seoCanonicalHref')
    || Object.prototype.hasOwnProperty.call(extractSignal, 'seoCanonicalCount');
}

/**
 * @returns {{ status: 'pass'|'warn'|'fail', code: string, note: string, canonicalHref: string }}
 */
function evaluateTraditionalSeoCanonicalRule({ pageUrl = '', extractSignal = null } = {}) {
  const empty = { canonicalHref: '' };
  if (extractSignal?.excludedFromAudit === true) {
    return {
      status: 'pass',
      code: 'excluded',
      note: 'Page excluded from Traditional SEO audit — canonical check skipped.',
      ...empty
    };
  }
  if (!extractSignal || extractSignal.requestOk === false) {
    return {
      status: 'warn',
      code: 'unknown_canonical',
      note: 'HTML canonical evidence unavailable. Re-run Extractability. Schema @id is not used here.',
      ...empty
    };
  }
  if (!hasCanonicalEvidenceField(extractSignal)) {
    return {
      status: 'warn',
      code: 'unknown_canonical',
      note: 'Canonical link has not been checked yet. Refresh the page audit to collect it.',
      ...empty
    };
  }

  const count = Number(extractSignal.seoCanonicalCount);
  const rawOriginal = String(extractSignal.seoCanonicalRaw ?? extractSignal.seoCanonicalHref ?? '');
  const raw = rawOriginal.trim();
  const href = String(extractSignal.seoCanonicalHref || '').trim();

  if (Number.isFinite(count) && count > 0 && !raw && !href) {
    return {
      status: 'fail',
      code: 'missing_canonical',
      note: 'Canonical link tag found but href is missing.',
      ...empty
    };
  }

  if (!raw && !href) {
    return {
      status: 'fail',
      code: 'missing_canonical',
      note: 'No HTML <link rel="canonical"> found.',
      ...empty
    };
  }

  if (hasForbiddenCanonicalChars(rawOriginal) || (href && hasForbiddenCanonicalChars(String(extractSignal.seoCanonicalHref || '')))) {
    return {
      status: 'fail',
      code: 'malformed_canonical',
      note: `HTML canonical is malformed (whitespace/control): ${raw || href}.`,
      canonicalHref: raw || href
    };
  }

  const pageKey = normalizeUrlForCanonicalCompare(pageUrl);
  const canKey = normalizeUrlForCanonicalCompare(href || raw, pageUrl);
  if (!canKey) {
    return {
      status: 'fail',
      code: 'malformed_canonical',
      note: `HTML canonical is malformed or non-http(s): ${href || raw}.`,
      canonicalHref: href || raw
    };
  }

  const display = href || raw;
  if (Number.isFinite(count) && count > 1) {
    if (pageKey && canKey === pageKey) {
      return {
        status: 'warn',
        code: 'multiple_canonical',
        note: `Multiple HTML canonical tags (${count}); first matches page: ${display}.`,
        canonicalHref: display
      };
    }
    return {
      status: 'warn',
      code: 'multiple_canonical',
      note: `Multiple HTML canonical tags (${count}); first is unverified alternative: ${display}.`,
      canonicalHref: display
    };
  }

  if (pageKey && canKey === pageKey) {
    return {
      status: 'pass',
      code: 'self_canonical',
      note: `HTML canonical matches page URL: ${display}.`,
      canonicalHref: display
    };
  }

  return {
    status: 'warn',
    code: 'alternative_canonical',
    note: `HTML canonical points elsewhere (unverified): ${display}.`,
    canonicalHref: display
  };
}

export {
  hasForbiddenCanonicalChars,
  normalizeUrlForCanonicalCompare,
  extractHtmlCanonicalFromHtml,
  hasCanonicalEvidenceField,
  evaluateTraditionalSeoCanonicalRule
};
