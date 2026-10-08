/**
 * Editable short display names for Strategy diary / Monday brief.
 * First matching rule wins. Fallback strips date-ish suffixes from the title.
 */

function woodShort(wood) {
  const w = String(wood || '').replace(/\s*-\s*.*$/, '').trim();
  if (/^crackley/i.test(w)) return 'Crackley';
  return w;
}

/** @type {{ match: RegExp, name: (title: string, m?: RegExpMatchArray) => string }[]} */
export const STRATEGY_SHORT_NAME_RULES = [
  {
    match: /woodland photography walk/i,
    name: (title) => {
      const parts = String(title).split('|').map((s) => s.trim()).filter(Boolean);
      const wood = parts.length >= 3 ? parts[2] : parts[1] || '';
      const short = woodShort(wood);
      return short ? `Woodland Walk · ${short}` : 'Woodland Walk';
    }
  },
  { match: /padley/i, name: () => 'Padley Gorge' },
  { match: /secrets of woodland/i, name: () => 'Woodland Masterclass' },
  { match: /batsford/i, name: () => 'Batsford' },
  { match: /camera courses for beginners|beginner/i, name: () => 'Beginners course' },
  { match: /lake district/i, name: () => 'Lake District' },
  { match: /norfolk/i, name: () => 'Norfolk' },
  { match: /vyrnwy|wales/i, name: () => 'Lake Vyrnwy' },
  { match: /abstract and macro|macro/i, name: () => 'Macro' }
];

export function strategyShortName(title) {
  const t = String(title || '').trim();
  for (const rule of STRATEGY_SHORT_NAME_RULES) {
    const m = t.match(rule.match);
    if (m) return rule.name(t, m);
  }
  return t
    .replace(/\s*[-–|]\s*\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || t;
}
