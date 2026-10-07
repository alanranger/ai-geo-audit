/**
 * Squarespace event collections for Strategy upcoming fill + beginners calendar.
 */

const WORKSHOPS_URL = 'https://www.alanranger.com/photographic-workshops-near-me?format=json';
const BEGINNERS_URL = 'https://www.alanranger.com/beginners-photography-lessons?format=json';

function isoFromMs(ms) {
  if (ms == null) return null;
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function placesLeft(item) {
  const html = `${item.excerpt || ''}\n${item.body || ''}`;
  const m = html.match(/Only\s+(\d+)\s+available/i);
  if (m) return Number(m[1]);
  if (/sold\s*out/i.test(html)) return 0;
  return null;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchCollection(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Squarespace feed ${r.status}: ${url}`);
  return r.json();
}

export async function loadSquarespaceEventFeeds() {
  const [w, b] = await Promise.all([fetchCollection(WORKSHOPS_URL), fetchCollection(BEGINNERS_URL)]);
  const workshops = [...(w.upcoming || []), ...(w.past || [])].map((it) => ({
    source: 'workshops',
    title: it.title || '',
    date: isoFromMs(it.startDate),
    end: isoFromMs(it.endDate),
    places_left: placesLeft(it),
    url: it.fullUrl || null,
    categories: it.categories || []
  })).filter((e) => e.date);

  const beginnersAll = [...(b.upcoming || []), ...(b.past || [])]
    .filter((it) => /beginner/i.test(it.title || ''))
    .map((it) => ({
      source: 'beginners',
      title: it.title || '',
      date: isoFromMs(it.startDate),
      end: isoFromMs(it.endDate),
      places_left: placesLeft(it),
      is_week1: /week\s*1\s*of\s*3/i.test(it.title || ''),
      url: it.fullUrl || null
    }))
    .filter((e) => e.date);

  return { workshops, beginners: beginnersAll };
}

/** Fuzzy match sheet theme to a website workshop title. */
export function themeMatchesTitle(theme, title) {
  const t = norm(theme);
  const u = norm(title);
  if (!t || !u) return false;
  if (u.includes(t) || t.includes(u)) return true;
  const tokens = t.split(' ').filter((w) => w.length >= 4);
  if (!tokens.length) return false;
  const hits = tokens.filter((w) => u.includes(w)).length;
  return hits >= Math.min(2, tokens.length);
}

export function countSheetBooked(sheetRows, eventDate, title) {
  let n = 0;
  for (const r of sheetRows || []) {
    if (!r.client_name) continue;
    const d = r.event_start || r.from_date || r.to_date;
    const theme = r.theme_location || r.event_name || '';
    if (d === eventDate && themeMatchesTitle(theme, title)) n += 1;
    else if (!d && themeMatchesTitle(theme, title)) n += 1;
  }
  return n;
}
