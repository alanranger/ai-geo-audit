/**
 * One audience line for an email delivery (side panel): "X people + 1 business copy = Y sends", owner addresses and
 * organisations shown apart (never inside "people"), and "query now N vs plan estimate M" when the live saved-group
 * count and the plan's estimate differ. Reads delivery.aud from lib/marketing/delivery-reserve.mjs audienceOf().
 * Accepts the delivery itself, a delivery-builder item ({ delivery }) or a schedule-model card ({ raw: { delivery } }).
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => Number(v).toLocaleString('en-GB');
  const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many}`;
  const BASIS = { snapshot: 'frozen snapshot', query: 'saved group, counted now', estimate: 'plan estimate', provider: 'Squarespace count', reservation: 'typed on the record' };

  function deliveryOf(x) {
    if (!x) return null;
    if (x.aud) return x;
    if (x.delivery) return x.delivery;
    return x.raw && x.raw.delivery ? x.raw.delivery : null;
  }

  /** "X people + 1 business copy [+ N owner addresses] = Y sends"; owner addresses appear only when frozen into the list. */
  function sumText(a) {
    if (a.sends == null) return 'audience not counted yet';
    if (a.people == null) return `${plural(a.sends, 'send', 'sends')}`;
    const parts = [plural(a.people, 'person', 'people')];
    if (a.business_copy) parts.push(`${n(a.business_copy)} business copy`);
    const frozenOwners = a.basis !== 'query' && a.owner_addresses > 0 && a.people + (a.business_copy || 0) + a.owner_addresses === a.sends;
    if (frozenOwners) parts.push(plural(a.owner_addresses, 'owner address', 'owner addresses'));
    return `${parts.join(' + ')} = ${plural(a.sends, 'send', 'sends')}`;
  }

  function apartText(a) {
    const out = [];
    const inSum = a.basis !== 'query' && a.people != null && a.people + (a.business_copy || 0) + (a.owner_addresses || 0) === a.sends;
    if (a.owner_addresses > 0 && !inSum) out.push(`${plural(a.owner_addresses, 'owner address', 'owner addresses')} also matched (not counted as people or sends)`);
    if (a.organisations > 0) out.push(`${plural(a.organisations, 'organisation', 'organisations')} also matched (not counted as people or sends)`);
    if (a.organisations == null && a.basis === 'snapshot') out.push('organisations are not split out in a frozen snapshot');
    if (a.since_frozen_line) out.push(a.since_frozen_line);
    return out;
  }

  function compareText(a) {
    if (!a.differs) return '';
    const who = a.query_people != null ? ` (${plural(a.query_people, 'person', 'people')}${a.query_group ? ` in ${a.query_group}` : ''})` : '';
    return `Query now vs plan estimate: query now ${n(a.query_now)} sends${who} vs plan estimate ${n(a.plan_estimate)} sends`;
  }

  function html(item) {
    const d = deliveryOf(item);
    if (!d) return '';
    const a = d.aud || { sends: d.amount ?? null, people: null };
    const basis = BASIS[a.basis] ? ` <span class="mk-aud-basis">(${esc(BASIS[a.basis])})</span>` : '';
    const lines = [`<div class="mk-aud-sum"><strong>${esc(sumText(a))}</strong>${basis}</div>`];
    for (const t of apartText(a)) lines.push(`<div class="mk-aud-apart">${esc(t)}</div>`);
    const cmp = compareText(a);
    if (cmp) lines.push(`<div class="mk-aud-compare">${esc(cmp)}</div>`);
    return `<div class="mk-aud-line">${lines.join('')}</div>`;
  }

  window.MarketingAudienceLine = { html };
})();
