/** Parse Alan's inline <style>/<script> for Squarespace brace-stripping. */

import vm from 'node:vm';

function jammedIdSelector(css) {
  return /#[a-zA-Z][\w-]*#[a-zA-Z][\w-]*/.test(String(css || ''));
}

function scriptType(attrs) {
  const m = /\btype\s*=\s*["']([^"']+)["']/i.exec(String(attrs || ''));
  return m ? m[1].trim().toLowerCase() : '';
}

function isInlineJs(attrs) {
  if (/\bsrc\s*=/i.test(attrs)) return false;
  const t = scriptType(attrs);
  if (!t) return true;
  return t === 'text/javascript' || t === 'application/javascript' || t === 'module' || t === 'text/ecmascript';
}

function jsParses(src) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(String(src || ''), { filename: 'inline-block.js' });
    return true;
  } catch {
    return false;
  }
}

/** Tokenizer parse: comments, strings, and url() are skipped; braces must match. */
function cssParses(src) {
  const s = String(src || '');
  let i = 0;
  let depth = 0;
  let quote = '';
  let inComment = false;
  let inUrl = false;
  while (i < s.length) {
    const ch = s[i];
    const next = s[i + 1] || '';
    if (inComment) {
      if (ch === '*' && next === '/') { inComment = false; i += 2; continue; }
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (inUrl) {
      if (ch === ')') inUrl = false;
      else if (ch === '"' || ch === "'") quote = ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') { inComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
    if ((ch === 'u' || ch === 'U') && s.slice(i, i + 4).toLowerCase() === 'url(') {
      inUrl = true;
      i += 4;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
    i += 1;
  }
  return depth === 0 && !quote && !inComment;
}

export function codeBlocksIntact(html) {
  const blocks = String(html || '').matchAll(/<(style|script)([^>]*)>([\s\S]*?)<\/\1>/gi);
  for (const m of blocks) {
    const tag = String(m[1] || '').toLowerCase();
    const attrs = String(m[2] || '');
    const body = String(m[3] || '');
    if (/squarespace/i.test(attrs)) continue;
    if (!body.trim()) continue;
    if (tag === 'script') {
      if (!isInlineJs(attrs)) continue;
      if (!jsParses(body)) {
        return { status: 'fail', note: 'Inline script does not parse' };
      }
      continue;
    }
    if (!cssParses(body)) {
      return { status: 'fail', note: 'Inline CSS does not parse' };
    }
    if (jammedIdSelector(body)) {
      return { status: 'fail', note: 'Jammed CSS selector (same #id twice, no comma)' };
    }
  }
  return { status: 'pass', note: 'Inline CSS/JS parsed' };
}
