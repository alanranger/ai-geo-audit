/**
 * AR-social-v1 native SVG masters (port of GPT's social-template-v1/render-social-template.mjs, same layout).
 * The source photograph bytes are embedded unchanged as ONE <image> (preserveAspectRatio meet: no crop, no stretch,
 * no redraw); text sits in separate layout objects. Formats: feed 1080×1350, Story 1080×1920, LinkedIn 1200×1500.
 */
export const TEMPLATE = 'AR-social-v1';
export const FORMATS = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 }, linkedin: { width: 1200, height: 1500 } };
export const REQUIRED = ['title', 'subtitle', 'dates', 'location', 'bookingUrl'];

const Y = {
  story: { brand: 250, title: 345, sub: 470, date: 530, where: 585, photo: 630, ph: 565, inc: 1260, offer: 1390, code: 1460, deadline: 1530, cta: 1710 },
  feed: { brand: 75, title: 160, sub: 265, date: 325, where: 375, photo: 410, ph: 450, inc: 915, offer: 1045, code: 1110, deadline: 1170, cta: 1270 }
};
const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function wrap(value, max) {
  const lines = [];
  let current = '';
  for (const word of String(value ?? '').split(/\s+/)) {
    if (current && `${current} ${word}`.length > max) { lines.push(current); current = word; } else current += (current ? ' ' : '') + word;
  }
  if (current) lines.push(current);
  return lines;
}
const text = (value, y, size = 34, color = '#202020', weight = 400, max = 49) => wrap(value, max)
  .map((line, i) => `<text x="540" y="${y + i * size * 1.18}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(line)}</text>`).join('');

/** Missing required facts for a render (never invented). */
export function missingFor(event) {
  const out = REQUIRED.filter((k) => !event?.[k]);
  if (event?.bookingUrl && !/^https:\/\//.test(event.bookingUrl)) out.push('bookingUrl (verified HTTPS public booking URL)');
  if (wrap(String(event?.title || '').toUpperCase(), 23).length > 2) out.push('title (too long: shorten the display title, keep the full name in the caption)');
  return out;
}
/** Where the photo sits on the artboard (artboard pixels), for the pixel check. */
export function photoRect(format) {
  const y = Y[format === 'story' ? 'story' : 'feed'];
  const s = FORMATS[format].width / 1080;
  return { x: 60 * s, y: y.photo * s, width: 960 * s, height: y.ph * s };
}
export const dataUri = (photo) => `data:${photo.mime};base64,${Buffer.from(photo.bytes).toString('base64')}`;
export const mimeOf = (file) => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg');

function body(event, story, y) {
  return [
    text('Alan Ranger Photography', y.brand, 28),
    text(event.title.toUpperCase(), y.title, 62, '#202020', 700, 23),
    text(event.subtitle, y.sub, 32, '#A54A08', 400, 52),
    `<rect x="60" y="${y.date - 41}" width="960" height="59" rx="4" fill="#C65A08"/>`,
    text(event.dates, y.date, 37, '#FFFFFF', 700, 45),
    text(event.location, y.where, 31, '#202020', 400, 57),
    '%%PHOTO%%',
    text(event.inclusions || '', y.inc, 30, '#202020', 400, 53),
    `<rect x="60" y="${y.offer - 50}" width="960" height="78" fill="#202020"/>`,
    text(event.offer || event.price || 'See details and current availability', y.offer, 37, '#FFFFFF', 700, 43),
    text(event.code ? `Use code ${event.code}` : '', y.code, 36, '#A54A08', 700),
    text(event.deadline ? `Book by ${event.deadline}` : '', y.deadline, 31, '#202020', 700),
    text(story ? 'Tap the booking link' : 'Details and booking in the caption', y.cta, 29, '#A54A08', 700)
  ];
}

/**
 * One SVG master. `photoOnly` draws just the photo on the cream background (the control for the pixel check).
 * Throws on missing facts, like GPT's script.
 */
export function renderSvg(event, photo, format, { photoOnly = false } = {}) {
  const miss = missingFor(event);
  if (miss.length) throw new Error(`Missing required event facts: ${miss.join(', ')}`);
  const { width, height } = FORMATS[format];
  const story = format === 'story';
  const y = Y[story ? 'story' : 'feed'];
  const image = `<image x="60" y="${y.photo}" width="960" height="${y.ph}" preserveAspectRatio="xMidYMid meet" xlink:href="${dataUri(photo)}"/>`;
  const parts = photoOnly ? [image] : body(event, story, y).map((p) => (p === '%%PHOTO%%' ? image : p));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${esc(event.title)} — ${format}</title><desc>Template ${TEMPLATE}. Source photo embedded as one continuous unchanged image. Booking: ${esc(event.bookingUrl)}</desc>`,
    `<rect width="100%" height="100%" fill="#F8F2E8"/><g transform="scale(${width / 1080})">`,
    ...parts,
    '</g></svg>'
  ].join('\n');
}

/** The embedded image(s) of an SVG master, decoded: proves the photo bytes went in unchanged. */
export function embeddedImages(svg) {
  return [...String(svg).matchAll(/<image\b[^>]*xlink:href="data:([^;]+);base64,([^"]+)"/g)].map((m) => ({ mime: m[1], bytes: Buffer.from(m[2], 'base64') }));
}

/** The publishing pack GPT's script writes beside the masters (checks all false until a person verifies them). */
export function publishingPack(event) {
  return {
    template: TEMPLATE, event,
    checks: { facts: false, originalPhotoContinuity: false, phonePreview: false, bookingUrl: false, platformIdentity: false, liveEvidence: false },
    placements: ['facebook_feed', 'instagram_feed', 'instagram_story', 'linkedin_feed'],
    storySticker: { url: event.bookingUrl, label: 'BOOK NOW', suggestedPosition: { x: 0.5, y: 0.88 } },
    status: 'prepared-not-platform-scheduled'
  };
}
