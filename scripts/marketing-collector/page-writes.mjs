/**
 * The only Squarespace writes the collector makes (Alan, 7 Nov 2026, option a): create a mailing list and import the
 * people who passed the consent check into it, and set back to unsubscribed anyone that import switched on; plus (Alan,
 * 8 Nov 2026, option A) the same opt-out for the people of an approved clean-up manifest the dashboard hands over. Run INSIDE
 * the signed-in config page (page.evaluate), self-contained. Nothing here sends or schedules. The CSV import must use "contacts consent to email
 * marketing" (Squarespace refuses the import otherwise), which is why the dashboard re-checks consent after it.
 */

export async function readLists() {
  const r = await fetch('/api/newsletters/v1.0/composer/mailing-lists?includeAllGroupTypes=false', { credentials: 'include', redirect: 'manual' });
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw new Error('SESSION_EXPIRED');
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.results)) throw new Error('UNEXPECTED_SHAPE mailing-lists');
  return j.results.map((l) => ({ id: l.id, name: l.name, count: l.count, unsubscribed: l.unsubscribedCount }));
}

/** Subscribed contacts in the whole account (the "All Subscribers" figure). */
export async function subscribedTotal() {
  const crumb = decodeURIComponent((document.cookie.match(/(?:^|; )crumb=([^;]+)/) || [])[1] || '');
  const r = await fetch('/api/rolodex/1/profiles/filter-and-sort', { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': crumb }, body: JSON.stringify({ pageSize: 10, filters: { acceptsMarketing: { active: true } }, userSort: { field: 'CREATED_ON', order: 'DESC' } }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || typeof j?.totalCount !== 'number') throw new Error(`UNEXPECTED_SHAPE filter-and-sort ${r.status}`);
  return j.totalCount;
}

/**
 * Whose email subscription was started by a CSV import at or after `sinceMs` — i.e. switched on by this import, even
 * if they unsubscribed in the seconds between the before-check and the import. Importing someone already subscribed
 * keeps their original subscribedOn / source (checked 7 Nov 2026). Unreadable records are returned, never assumed ok.
 */
export async function csvSwitchedOn(args) {
  const { ids, sinceMs } = args;
  const switched = [];
  const unreadable = [];
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const r = await fetch(`/api/rolodex/1/subscribers/${id}`, { credentials: 'include' }).catch(() => null);
      const j = r && r.ok ? await r.json().catch(() => null) : null;
      const e = j?.emailSubscriberInfo;
      if (!e || !e.status) { unreadable.push(id); return; }
      if (e.status === 'SUBSCRIBED' && /^INORGANIC_MAILINGLIST_CSV/.test(e.subscriberSource || '') && Number(e.subscribedOn) * 1000 >= sinceMs) switched.push(id);
    }));
  }
  return { switched, unreadable };
}

export async function createList(name) {
  const crumb = decodeURIComponent((document.cookie.match(/(?:^|; )crumb=([^;]+)/) || [])[1] || '');
  const r = await fetch('/api/rolodex/1/mailing-lists', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': crumb }, body: JSON.stringify({ name }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id) throw new Error(`CREATE_LIST ${r.status} ${j?.code || j?.message || ''}`.trim());
  return { id: j.id, name: j.name };
}

/**
 * Undo a consent flip caused by the import: the same call as Contacts → person → ··· → "Opt out of email marketing"
 * (Squarespace also removes the person from their mailing lists). Only used for people the dashboard's after-check
 * found switched from not subscribed to subscribed by this import.
 */
export async function optOut(ids) {
  const crumb = decodeURIComponent((document.cookie.match(/(?:^|; )crumb=([^;]+)/) || [])[1] || '');
  const r = await fetch('/api/rolodex/1/bulk-actions/accepts-marketing/remove', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': crumb }, body: JSON.stringify({ siteUserIds: ids, marketingTypes: ['EMAIL'] }) });
  if (!r.ok) throw new Error(`OPT_OUT ${r.status}`);
  return { status: r.status };
}

/** Each profile's email subscription status read back after an opt-out ('SUBSCRIBED', another status, or null = unreadable). */
export async function consentStatus(ids) {
  const status = {};
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const r = await fetch(`/api/rolodex/1/subscribers/${id}`, { credentials: 'include' }).catch(() => null);
      const j = r && r.ok ? await r.json().catch(() => null) : null;
      status[id] = j?.emailSubscriberInfo?.status || null;
    }));
  }
  return { status };
}

export async function uploadCsv(args) {
  const { listId, csv, filename } = args;
  const crumb = decodeURIComponent((document.cookie.match(/(?:^|; )crumb=([^;]+)/) || [])[1] || '');
  const r = await fetch(`/api/newsletters/v1.0/composer/mailing-lists/${listId}/csv/upload?acceptsEmailMarketing=true&acceptsSmsMarketing=false`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'text/csv', 'x-csrf-token': crumb, filename, accept: 'application/json' }, body: csv });
  const text = await r.text();
  if (!r.ok) throw new Error(`UPLOAD ${r.status} ${text.slice(0, 160)}`);
  return { status: r.status, body: text.slice(0, 300) };
}
