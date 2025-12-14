/**
 * DataForSEO Labs: domain_rank_overview (Google)
 * Best-effort fetch + parsing helper for Domain Strength scoring.
 */

function getAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  const auth = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${auth}`;
}

function normalizeDomain(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.replace(/^www\./, "");
    }
  } catch {
    // ignore parse errors
  }
  return raw.replace(/^www\./, "");
}

export async function fetchLabsDomainRankOverview(domain, opts = {}) {
  const d = normalizeDomain(domain);
  if (!d) return { ok: false, error: "Missing domain", raw: null, data: null };

  const authHeader = getAuthHeader();
  if (!authHeader) {
    return {
      ok: false,
      error: "DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars are missing",
      raw: null,
      data: null,
    };
  }

  const requestBody = [
    {
      target: d,
      se_type: "google",
      location_code: 2826,
      offset: 0,
      limit: 100,
      ignore_synonyms: false,
    },
  ];

  try {
    const resp = await fetch(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const json = await resp.json();
    if (!resp.ok || json?.status_code !== 20000) {
      return {
        ok: false,
        error: json?.status_message || `Labs error (HTTP ${resp.status})`,
        raw: opts.includeRaw ? json : null,
        data: null,
      };
    }

    const task = json?.tasks?.[0] ?? null;
    if (task?.status_code && !(task.status_code === 20000 || String(task.status_code).startsWith("200"))) {
      return {
        ok: false,
        error: task.status_message || `Task failed (status_code ${task.status_code})`,
        raw: opts.includeRaw ? json : null,
        data: null,
      };
    }

    const result = task?.result?.[0] ?? null;
    const item = result?.items?.[0] ?? null;
    const organic = item?.metrics?.organic ?? null;
    if (!organic) {
      return {
        ok: false,
        error: "No organic metrics returned",
        raw: opts.includeRaw ? json : null,
        data: null,
      };
    }

    const pos1 = organic.pos_1 ?? 0;
    const pos23 = organic.pos_2_3 ?? 0;
    const pos410 = organic.pos_4_10 ?? 0;
    const top3 = pos1 + pos23;
    const top10 = top3 + pos410;

    return {
      ok: true,
      error: null,
      raw: opts.includeRaw ? json : null,
      data: {
        domain: d,
        se_type: item?.se_type || "google",
        location_code: item?.location_code ?? 2826,
        language_code: item?.language_code ?? "en",
        etv: organic.etv ?? 0,
        keywordsTotal: organic.count ?? 0,
        top3,
        top10,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      raw: null,
      data: null,
    };
  }
}

/**
 * Batch variant: one request, many domains.
 * Returns one result per domain (ok/error/data).
 */
export async function fetchLabsDomainRankOverviewBatch(domains, opts = {}) {
  const authHeader = getAuthHeader();
  if (!authHeader) {
    return {
      ok: false,
      error: "DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars are missing",
      raw: null,
      data: [],
    };
  }

  const normalized = (Array.isArray(domains) ? domains : []).map(normalizeDomain).filter(Boolean);

  if (normalized.length === 0) {
    return { ok: false, error: "No domains provided", raw: null, data: [] };
  }

  // Deduplicate but keep stable order
  const seen = new Set();
  const unique = [];
  for (const d of normalized) {
    if (seen.has(d)) continue;
    seen.add(d);
    unique.push(d);
  }

  /**
   * NOTE:
   * This endpoint can be plan-limited to a single task per request ("You can set only one task at a time.").
   * To keep behavior consistent across plans, we do one request per domain.
   */
  const out = [];
  for (const d of unique) {
    // Reuse single-domain helper (it handles auth + parsing)
    // eslint-disable-next-line no-await-in-loop
    const r = await fetchLabsDomainRankOverview(d, { includeRaw: opts.includeRaw });
    out.push({
      domain: d,
      ok: Boolean(r?.ok),
      error: r?.error || null,
      data: r?.data || null,
    });
  }

  return { ok: true, error: null, raw: null, data: out };
}

