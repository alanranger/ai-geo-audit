/**
 * Stable Keyword & config finding IDs (CANN-/CFG-).
 * Shared by dashboard (same algorithm) and server-side history diffs.
 */

export function integrityNormKw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function integrityHashHex(str) {
  let h = 5381;
  const t = String(str || '');
  for (let i = 0; i < t.length; i++) {
    h = ((h << 5) + h) + t.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function integrityFindingKey(f) {
  const check = Number(f?.check || 0);
  if (check === 3) {
    const kw = integrityNormKw(f.subject);
    const assigned = String(f.assigned_path || f.shouldBeUrl || '')
      .trim()
      .toLowerCase();
    return `3|${kw}|${assigned}`;
  }
  return [check, integrityNormKw(f.subject), String(f.detail || '').slice(0, 160)].join('|');
}

/** Assign stable short ids; same collision lengthening as the dashboard. */
export function assignIntegrityFindingIds(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const rows = list.map((f) => {
    const key = integrityFindingKey(f);
    const hex = integrityHashHex(key);
    const prefix = Number(f.check) === 3 ? 'CANN' : 'CFG';
    return { f, key, hex, prefix };
  });
  let len = 4;
  for (;;) {
    const seen = new Map();
    let collision = false;
    for (const r of rows) {
      const id = `${r.prefix}-${r.hex.slice(0, len)}`;
      if (seen.has(id) && seen.get(id) !== r.key) {
        collision = true;
        break;
      }
      seen.set(id, r.key);
    }
    if (!collision || len >= 8) {
      return rows.map((r) =>
        Object.assign({}, r.f, {
          findingId: `${r.prefix}-${r.hex.slice(0, len)}`,
          findingKeyRaw: r.key
        })
      );
    }
    len += 1;
  }
}
