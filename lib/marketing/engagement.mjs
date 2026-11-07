/**
 * Email engagement bands (Release 2). Opens and clicks are separate signals, dated by the campaign send date.
 *   warm      last signal 0–warm_days (default 90) days ago, inclusive
 *   cooling   > warm_days through cooling_days (default 180), inclusive
 *   cold      > cooling_days
 *   none_recorded  delivered campaigns in complete tracked history, but no signal of that kind
 *   insufficient   fewer than MIN_EXPOSURE tracked deliveries (too little to judge)
 *   unknown   no tracked deliveries, or tracked history isn't complete yet — never treated as cold / never opened
 * An open is a recorded signal, not proof the email was read.
 */
export const DEFAULT_WINDOWS = { warm_days: 90, cooling_days: 180 };
export const MIN_EXPOSURE = 3;

const daysSince = (iso, today) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(iso)) / 86400000);

export function band(lastIso, e, coverageComplete, windows = DEFAULT_WINDOWS, today = new Date().toISOString().slice(0, 10)) {
  if (!e || !e.delivered_campaigns) return 'unknown';
  if (lastIso) {
    const d = daysSince(lastIso, today);
    if (d <= windows.warm_days) return 'warm';
    if (d <= windows.cooling_days) return coverageComplete ? 'cooling' : 'cooling_partial';
    return coverageComplete ? 'cold' : 'unknown';
  }
  if (e.delivered_campaigns < MIN_EXPOSURE) return 'insufficient';
  return coverageComplete ? 'none_recorded' : 'unknown';
}

export function engagementView(e, coverageComplete, windows, today) {
  return {
    open: band(e?.last_open_campaign_at, e, coverageComplete, windows, today),
    click: band(e?.last_click_campaign_at, e, coverageComplete, windows, today),
    delivered: e?.delivered_campaigns || 0, opened: e?.opened_campaigns || 0, clicked: e?.clicked_campaigns || 0,
    last5: e ? `${e.last5_opened}/${e.last5_delivered} opened, ${e.last5_clicked}/${e.last5_delivered} clicked` : null,
    last_delivered_at: e?.last_delivered_at || null
  };
}
