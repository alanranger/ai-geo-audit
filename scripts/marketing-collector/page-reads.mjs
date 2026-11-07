/**
 * Reads run INSIDE the signed-in Squarespace config page (page.evaluate). Each is self-contained (no closures) and
 * throws on an unexpected response shape or a missing session, so the run is marked failed / stale — never zero.
 * Endpoints are Squarespace's own internal report JSON (the same calls its Email Campaigns pages make); read-only GETs.
 */

/** Shared fetch for the page functions below (injected as a string). */
export const PAGE_HELPERS = `
  window.__arpGet = async function (path) {
    const r = await fetch(path, { credentials: 'include', redirect: 'manual' });
    if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw new Error('SESSION_EXPIRED');
    if (!r.ok) throw new Error('HTTP_' + r.status + ' ' + path.split('?')[0]);
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== 'object') throw new Error('UNEXPECTED_SHAPE ' + path.split('?')[0]);
    return j;
  };
`;

export async function readMeter() {
  const j = await window.__arpGet('/api/newsletters/v1.0/composer/billing/billing-state');
  if (!j.quotas || typeof j.quotas.EMAILS !== 'number' || !j.usage || typeof j.usage.EMAILS !== 'number' || !j.usageResetDate) throw new Error('UNEXPECTED_SHAPE billing-state');
  return { quota: j.quotas.EMAILS, used: j.usage.EMAILS, reset_at: j.usageResetDate, blast_campaigns: j.usage.BLAST_CAMPAIGNS ?? null, sending_disabled: !!j.isSendingDisabled, captured_at: new Date().toISOString() };
}

export async function listSent() {
  const out = [];
  let cursor = '';
  let pages = 0;
  let max = null;
  do {
    const j = await window.__arpGet(`/api/newsletters/v1.0/composer/emails?emailState=SENT&pageCursor=${encodeURIComponent(cursor)}&pageSize=50`);
    if (!Array.isArray(j.results) || typeof j.hasNextPage !== 'boolean') throw new Error('UNEXPECTED_SHAPE emails list');
    max = j.maxCount ?? max;
    out.push(...j.results.map((e) => ({ email_id: e.id, subject: e.subject || e.derivedSubject, sent_on: e.sentOn, email_type: e.emailType, mailing_list_names: e.mailingListNames || [], message_count_list: e.emailMessageCount })));
    cursor = j.hasNextPage ? j.nextPageCursor : null;
    pages += 1;
  } while (cursor && pages < 100);
  if (max != null && out.length !== max) throw new Error(`INCOMPLETE emails list ${out.length}/${max}`);
  return out;
}

export async function readSummary(emailId) {
  const s = await window.__arpGet(`/api/newsletters/v1.0/composer/analytics/emails/${emailId}/summary`);
  if (typeof s.emailMessageCount !== 'number' || typeof s.deliveredCount !== 'number' || !Array.isArray(s.urlClickCounts)) throw new Error(`UNEXPECTED_SHAPE summary ${emailId}`);
  return { message_count: s.emailMessageCount, delivered: s.deliveredCount, opened: s.openedCount, clicked: s.clickedCount, unsubscribed: s.unsubscribedCount, url_clicks: s.urlClickCounts.map((u) => ({ url: u.url, count: u.count })) };
}

/** All recipients for one event type (optionally one clicked link), paged to the end. */
export async function readEventUsers(args) {
  const { emailId, type, url } = args;
  const out = [];
  let cursor = '';
  let pages = 0;
  do {
    const q = `type=${type}${url ? `&url=${encodeURIComponent(url)}` : ''}${cursor ? `&pageCursor=${encodeURIComponent(cursor)}` : ''}`;
    const j = await window.__arpGet(`/api/newsletters/v1.0/composer/analytics/emails/${emailId}/event-users?${q}`);
    if (!Array.isArray(j.results) || typeof j.hasNextPage !== 'boolean') throw new Error(`UNEXPECTED_SHAPE event-users ${type}`);
    for (const u of j.results) {
      if (!u.id || !u.email) throw new Error(`UNEXPECTED_SHAPE event user ${type}`);
      out.push({ event_type: type, recipient_id: u.id, url: url || '', email: u.email, event_count: u.eventCount ?? null, event_at: u.timestamp || null });
    }
    cursor = j.hasNextPage ? j.nextPageCursor : null;
    pages += 1;
  } while (cursor && pages < 2000);
  if (cursor) throw new Error(`INCOMPLETE event-users ${type}`);
  return out;
}
