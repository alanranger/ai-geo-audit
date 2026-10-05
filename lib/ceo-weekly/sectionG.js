/**
 * CEO weekly Section G — Profit levers scorecard (live compute every run).
 * Calendar months only (MTD / prev / prev-1). Targets from business_targets.
 */
import { resolveGpTargetsBundle, DEFAULT_SECTION_G_CONFIG } from '../business-targets.mjs';

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}
function round0(n) {
  return Math.round(Number(n || 0));
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function monthParts(asOf) {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  const day = asOf.getUTCDate();
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const prev2 = prev.month === 1 ? { year: prev.year - 1, month: 12 } : { year: prev.year, month: prev.month - 1 };
  return {
    cur: { year: y, month: m, day, daysIn, label: monthLabel(y, m) },
    prev: { ...prev, label: monthLabel(prev.year, prev.month) },
    prev2: { ...prev2, label: monthLabel(prev2.year, prev2.month) },
    asOfYmd: ymd(asOf)
  };
}
function monthLabel(y, m) {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function pace(monthlyTarget, day, daysIn) {
  if (!monthlyTarget || !daysIn) return null;
  return round1((monthlyTarget * day) / daysIn);
}
function statusPace(actual, paceNow, { tooEarly = false, prevStatus = null } = {}) {
  if (tooEarly) return { status: 'Too early', detail: prevStatus ? `Prev: ${prevStatus}` : null };
  if (paceNow == null || actual == null) return { status: '—', detail: null };
  return { status: actual >= paceNow ? 'On pace' : 'Off pace', detail: null };
}

async function sumSalesExclJlr(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  // Prefer transactions for MTD / excl JLR accuracy.
  let q = supabase
    .from('booking_sheet_transactions')
    .select('amount, txn_date, is_jlr, is_redemption')
    .eq('property_url', propertyUrl)
    .gte('txn_date', `${year}-${String(month).padStart(2, '0')}-01`)
    .lt('txn_date', month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`);
  const { data, error } = await q;
  if (error) throw error;
  let sum = 0;
  for (const r of data || []) {
    if (r.is_jlr || r.is_redemption) continue;
    const d = Number(String(r.txn_date).slice(8, 10));
    if (mtdDay != null && d > mtdDay) continue;
    sum += Number(r.amount) || 0;
  }
  return round0(sum);
}

async function sumGp(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  if (mtdDay != null) {
    // Approximate MTD GP = MTD sales × that year's category mix rates via monthly category prorata.
    const sales = await sumSalesExclJlr(supabase, propertyUrl, year, month, { mtdDay });
    const fullSales = await sumSalesExclJlr(supabase, propertyUrl, year, month);
    const fullGp = await sumGpFromCategory(supabase, propertyUrl, year, month);
    if (!fullSales) return 0;
    return round0(fullGp * (sales / fullSales));
  }
  return sumGpFromCategory(supabase, propertyUrl, year, month);
}

async function sumGpFromCategory(supabase, propertyUrl, year, month) {
  const { data: cats, error } = await supabase
    .from('booking_sheet_monthly_category')
    .select('category_label, revenue_amount')
    .eq('property_url', propertyUrl)
    .eq('year', year)
    .eq('month', month);
  if (error) throw error;
  const { data: gps, error: gErr } = await supabase
    .from('booking_sheet_category_gp')
    .select('category_label, gp_rate')
    .eq('property_url', propertyUrl)
    .eq('year', year);
  if (gErr) throw gErr;
  const rate = new Map((gps || []).map((g) => [g.category_label, Number(g.gp_rate) || 0]));
  let gp = 0;
  for (const r of cats || []) gp += (Number(r.revenue_amount) || 0) * (rate.get(r.category_label) || 0);
  return round0(gp);
}

async function highMarginShare(supabase, propertyUrl, year, month) {
  const { data: cats } = await supabase
    .from('booking_sheet_monthly_category')
    .select('category_label, revenue_amount')
    .eq('property_url', propertyUrl)
    .eq('year', year)
    .eq('month', month);
  const { data: gps } = await supabase
    .from('booking_sheet_category_gp')
    .select('category_label, gp_rate')
    .eq('property_url', propertyUrl)
    .eq('year', year);
  const rate = new Map((gps || []).map((g) => [g.category_label, Number(g.gp_rate) || 0]));
  let total = 0;
  let hi = 0;
  for (const r of cats || []) {
    const g = (Number(r.revenue_amount) || 0) * (rate.get(r.category_label) || 0);
    total += g;
    if ((rate.get(r.category_label) || 0) >= 0.9) hi += g;
  }
  return total > 0 ? round0((hi / total) * 100) : null;
}

async function existingReferralCount(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  const { data } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, txn_date, is_jlr, booking_source')
    .eq('property_url', propertyUrl)
    .gte('txn_date', `${year}-${String(month).padStart(2, '0')}-01`)
    .lt('txn_date', month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`);
  let n = 0;
  for (const r of data || []) {
    if (r.is_jlr || !(Number(r.amount) > 0)) continue;
    const src = String(r.booking_source || '');
    if (!/^(Existing|Referral)$/i.test(src)) continue;
    const d = Number(String(r.txn_date).slice(8, 10));
    if (mtdDay != null && d > mtdDay) continue;
    n += 1;
  }
  return n;
}

async function rankingDataCheck(supabase, propertyUrl) {
  const { data: latest } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const auditDate = latest?.audit_date;
  if (!auditDate) return { ok: false, message: 'Ranking audit incomplete: no audit_date' };
  const { data: rows } = await supabase
    .from('keyword_rankings')
    .select('serp_surface_stack')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate);
  const n = (rows || []).length;
  const missing = (rows || []).filter((r) => r.serp_surface_stack == null).length;
  const pct = n ? missing / n : 1;
  if (pct > 0.1) {
    return { ok: false, message: `Ranking audit incomplete: ${missing} of ${n} missing`, auditDate, missing, n };
  }
  return { ok: true, message: 'Ranking audit complete', auditDate, missing, n };
}

async function freshness(supabase, propertyUrl) {
  const out = {};
  const { data: tx } = await supabase
    .from('booking_sheet_transactions')
    .select('imported_at')
    .eq('property_url', propertyUrl)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  out.booking_sheet = { at: tx?.imported_at || null, fresh_days: 3 };
  return out;
}

export async function buildSectionG(supabase, opts = {}) {
  const propertyUrl = opts.propertyUrl || 'https://www.alanranger.com';
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const parts = monthParts(asOf);
  const gpBundle = await resolveGpTargetsBundle(supabase, propertyUrl, asOf);
  const cfg = { ...DEFAULT_SECTION_G_CONFIG, ...(gpBundle.targets.section_g_config || {}) };
  const survivalGp = Number(gpBundle.targets.survival_gp_monthly) || 3700;
  const derivedSales = gpBundle.derived.survival_sales;
  const salesTarget = derivedSales ?? survivalGp;

  const curSales = await sumSalesExclJlr(supabase, propertyUrl, parts.cur.year, parts.cur.month, { mtdDay: parts.cur.day });
  const prevSales = await sumSalesExclJlr(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const prev2Sales = await sumSalesExclJlr(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const lySales = await sumSalesExclJlr(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month, { mtdDay: parts.cur.day });

  const curGp = await sumGp(supabase, propertyUrl, parts.cur.year, parts.cur.month, { mtdDay: parts.cur.day });
  const prevGp = await sumGp(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const prev2Gp = await sumGp(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const lyGp = await sumGp(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month, { mtdDay: parts.cur.day });

  const salesPace = pace(salesTarget, parts.cur.day, parts.cur.daysIn);
  const gpPace = pace(lyGp, parts.cur.day, parts.cur.daysIn); // target = same month last year GP pace baseline uses full LY month below
  const lyGpFull = await sumGp(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month);
  const gpTargetPace = pace(lyGpFull, parts.cur.day, parts.cur.daysIn);

  const erCur = await existingReferralCount(supabase, propertyUrl, parts.cur.year, parts.cur.month, { mtdDay: parts.cur.day });
  const erPrev = await existingReferralCount(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const erPrev2 = await existingReferralCount(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const erLy = await existingReferralCount(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month, { mtdDay: parts.cur.day });
  const erPace = pace(cfg.existing_referral_monthly, parts.cur.day, parts.cur.daysIn);

  const hmCur = await highMarginShare(supabase, propertyUrl, parts.cur.year, parts.cur.month);
  const hmPrev = await highMarginShare(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const hmPrev2 = await highMarginShare(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);

  const dataCheck = await rankingDataCheck(supabase, propertyUrl);
  const fresh = await freshness(supabase, propertyUrl);

  const rows = [
    {
      group: 'Money',
      id: 'direct_sales',
      label: 'Direct sales excl. JLR',
      cur: curSales,
      curSub: `2025: £${lySales.toLocaleString('en-GB')}`,
      prev: prevSales,
      prev2: prev2Sales,
      target: salesTarget,
      targetSub: `pace now £${Math.round(salesPace || 0).toLocaleString('en-GB')} · ${gpBundle.derived.sales_needed_label}`,
      ...statusPace(curSales, salesPace)
    },
    {
      group: 'Money',
      id: 'gross_profit',
      label: 'Gross profit',
      cur: curGp,
      curSub: `2025: £${lyGp.toLocaleString('en-GB')}`,
      prev: prevGp,
      prev2: prev2Gp,
      target: survivalGp,
      targetSub: `pace now £${Math.round(gpTargetPace || 0).toLocaleString('en-GB')} · Survival GP £${survivalGp.toLocaleString('en-GB')} (S1 £${Number(gpBundle.targets.stretch1_gp_monthly).toLocaleString('en-GB')} / S2 £${Number(gpBundle.targets.stretch2_gp_monthly).toLocaleString('en-GB')})`,
      ...statusPace(curGp, gpTargetPace)
    },
    {
      group: 'Lever 1 — Fill before you run',
      id: 'avg_clients_residential',
      label: 'Average clients per residential',
      cur: null,
      curSub: 'Needs data feed',
      prev: null,
      prev2: null,
      target: cfg.min_clients_residential,
      status: 'Needs data feed',
      spanNote: null
    },
    {
      group: 'Lever 1 — Fill before you run',
      id: 'events_below_min',
      label: 'Events below minimum, next 60 days',
      cur: null,
      prev: null,
      prev2: null,
      target: 0,
      status: 'Needs data feed',
      spanNote: 'Needs Workshops import'
    },
    {
      group: 'Lever 2 — Sell to people who know you',
      id: 'existing_referral',
      label: 'Existing and referral bookings',
      cur: erCur,
      curSub: `2025: ${erLy}`,
      prev: erPrev,
      prev2: erPrev2,
      target: cfg.existing_referral_monthly,
      targetSub: `pace now ${erPace}`,
      ...statusPace(erCur, erPace)
    },
    {
      group: 'Lever 3 — Move hours into high-margin work',
      id: 'high_margin_share',
      label: 'Share of GP from 90%+ margin lines',
      cur: hmCur,
      prev: hmPrev,
      prev2: hmPrev2,
      target: cfg.high_margin_share_pct,
      status: hmCur == null ? '—' : (hmCur >= cfg.high_margin_share_pct ? 'On target' : 'Off target'),
      format: 'pct'
    }
  ];

  const counts = { on_pace: 0, off_pace: 0, too_early: 0 };
  for (const r of rows) {
    if (r.status === 'Needs data feed' || r.status === '—') continue;
    if (r.status === 'Too early') counts.too_early += 1;
    else if (/On /i.test(r.status)) counts.on_pace += 1;
    else counts.off_pace += 1;
  }

  return {
    as_of: parts.asOfYmd,
    periods: {
      cur: parts.cur,
      prev: parts.prev,
      prev2: parts.prev2
    },
    tiles: counts,
    data_check: dataCheck,
    freshness: fresh,
    booking_sheet_uploaded: fresh.booking_sheet?.at || null,
    gp_bundle: {
      survival_gp: survivalGp,
      stretch1: Number(gpBundle.targets.stretch1_gp_monthly),
      stretch2: Number(gpBundle.targets.stretch2_gp_monthly),
      derived_sales: derivedSales,
      margin_pct: gpBundle.derived.margin_pct
    },
    rows,
    config: cfg,
    source: 'live'
  };
}

export function renderSectionGHtml(sectionG) {
  if (!sectionG || sectionG.error) {
    return `<tr><td style="padding:16px 28px;color:#667085;font-family:Figtree,Helvetica,Arial,sans-serif;">G · Profit levers — unavailable${sectionG?.error ? `: ${esc(sectionG.error)}` : ''}</td></tr>`;
  }
  const FF = 'font-family:Figtree,Helvetica,Arial,sans-serif;';
  const curL = sectionG.periods.cur.label;
  const pL = sectionG.periods.prev.label;
  const p2L = sectionG.periods.prev2.label;
  const tiles = sectionG.tiles || {};
  const dc = sectionG.data_check || {};
  const dcColor = dc.ok ? '#2e7d32' : '#b3261e';

  const tile = (label, n, color) =>
    `<td style="width:22%;background:#fff;border:1px solid #eee3d0;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:${color};${FF}">${n ?? 0}</div>
      <div style="font-size:11px;color:#5b524a;${FF}">${label}</div>
    </td>`;

  let lastGroup = null;
  const body = (sectionG.rows || []).map((r) => {
    let groupRow = '';
    if (r.group !== lastGroup) {
      lastGroup = r.group;
      groupRow = `<tr><td colspan="6" style="background:#f1e6d2;color:#8a4300;font-weight:700;padding:8px 10px;${FF}">${esc(r.group)}</td></tr>`;
    }
    const fmt = (v) => {
      if (v == null) return '—';
      if (r.format === 'pct') return `${v}%`;
      if (typeof v === 'number' && /sales|profit|Direct|Gross/i.test(r.label)) return `£${Number(v).toLocaleString('en-GB')}`;
      return String(v);
    };
    const statusColor = /On /i.test(r.status || '') ? '#2e7d32' : /Off|Needs/i.test(r.status || '') ? '#b3261e' : '#5b524a';
    const curCell = r.spanNote
      ? `<td colspan="3" style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(r.spanNote)}</td>`
      : `<td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.cur))}${r.curSub ? `<div style="color:#8a837a;font-size:11px;">${esc(r.curSub)}</div>` : ''}</td>
         <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.prev))}</td>
         <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.prev2))}</td>`;
    return `${groupRow}<tr>
      <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(r.label)}</td>
      ${curCell}
      <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.target))}${r.targetSub ? `<div style="color:#8a837a;font-size:11px;">${esc(r.targetSub)}</div>` : ''}</td>
      <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;color:${statusColor};font-weight:700;${FF}">${esc(r.status || '—')}</td>
    </tr>`;
  }).join('');

  return `
  <tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #e8853d;padding-left:10px;color:#111827;font-size:15px;font-weight:700;${FF}">G · Profit levers scorecard</div>
  <div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Calendar months · live from Booking Sheet / GSC / GA4 · Survival GP £${esc(String(sectionG.gp_bundle?.survival_gp || 3700))}</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${tile('On pace', tiles.on_pace, '#2e7d32')}
      <td style="width:4%;"></td>
      ${tile('Off pace', tiles.off_pace, '#b3261e')}
      <td style="width:4%;"></td>
      ${tile('Too early', tiles.too_early, '#5b524a')}
      <td style="width:4%;"></td>
      <td style="width:34%;background:#fff;border:1px solid #eee3d0;border-radius:8px;padding:10px;">
        <div style="font-size:12px;font-weight:700;color:${dcColor};${FF}">${esc(dc.message || 'Data check')}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:12px 28px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;${FF}">
      <tr>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">Measure</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">${esc(curL)} so far</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">${esc(pL)}</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">${esc(p2L)}</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">Target</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">Status</th>
      </tr>
      ${body}
    </table>
    <div style="color:#667085;font-size:11px;padding:8px 0;${FF}">
      Booking sheet uploaded ${esc(sectionG.booking_sheet_uploaded || '—')}.
      Pace now = monthly target × days elapsed / days in month.
      Direct sales target = derived sales for Survival GP (not typed).
    </div>
  </td></tr>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
