/**
 * Dashboard strip for dated manual reminders (GET / PATCH /api/aigeo/ops-reminders), shown under the CEO-brief hold
 * banner at the top of every panel. Overdue = amber, due this week = blue, upcoming = grey; hidden when none are open.
 * "Mark done" sends the admin key saved in this browser; once done, a reminder leaves the strip and the Monday brief.
 */
(function () {
  const STRIP_ID = 'ops-reminders-strip';
  const TONE = {
    overdue: { border: '#f79009', bg: '#fffaeb', fg: '#93370d', pill: 'Overdue' },
    due: { border: '#1857c4', bg: '#eff8ff', fg: '#1d2939', pill: 'Due this week' },
    upcoming: { border: '#d0d5dd', bg: '#f9fafb', fg: '#344054', pill: 'Upcoming' },
  };
  const api = (p) => (window.apiUrl ? window.apiUrl(p) : p);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const adminKey = () => (window.getAdminKey ? window.getAdminKey() : (sessionStorage.getItem('arp_admin_key') || localStorage.getItem('arp_admin_key') || ''));

  function stripEl() {
    let el = document.getElementById(STRIP_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = STRIP_ID;
    el.style.cssText = 'display:none;margin:0 0 1rem;font-size:0.9rem;line-height:1.5;';
    const anchor = document.getElementById('ceo-brief-hold-banner');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
    else (document.querySelector('main.aigeo-main') || document.body).prepend(el);
    return el;
  }

  function stepsHtml(r) {
    const steps = Array.isArray(r.steps) ? r.steps : [];
    if (!steps.length) return '';
    return `<details style="margin:0.3rem 0 0;"><summary style="cursor:pointer;color:#475467;">Steps (${steps.length})</summary><ol style="margin:0.35rem 0 0 1.2rem;padding:0;color:#344054;">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`;
  }

  function rowHtml(r) {
    const t = TONE[r.state] || TONE.upcoming;
    const title = r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener" style="color:inherit;">${esc(r.title)}</a>` : esc(r.title);
    return `<div data-ops-reminder="${esc(r.id)}" style="padding:0.7rem 1rem;border-left:4px solid ${t.border};background:${t.bg};border-radius:8px;color:${t.fg};margin:0 0 0.5rem;">`
      + `<span style="display:inline-block;font-size:0.75rem;font-weight:700;padding:1px 8px;border-radius:999px;border:1px solid ${t.border};margin-right:0.5rem;">${t.pill}</span>`
      + `<b>Due ${esc(r.due_label || r.due_date)}</b> · ${title}`
      + `<button type="button" class="btn btn-secondary" data-ops-done="${esc(r.id)}" style="margin-left:0.75rem;">Mark done</button>`
      + `<span data-ops-status="${esc(r.id)}" style="margin-left:0.5rem;"></span>${stepsHtml(r)}</div>`;
  }

  function render(reminders) {
    const el = stripEl();
    el.style.display = reminders.length ? 'block' : 'none';
    el.innerHTML = reminders.length ? `<div style="font-weight:700;color:#344054;margin:0 0 0.4rem;">Reminders · dated manual steps <span style="font-weight:400;color:#98a2b3;">(each shows in the Monday brief from the week it's due)</span></div>${reminders.map(rowHtml).join('')}` : '';
  }

  async function refresh() {
    try {
      const r = await fetch(api('/api/aigeo/ops-reminders'), { cache: 'no-store' });
      const body = await r.json();
      render(body && body.ok && Array.isArray(body.reminders) ? body.reminders : []);
    } catch (e) { /* strip stays hidden */ }
  }

  async function markDone(id, btn) {
    const status = document.querySelector(`[data-ops-status="${CSS.escape(String(id))}"]`);
    if (!adminKey()) { alert('Admin key required. Please set your admin key in the "Optimisation Tracking Security" section.'); return; }
    if (!window.confirm('Mark this reminder done? It drops off the dashboard and the Monday brief.')) return;
    btn.disabled = true;
    if (status) status.textContent = 'Saving…';
    const r = await fetch(api('/api/aigeo/ops-reminders'), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': adminKey() }, body: JSON.stringify({ id: Number(id), done: true }) }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    if (body.ok) return refresh();
    btn.disabled = false;
    if (status) status.textContent = `Not saved: ${body.error || (r ? r.status : 'network error')}`;
    return undefined;
  }

  function onClick(e) {
    const btn = e.target.closest && e.target.closest('[data-ops-done]');
    if (btn) markDone(btn.getAttribute('data-ops-done'), btn);
  }

  function init() {
    stripEl().addEventListener('click', onClick);
    refresh();
  }

  window.refreshOpsReminders = refresh;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
