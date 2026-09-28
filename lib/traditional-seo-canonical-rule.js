/**
 * Traditional SEO: HTML <link rel="canonical"> in real <head> (not schema @id).
 * Body tags are counted separately for hygiene notes only.
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

function stripIgnoredHtmlRegions(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
}

function splitHeadAndBodyHtml(html) {
  const cleaned = stripIgnoredHtmlRegions(html);
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(cleaned);
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned);
  const headHtml = headMatch ? headMatch[1] : '';
  let bodyHtml = '';
  if (bodyMatch) bodyHtml = bodyMatch[1];
  else if (headMatch) bodyHtml = cleaned.slice(headMatch.index + headMatch[0].length);
  return { headHtml, bodyHtml };
}

function collectCanonicalHrefs(fragment) {
  const tags = String(fragment || '').match(/<link\b[^>]*>/gi) || [];
  const hrefs = [];
  tags.forEach((tag) => {
    if (!linkTagHasCanonicalRel(tag)) return;
    hrefs.push(readHrefFromLinkTag(tag));
  });
  return hrefs;
}

function resolveCanonicalAbsolute(raw, pageUrl) {
  if (!raw) return '';
  if (hasForbiddenCanonicalChars(raw)) return raw;
  try {
    return new URL(raw, pageUrl || undefined).href;
  } catch {
    return raw;
  }
}

/**
 * Head canonical for scoring; body tags counted separately (not Google head signals).
 * Ignores lookalikes inside comments/script/style/noscript.
 */
function extractHtmlCanonicalFromHtml(html = '', pageUrl = '') {
  const { headHtml, bodyHtml } = splitHeadAndBodyHtml(html);
  const headHrefs = collectCanonicalHrefs(headHtml);
  const bodyHrefs = collectCanonicalHrefs(bodyHtml);
  const raw = headHrefs.length ? String(headHrefs[0] || '') : '';
  const bodyRaw = bodyHrefs.length ? String(bodyHrefs[0] || '') : '';
  const absolute = resolveCanonicalAbsolute(raw, pageUrl);
  const bodyAbsolute = resolveCanonicalAbsolute(bodyRaw, pageUrl);
  return {
    seoCanonicalHref: absolute || raw,
    seoCanonicalRaw: raw,
    seoCanonicalCount: headHrefs.length,
    seoCanonicalBodyHref: bodyAbsolute || bodyRaw,
    seoCanonicalBodyRaw: bodyRaw,
    seoCanonicalBodyCount: bodyHrefs.length
  };
}

function hasCanonicalEvidenceField(extractSignal) {
  if (!extractSignal || typeof extractSignal !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(extractSignal, 'seoCanonicalHref')
    || Object.prototype.hasOwnProperty.call(extractSignal, 'seoCanonicalCount');
}

function bodyCanonicalCleanupNote(extractSignal) {
  const bodyCount = Number(extractSignal?.seoCanonicalBodyCount);
  if (!Number.isFinite(bodyCount) || bodyCount <= 0) return '';
  const bodyHref = String(extractSignal.seoCanonicalBodyHref || extractSignal.seoCanonicalBodyRaw || '').trim();
  const where = bodyHref ? `: ${bodyHref}` : '';
  return ` Misplaced body <link rel="canonical"> (${bodyCount})${where} — not a valid head signal; clean source (Google accepts head only).`;
}

function withBodyCleanupNote(result, extractSignal) {
  const extra = bodyCanonicalCleanupNote(extractSignal);
  if (!extra) return result;
  return { ...result, note: `${result.note}${extra}` };
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
  const bodyNoteHint = bodyCanonicalCleanupNote(extractSignal);

  if (Number.isFinite(count) && count > 0 && !raw && !href) {
    return withBodyCleanupNote({
      status: 'fail',
      code: 'missing_canonical',
      note: 'Head canonical link tag found but href is missing.',
      ...empty
    }, extractSignal);
  }

  if (!raw && !href) {
    const missingNote = bodyNoteHint
      ? 'No HTML <link rel="canonical"> in <head>.'
      : 'No HTML <link rel="canonical"> found.';
    return withBodyCleanupNote({
      status: 'fail',
      code: 'missing_canonical',
      note: missingNote,
      ...empty
    }, extractSignal);
  }

  if (hasForbiddenCanonicalChars(rawOriginal) || (href && hasForbiddenCanonicalChars(String(extractSignal.seoCanonicalHref || '')))) {
    return withBodyCleanupNote({
      status: 'fail',
      code: 'malformed_canonical',
      note: `HTML head canonical is malformed (whitespace/control): ${raw || href}.`,
      canonicalHref: raw || href
    }, extractSignal);
  }

  const pageKey = normalizeUrlForCanonicalCompare(pageUrl);
  const canKey = normalizeUrlForCanonicalCompare(href || raw, pageUrl);
  if (!canKey) {
    return withBodyCleanupNote({
      status: 'fail',
      code: 'malformed_canonical',
      note: `HTML head canonical is malformed or non-http(s): ${href || raw}.`,
      canonicalHref: href || raw
    }, extractSignal);
  }

  const display = href || raw;
  if (Number.isFinite(count) && count > 1) {
    if (pageKey && canKey === pageKey) {
      return withBodyCleanupNote({
        status: 'warn',
        code: 'multiple_canonical',
        note: `Multiple HTML head canonical tags (${count}); first matches page: ${display}.`,
        canonicalHref: display
      }, extractSignal);
    }
    return withBodyCleanupNote({
      status: 'warn',
      code: 'multiple_canonical',
      note: `Multiple HTML head canonical tags (${count}); first is unverified alternative: ${display}.`,
      canonicalHref: display
    }, extractSignal);
  }

  if (pageKey && canKey === pageKey) {
    return withBodyCleanupNote({
      status: 'pass',
      code: 'self_canonical',
      note: `HTML head canonical matches page URL: ${display}.`,
      canonicalHref: display
    }, extractSignal);
  }

  return withBodyCleanupNote({
    status: 'warn',
    code: 'alternative_canonical',
    note: `HTML head canonical points elsewhere (unverified): ${display}.`,
    canonicalHref: display
  }, extractSignal);
}

export {
  hasForbiddenCanonicalChars,
  normalizeUrlForCanonicalCompare,
  extractHtmlCanonicalFromHtml,
  hasCanonicalEvidenceField,
  evaluateTraditionalSeoCanonicalRule
};
