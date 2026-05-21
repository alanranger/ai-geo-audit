// Trust-loop data: recent page edits, per-cycle GSC deltas, stale GSC queue.

function normPath(url) {
  if (!url) return '';
  let s = String(url).trim().replace(/^https?:\/\//, '');
  if (s.startsWith('www.')) s = s.slice(4);
  return '/' + s.split('/').slice(1).join('/').replace(/\/$/, '') || '/';
}

function fullUrl(propertyUrl, path) {
  const base = String(propertyUrl || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

export async function fetchRecentPageEdits(supabase, propertyUrl, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let host = 'alanranger.com';
  try { host = new URL(propertyUrl).hostname.replace(/^www\./, ''); } catch (_) { /* default */ }
  const { data, error } = await supabase
    .from('page_html')
    .select('url, updated_at')
    .ilike('url', '%' + host + '%')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data || []).map(r => ({
    page_url: r.url,
    path: normPath(r.url),
    fetched_at: r.updated_at,
    title: null
  }));
}

async function latestGscByPath(supabase, propertyUrl) {
  const { data: latestRow } = await supabase
    .from('gsc_page_metrics_28d')
    .select('date_end')
    .eq('site_url', propertyUrl)
    .order('date_end', { ascending: false })
    .limit(1);
  const dateEnd = latestRow && latestRow[0] ? latestRow[0].date_end : null;
  if (!dateEnd) return new Map();
  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d, ctr_28d, position_28d')
    .eq('site_url', propertyUrl)
    .eq('date_end', dateEnd);
  if (error) throw error;
  const map = new Map();
  for (const row of (data || [])) map.set(normPath(row.page_url), row);
  return map;
}

function metricAtEvent(ev, key) {
  const m = ev.metrics || {};
  if (m[key] != null) return Number(m[key]);
  if (key === 'gsc_ctr_28d' && ev.gsc_ctr != null) return Number(ev.gsc_ctr);
  if (key === 'gsc_clicks_28d' && ev.gsc_clicks != null) return Number(ev.gsc_clicks);
  if (key === 'gsc_impressions_28d' && ev.gsc_impressions != null) return Number(ev.gsc_impressions);
  if (key === 'current_rank' && ev.gsc_avg_position != null) return Number(ev.gsc_avg_position);
  return null;
}

export async function fetchCycleGscDeltas(supabase, rawCycles) {
  const cycles = rawCycles || [];
  const taskIds = Array.from(new Set(cycles.map(x => x.task && x.task.id).filter(Boolean)));
  if (!taskIds.length) return {};
  const { data: events, error } = await supabase
    .from('optimisation_task_events')
    .select('task_id, event_at, event_type, is_baseline, metrics, gsc_ctr, gsc_clicks, gsc_impressions, gsc_avg_position')
    .in('task_id', taskIds)
    .eq('event_type', 'measurement')
    .order('event_at', { ascending: true });
  if (error) throw error;
  const eventsByTask = new Map();
  for (const ev of (events || [])) {
    if (!eventsByTask.has(ev.task_id)) eventsByTask.set(ev.task_id, []);
    eventsByTask.get(ev.task_id).push(ev);
  }
  const propertyUrl = 'https://www.alanranger.com';
  const gscNow = await latestGscByPath(supabase, propertyUrl);
  const byUrl = {};
  for (const { cycle, task } of cycles) {
    const path = normPath(task.target_url_clean);
    const taskEvs = eventsByTask.get(task.id) || [];
    const startTs = cycle.start_date ? new Date(cycle.start_date).getTime() : 0;
    let baseEv = taskEvs.find(e => e.is_baseline) || null;
    if (!baseEv) {
      baseEv = taskEvs.find(e => new Date(e.event_at).getTime() >= startTs) || taskEvs[0];
    }
    const cur = gscNow.get(path);
    if (!path || !baseEv || !cur) continue;
    const ctr0 = metricAtEvent(baseEv, 'gsc_ctr_28d');
    const ctr1 = Number(cur.ctr_28d);
    const clk0 = metricAtEvent(baseEv, 'gsc_clicks_28d');
    const clk1 = Number(cur.clicks_28d);
    const pos0 = metricAtEvent(baseEv, 'current_rank');
    const pos1 = Number(cur.position_28d);
    const startTs = cycle.start_date ? new Date(cycle.start_date).getTime() : null;
    const daysRunning = startTs ? Math.round((Date.now() - startTs) / 86400000) : null;
    const ctrPp = (ctr0 != null && ctr1 != null) ? Math.round((ctr1 - ctr0) * 1000) / 10 : null;
    const delta = {
      ctr_delta_pp: ctrPp,
      clicks_delta: (clk0 != null && clk1 != null) ? Math.round(clk1 - clk0) : null,
      position_delta: (pos0 != null && pos1 != null) ? Math.round((pos1 - pos0) * 10) / 10 : null,
      days_running: daysRunning,
      cycle_no: cycle.cycle_no,
      improved: (ctrPp != null && ctrPp > 0) || (clk1 != null && clk0 != null && clk1 > clk0)
    };
    byUrl[path] = delta;
  }
  return byUrl;
}

export async function findUrlsNeedingGscRefresh(supabase, propertyUrl, recentEdits) {
  if (!recentEdits.length) return [];
  const paths = recentEdits.map(e => e.path);
  const { data: tasks } = await supabase
    .from('optimisation_tasks')
    .select('id, target_url_clean')
    .not('status', 'in', '(done,cancelled,deleted)');
  const taskByPath = new Map();
  for (const t of (tasks || [])) taskByPath.set(normPath(t.target_url_clean), t.id);
  const taskIds = Array.from(new Set(paths.map(p => taskByPath.get(p)).filter(Boolean)));
  if (!taskIds.length) return [];
  const { data: events } = await supabase
    .from('optimisation_task_events')
    .select('task_id, event_at')
    .in('task_id', taskIds)
    .order('event_at', { ascending: false });
  const lastEventByTask = new Map();
  for (const ev of (events || [])) {
    if (!lastEventByTask.has(ev.task_id)) lastEventByTask.set(ev.task_id, ev.event_at);
  }
  const out = [];
  for (const edit of recentEdits) {
    const tid = taskByPath.get(edit.path);
    const lastEv = tid ? lastEventByTask.get(tid) : null;
    if (!lastEv || new Date(edit.fetched_at) > new Date(lastEv)) {
      out.push(fullUrl(propertyUrl, edit.path));
    }
  }
  return out;
}

export async function buildTrustLoopPayload(supabase, propertyUrl, cycles) {
  const recent = await fetchRecentPageEdits(supabase, propertyUrl, 14);
  const [gsc_deltas_by_path, urls_needing_gsc_refresh] = await Promise.all([
    fetchCycleGscDeltas(supabase, cycles),
    findUrlsNeedingGscRefresh(supabase, propertyUrl, recent)
  ]);
  return {
    recent_edits: recent,
    gsc_deltas_by_path,
    urls_needing_gsc_refresh
  };
}
