/**
 * Reads run INSIDE the signed-in Squarespace config page (page.evaluate). Each is self-contained (no closures) and
 * throws on an unexpected response shape or a missing session, so the run is marked failed / stale — never zero.
 * Endpoints are Squarespace's own internal report JSON (the same calls its Email Campaigns pages make); read-only GETs.
 */

/** Shared fetch for the page functions below (injected as a string). */
export const PAGE_HELPERS = `
  window.__arpGet = async function (path) {
    let r;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      r = await fetch(path, { credentials: 'include', redirect: 'manual' });
      if (r.status < 500) break;
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
    }
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

/**
 * Squarespace's Scheduled tab (same list route as Sent, emailState=SCHEDULED) + each email's own record for its list
 * ids, + the mailing-list counts for the recipient number (one list = its unique contacts; several = a sum, labelled an
 * upper bound; a list not in the response = unknown, never 0). Throws unless every page and every record was read.
 */
export async function listScheduled() {
  const readPages = async () => {
    const out = [];
    let cursor = '';
    let pages = 0;
    let max = null;
    do {
      const j = await window.__arpGet(`/api/newsletters/v1.0/composer/emails?emailState=SCHEDULED&pageCursor=${encodeURIComponent(cursor)}&pageSize=50`);
      if (!Array.isArray(j.results) || typeof j.hasNextPage !== 'boolean') throw new Error('UNEXPECTED_SHAPE scheduled list');
      max = j.maxCount ?? max;
      out.push(...j.results);
      cursor = j.hasNextPage ? j.nextPageCursor : null;
      pages += 1;
    } while (cursor && pages < 20);
    if (cursor || (max != null && out.length !== max)) throw new Error(`INCOMPLETE scheduled list ${out.length}/${max}`);
    return out;
  };
  const isScheduled = (e, d) => !!e.id && d.id === e.id && d.emailState === 'SCHEDULED' && !!d.scheduledSendDate && Array.isArray(d.mailingListIds);
  const all = await readPages();
  const counts = new Map();
  const readLists = async (allTypes) => {
    const l = await window.__arpGet(`/api/newsletters/v1.0/composer/mailing-lists?includeAllGroupTypes=${allTypes}`);
    if (!Array.isArray(l.results)) throw new Error('UNEXPECTED_SHAPE mailing-lists');
    for (const x of l.results) if (x.id && typeof x.count === 'number') counts.set(x.id, x.count);
  };
  if (all.length) await readLists(false);
  const details = [];
  for (const e of all) {
    const d = await window.__arpGet(`/api/newsletters/v1.0/composer/emails/${encodeURIComponent(e.id)}`);
    if (!isScheduled(e, d)) throw new Error(`UNEXPECTED_SHAPE scheduled email ${e.id}`);
    details.push({ e, d });
  }
  if (details.some(({ d }) => d.mailingListIds.some((id) => !counts.has(id)))) await readLists(true);
  const recipientsOf = (ids) => {
    const n = ids.map((id) => counts.get(id));
    if (!ids.length || n.some((v) => typeof v !== 'number')) return { recipients: null, recipients_basis: 'unknown' };
    return { recipients: n.reduce((s, v) => s + v, 0), recipients_basis: ids.length === 1 ? 'single_list_count' : 'sum_of_lists_upper_bound' };
  };
  const emails = details.map(({ e, d }) => ({
    email_id: d.id, subject: d.subject || d.derivedSubject || e.subject || null, email_type: d.emailType || e.emailType || null, scheduled_for: d.scheduledSendDate, scheduled_tz: 'UTC',
    mailing_list_ids: d.mailingListIds, mailing_list_names: Array.isArray(d.mailingLists) ? d.mailingLists : (e.mailingListNames || []), ...recipientsOf(d.mailingListIds)
  }));
  return { complete: true, read_at: new Date().toISOString(), emails };
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
