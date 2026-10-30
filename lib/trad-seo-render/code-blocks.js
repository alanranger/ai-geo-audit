/** Parse Alan's inline <style>/<script> for Squarespace brace-stripping. */

function balancedBraces(text) {
  let n = 0;
  for (const ch of String(text || '')) {
    if (ch === '{') n += 1;
    else if (ch === '}') n -= 1;
    if (n < 0) return false;
  }
  return n === 0;
}

function jammedIdSelector(css) {
  return /#[a-zA-Z][\w-]*#[a-zA-Z][\w-]*/.test(String(css || ''));
}

export function codeBlocksIntact(html) {
  const blocks = String(html || '').matchAll(/<(style|script)([^>]*)>([\s\S]*?)<\/\1>/gi);
  for (const m of blocks) {
    const tag = String(m[1] || '').toLowerCase();
    const attrs = String(m[2] || '');
    const body = String(m[3] || '');
    if (tag === 'script' && /\bsrc\s*=/i.test(attrs)) continue;
    if (/squarespace/i.test(attrs)) continue;
    if (!body.trim()) continue;
    if (!balancedBraces(body)) {
      return { status: 'fail', note: `Unbalanced braces in inline ${tag}` };
    }
    if (tag === 'style' && jammedIdSelector(body)) {
      return { status: 'fail', note: 'Jammed CSS selector (same #id twice, no comma)' };
    }
  }
  return { status: 'pass', note: 'Inline CSS/JS parsed' };
}
