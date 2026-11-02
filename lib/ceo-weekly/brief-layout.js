/**
 * Monday brief redesign (batch 8 task 15h): HTML for the NEW blocks, copied from the approved
 * mockup (03 Page Builds/MOCKUP-monday-brief-v7-headline-tiles.html) — same tables, inline styles,
 * sizes and colours; only the figures are live.
 */
const AF = 'font-family:Arial,Helvetica,sans-serif';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const signedGbp = (n) => `${n < 0 ? '−' : '+'}${gbp(Math.abs(n))}`;
const signedPct = (n) => `${n < 0 ? '−' : '+'}${Math.abs(n)}%`;

const TILE_TONES = {
  red: { bg: '#fdecec', border: '#f5b5b5', fg: '#b42318' },
  amber: { bg: '#fdf3e2', border: '#f3d27a', fg: '#b45309' },
  green: { bg: '#e7f6ec', border: '#a6e0b8', fg: '#067647' },
  grey: { bg: '#f2f4f7', border: '#d0d5dd', fg: '#667085' }
};
const SUB_TONES = { grey: '#667085', red: '#b42318', amber: '#b45309', green: '#067647' };

// ---------------- headlines ----------------

function tileCell(t) {
  const c = TILE_TONES[t.tone] || TILE_TONES.grey;
  const value = t.valueHtml || esc(t.value);
  return `<td width="25%" style="padding:4px;vertical-align:top"><div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:10px;height:132px;${AF}">
<div style="font-size:22px;font-weight:800;color:${c.fg}">${value}</div>
<div style="font-size:12px;font-weight:700;color:#101828;margin-top:4px">${esc(t.label)}</div>
<div style="font-size:11px;color:#475467;margin-top:3px">${esc(t.sub)}</div>
<div style="font-size:10px;color:#98a2b3;margin-top:4px">→ section ${esc(t.section)}</div></div></td>`;
}

export function renderHeadlinesHtml(tiles) {
  if (!tiles?.length) return '';
  const row = (list) => `<tr>${list.map(tileCell).join('')}</tr>`;
  return `<tr><td style="padding:16px 24px 4px;${AF}"><div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px">HEADLINES</div></td></tr>
<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${row(tiles.slice(0, 4))}${row(tiles.slice(4, 8))}</table></td></tr>`;
}

// ---------------- cards A · B · C ----------------

function cardRow(r, last) {
  const border = last ? '' : 'border-bottom:1px solid #eef1f5;';
  const label = r.labelHtml != null ? r.labelHtml : esc(r.label);
  const value = r.valueHtml || esc(r.value);
  const sub = r.sub ? `<div style="font-size:12px;color:${SUB_TONES[r.sub.tone] || SUB_TONES.grey};margin-top:3px">${esc(r.sub.text)}</div>` : '';
  return `<tr><td style="padding:10px 14px;${border}width:36%;vertical-align:top;color:#475467;font-size:13px;${AF}">${label}</td><td style="padding:10px 14px;${border}vertical-align:top;${AF}"><div style="font-size:14px;font-weight:700;color:#101828">${value}</div>${sub}</td></tr>`;
}

export function renderCardHtml(card) {
  if (!card) return '';
  const rows = card.rows.map((r, i) => cardRow(r, i === card.rows.length - 1)).join('\n');
  return `<tr><td style="padding:16px 28px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e7ec;border-radius:10px;border-collapse:separate;overflow:hidden">
<tr><td colspan="2" style="background:#f7f9fc;border-bottom:1px solid #e4e7ec;padding:10px 14px;${AF}">
<span style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px">${esc(card.title)}</span>
<span style="float:right;color:#98a2b3;font-size:11px">${esc(card.right)}</span></td></tr>
${rows}
</table></td></tr>`;
}

export function renderActionsFootnoteHtml() {
  return `<tr><td style="padding:12px 28px 4px;font-size:11px;color:#98a2b3;${AF}">Next 6 days are never actions (too late to sell) — they stay in the Pipeline. Events in the next 6 weeks with no bookings are left out (unlikely to run). Other actions only appear with a measured comparison behind them, and drop off for 28 days once actioned. Website tasks are skipped for 28 days after that page was changed.</td></tr>`;
}

// ---------------- section breaks ----------------

export function renderSectionHeadingHtml(title, subtitle) {
  return `<tr><td style="padding:26px 28px 6px;"><div style="border-top:4px solid #0f2a44;padding-top:12px;"><div style="color:#0f2a44;font-size:17px;font-weight:800;${AF}">${esc(title)}</div><div style="color:#98a2b3;font-size:11px;${AF}">${esc(subtitle)}</div></div></td></tr>`;
}

const newTag = (text) => `<div style="display:inline-block;background:#e8f1ff;color:#1857c4;font-size:10px;font-weight:800;border-radius:4px;padding:2px 6px;margin-bottom:6px;font-family:Arial">${esc(text)}</div>`;

// ---------------- pipeline ----------------

const PIPE_TILE_LABEL = { w0: '0–30 days', w1: '31–60 days', w2: '61–90 days', w3: '90+ days' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function pipelineTile(w) {
  const empty = !w.people;
  const box = empty ? 'border:1px solid #f5b5b5;background:#fdecec;' : 'border:1px solid #e4e7ec;';
  const num = empty ? 'font-size:22px;font-weight:800;color:#b42318' : 'font-size:22px;font-weight:800';
  let money = empty ? 'nothing booked' : `${gbp(w.taken)} taken`;
  if (!empty && w.due) money = `${gbp(w.taken)} · ${gbp(w.due)} due`;
  return `<td style="${box}border-radius:8px;padding:8px 10px;width:25%"><div style="font-size:11px;color:#667085;font-weight:700">${PIPE_TILE_LABEL[w.key]}</div><div style="${num}">${w.people}</div><div style="font-size:11px;color:#475467">people · ${plural(w.events, 'event', 'events')}<br>${money}</div></td>`;
}

const PILL = {
  Empty: 'background:#fdecec;color:#b42318',
  Low: 'background:#fdf3e2;color:#b45309',
  Booked: 'background:#fdf3e2;color:#b45309',
  OK: 'background:#e7f6ec;color:#067647'
};

function whoText(r) {
  if (!r.who.length) return null;
  const jlr = r.who.filter((w) => w.jlr).length;
  const named = r.who.filter((w) => !w.jlr).map((w) => `${esc(cleanName(w.name))}${w.note ? ' ⚑' : ''}`);
  if (jlr) named.push(`${jlr} JLR delegate${jlr === 1 ? '' : 's'}`);
  return named.join(', ');
}

export function cleanName(name) {
  return String(name || '').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim();
}

function eventCell(r) {
  const jlr = r.who.some((w) => w.jlr) ? ` <span style="color:#98a2b3;font-size:11px">(JLR)</span>` : '';
  const name = r.url
    ? `<a href="${esc(r.url)}" style="color:#1857c4;text-decoration:none">${esc(r.name)}</a>`
    : esc(r.name);
  return `${name}${jlr}`;
}

function pipelineRow(r) {
  const cell = `padding:6px 8px;border-top:1px solid #eef1f4;vertical-align:top;`;
  const greyOut = r.booked ? '' : 'color:#98a2b3;';
  const who = whoText(r);
  const date = new Date(`${r.date}T12:00:00Z`);
  const dLabel = `${date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${date.getUTCDate()} ${date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  const due = r.due ? `<br><span style="color:#b42318;font-size:11px">${gbp(r.due)} due</span>` : '';
  return `<tr><td style="${cell}white-space:nowrap;${greyOut}${AF}">${dLabel}<br><span style="color:#98a2b3;font-size:11px">in ${r.days}d</span></td>`
    + `<td style="${cell}${AF}">${eventCell(r)}</td>`
    + `<td style="${cell}white-space:nowrap;${AF}">${r.booked} / ${r.cap ?? '?'}<br><span style="display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;${PILL[r.label] || PILL.Low};${AF}">${r.label}</span></td>`
    + `<td style="${cell}${who ? '' : 'color:#98a2b3;'}${AF}">${who || '—'}</td>`
    + `<td style="${cell}text-align:right;white-space:nowrap;${greyOut}${AF}">${gbp(r.taken)}${due}</td></tr>`;
}

function windowHead(w) {
  const nothing = !w.people;
  const bg = nothing ? '#9f1d1d' : '#1e293b';
  let tail = nothing ? 'nothing booked' : `${plural(w.people, 'person', 'people')} · ${gbp(w.taken)}`;
  if (!nothing && w.due) tail += ` · ${gbp(w.due)} due`;
  return `<div style="background:${bg};color:#fff;padding:6px 10px;border-radius:6px 6px 0 0;font-size:12.5px;${AF}"><b>${esc(w.head)}</b> · ${tail}</div>`;
}

function windowTable(w) {
  const head = `<tr style="color:#667085;font-size:11px;background:#f7f9fc"><td style="padding:5px 8px">Date</td><td style="padding:5px 8px">Event</td><td style="padding:5px 8px">Booked</td><td style="padding:5px 8px">Who</td><td style="padding:5px 8px" align="right">£ taken</td></tr>`;
  return `${windowHead(w)}
<table width="100%" cellpadding="0" cellspacing="0" style="${AF};font-size:12.5px;border:1px solid #e4e7ec;border-top:0;margin-bottom:10px">
${head}
${w.rows.map(pipelineRow).join('\n')}
</table>`;
}

function pipelineFootnote(p) {
  const flags = (p.flags || []).map((f) => `⚑ ${esc(cleanName(f.name))}'s row says "${esc(f.note)}" — check.`);
  const t = p.totals;
  const total = `Total: ${plural(t.events, 'event', 'events')} · ${plural(t.people, 'person', 'people')} · ${gbp(t.taken)} taken · ${gbp(t.due)} due`;
  return `<div style="color:#6b7280;font-size:11px;${AF};margin-bottom:6px">Labels: <b>Empty</b> = 0 booked · <b>Low</b> = under half full · <b>OK</b> = half full or more. Event names link to the product page.<br>${[...flags, total].join(' · ')}</div>`;
}

export function renderPipelineHtml(p) {
  if (!p?.windows) return `<tr><td style="padding:4px 28px 12px;color:#667085;font-size:12px;${AF}">Pipeline unavailable${p?.error ? `: ${esc(p.error)}` : ''}</td></tr>`;
  return `<tr><td style="padding:4px 28px 12px;">${newTag('NEW · pipeline')}<div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px;font-family:Arial">PIPELINE · WHAT'S BOOKED AHEAD</div>
<div style="color:#6b7280;font-size:11.5px;margin:2px 0 10px;font-family:Arial">By event date · £ taken = what you'd refund if it didn't run</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="font-family:Arial;margin-bottom:10px"><tr>
${p.windows.map(pipelineTile).join('\n')}
</tr></table>
${p.windows.map(windowTable).join('\n')}
${pipelineFootnote(p)}
</td></tr>`;
}

// ---------------- sales tab ----------------

function varCell(v, extra = '') {
  const color = v < 0 ? '#b42318' : '#067647';
  return `<td align="right" style="${extra}color:${color}">${signedGbp(v)}</td>`;
}

function pctCell(p, extra = '') {
  if (p == null) return `<td align="right"${extra ? ` style="${extra}"` : ''}>—</td>`;
  return `<td align="right" style="${extra}color:${p < 0 ? '#b42318' : '#067647'}">${signedPct(p)}</td>`;
}

export function renderSalesTabHtml(s, monthShortLabel) {
  if (!s?.available) return `<tr><td style="padding:4px 28px 12px;color:#667085;font-size:12px;${AF}">Sales tab targets unavailable${s?.reason ? `: ${esc(s.reason)}` : ''}</td></tr>`;
  const pace = s.on_pace_visible ? `on pace for ${gbp(s.on_pace_for)}` : 'pace shown from week 2';
  const head = `${monthShortLabel} so far (${s.working_days_elapsed} of ${s.working_days_month} working days) ${gbp(s.mtd)} vs ${gbp(s.month_target)} target · ${pace} · YTD ${gbp(s.ytd_actual)} vs ${gbp(s.ytd_target)} (${signedPct(s.ytd_pct)}) · GP YTD ${gbp(s.gp_ytd)} (${s.gp_pct}%)`;
  const rows = s.categories.map((c) => `<tr><td style="padding:5px 0">${esc(c.label)}</td><td align="right">${gbp(c.mtd)}</td><td align="right">${c.target_month == null ? '—' : gbp(c.target_month)}</td>${varCell(c.ytd_var)}${pctCell(c.ytd_pct)}</tr>`).join('\n');
  const bt = 'border-top:2px solid #e4e7ec;';
  return `<tr><td style="padding:4px 28px 12px;">${newTag(`NEW · from your Sales ${s.year} tab`)}<div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px;font-family:Arial">THIS MONTH &amp; YEAR TO DATE · YOUR TARGETS</div>
<div style="color:#6b7280;font-size:11.5px;margin:2px 0 8px;font-family:Arial">${esc(head)}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial;font-size:12.5px;margin-bottom:10px">
<tr style="color:#667085;font-size:11px"><td style="padding:5px 0;border-bottom:1px solid #e4e7ec">Category</td><td align="right" style="padding:5px 0;border-bottom:1px solid #e4e7ec">${esc(monthShortLabel)} so far</td><td align="right" style="padding:5px 0;border-bottom:1px solid #e4e7ec">Target/mo</td><td align="right" style="padding:5px 0;border-bottom:1px solid #e4e7ec">YTD var</td><td align="right" style="padding:5px 0;border-bottom:1px solid #e4e7ec">YTD %</td></tr>
${rows}
<tr style="font-weight:800"><td style="padding:6px 0;${bt.slice(0, -1)}">Total</td><td align="right" style="${bt.slice(0, -1)}">${gbp(s.mtd)}</td><td align="right" style="${bt.slice(0, -1)}">${gbp(s.month_target)}</td>${varCell(s.ytd_var, bt)}${pctCell(s.ytd_pct, bt)}</tr>
</table>
</td></tr>`;
}

// ---------------- system health ----------------

const MARK = { ok: '✅', warn: '⚠️', fail: '❌' };

export function renderSystemHealthHtml(lines) {
  const rows = (lines || []).map((l, i) => `<tr><td style="padding:5px 0${i === 0 ? ';width:22px' : ''}">${MARK[l.state] || MARK.warn}</td><td style="padding:5px 0">${esc(l.text)}</td></tr>`).join(' ');
  return `<tr><td style="padding:4px 28px 12px;">${newTag('NEW · system health')}<table width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial;font-size:12.5px;margin-bottom:6px"> ${rows} </table> </td></tr>`;
}
