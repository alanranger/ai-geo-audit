/** Turn a raw postcode into a cache key. Town names stay null. Non-UK is never sent to the UK lookup. */

const AREAS = new Set('AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY E EC EH EN EX FK FY G GL GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KT KW KY L LA LD LE LL LN LS LU M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE'.split(' '));
const INWARD = 'ABCDEFGHJKLMNPRSTUWXYZ';
const FULL = new RegExp(`^[A-Z]{1,2}\\d[${INWARD}0-9]?\\d[${INWARD}]{2}$`);
const OUT = /^[A-Z]{1,2}\d\d?[A-Z]?$/;

export const compactPostcode = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function areaOk(s) {
  const letters = s.match(/^[A-Z]{1,2}/);
  return !!(letters && AREAS.has(letters[0]));
}

function asFull(s) {
  if (!FULL.test(s) || !areaOk(s)) return null;
  return { key: `${s.slice(0, -3)} ${s.slice(-3)}`, precision: 'full', kind: 'full' };
}

function asPrefix(s) {
  for (let n = Math.min(7, s.length - 1); n >= 5; n -= 1) {
    const hit = asFull(s.slice(0, n));
    if (hit) return hit;
  }
  return null;
}

function asDistrict(s) {
  for (let n = Math.min(4, s.length); n >= 2; n -= 1) {
    const out = s.slice(0, n);
    const rest = s.slice(n);
    if (!OUT.test(out) || !areaOk(out)) continue;
    if (rest === '' || /^\d[A-Z]?$/.test(rest)) return { key: out, precision: 'district', kind: 'district' };
  }
  return null;
}

function asNonUk(s) {
  if (/^\d{3,10}$/.test(s) || /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(s) || /^[A-Z]\d{2}[A-Z\d]{4}$/.test(s)) {
    return { key: s, precision: null, kind: 'non_uk' };
  }
  return null;
}

function matched(s) {
  return asFull(s) || asPrefix(s) || asDistrict(s);
}

/** Full postcode, district centroid, or non-UK. Null means leave it unmapped (a town name, or junk). */
export function classifyPostcode(raw) {
  const s = compactPostcode(raw);
  if (!s || s.length > 12) return null;
  const direct = matched(s);
  if (direct) return direct;
  const swapped = s.replace(/O/g, '0').replace(/I/g, '1');
  return (swapped !== s && matched(swapped)) || asNonUk(s);
}

/** Split source values into already-cached UK codes and the lookups still to do. */
export function planPostcodeLookups(values, cached) {
  const have = new Set(cached || []);
  const byKey = new Map();
  for (const value of values || []) {
    const row = classifyPostcode(value);
    if (row && !byKey.has(row.key)) byKey.set(row.key, row);
  }
  const codes = [...byKey.values()];
  const pending = codes.filter((row) => !have.has(row.key));
  return {
    known: codes.filter((row) => row.kind !== 'non_uk' && have.has(row.key)).length,
    non_uk: codes.filter((row) => row.kind === 'non_uk').length,
    full: pending.filter((row) => row.kind === 'full'),
    district: pending.filter((row) => row.kind === 'district'),
    skip: pending.filter((row) => row.kind === 'non_uk')
  };
}
