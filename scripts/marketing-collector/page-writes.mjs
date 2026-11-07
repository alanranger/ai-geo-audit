/**
 * The only Squarespace writes the collector makes (Alan, 7 Nov 2026, option a): create a mailing list and import the
 * people who passed the consent check into it. Run INSIDE the signed-in config page (page.evaluate), self-contained.
 * Nothing here sends, schedules, unsubscribes or edits a contact. The CSV import must use "contacts consent to email
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

export async function createList(name) {
  const crumb = decodeURIComponent((document.cookie.match(/(?:^|; )crumb=([^;]+)/) || [])[1] || '');
  const r = await fetch('/api/rolodex/1/mailing-lists', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': crumb }, body: JSON.stringify({ name }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id) throw new Error(`CREATE_LIST ${r.status} ${j?.code || j?.message || ''}`.trim());
  return { id: j.id, name: j.name };
}

export async function uploadCsv(args) {
  const { listId, csv, filename } = args;
  const crumb = decodeURIComponent((document.cookie.match(/(?:^|; )crumb=([^;]+)/) || [])[1] || '');
  const r = await fetch(`/api/newsletters/v1.0/composer/mailing-lists/${listId}/csv/upload?acceptsEmailMarketing=true&acceptsSmsMarketing=false`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'text/csv', 'x-csrf-token': crumb, filename, accept: 'application/json' }, body: csv });
  const text = await r.text();
  if (!r.ok) throw new Error(`UPLOAD ${r.status} ${text.slice(0, 160)}`);
  return { status: r.status, body: text.slice(0, 300) };
}
