/**
 * DataForSEO client helpers (shared across API routes)
 *
 * IMPORTANT:
 * - Do NOT hard-code credentials. Uses env vars DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
 * - Returns null on failure (callers can treat as best-effort).
 */

function getDataForSeoAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return Buffer.from(`${login}:${password}`).toString("base64");
}

async function callDataForSeo(endpointPath, taskArray) {
  const auth = getDataForSeoAuth();
  if (!auth) {
    throw new Error("DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars are missing");
  }

  const endpoint = `https://api.dataforseo.com${endpointPath}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(taskArray),
  });

  const data = await response.json();
  const ok = response.ok && (data?.status_code === 20000 || String(data?.status_code || "").startsWith("200"));
  if (!ok) {
    const msg = data?.status_message || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Fetch domain-level backlink summary (rank 0–100 etc)
 * DataForSEO Backlinks -> summary live
 *
 * @param {string} domain
 * @returns {Promise<null|{domain:string,rank:number|null,backlinks:number|null,referringDomains:number|null,backlinksSpamScore:number|null,crawledPages:number|null}>}
 */
export async function fetchDomainBacklinkSummary(domain) {
  const d = String(domain || "").trim();
  if (!d) return null;

  try {
    // Backlinks summary expects an array of task objects
    const task = {
      target: d,
      backlinks_status_type: "live",
      include_subdomains: true,
      exclude_internal_backlinks: true,
      include_indirect_links: true,
      rank_scale: "one_hundred",
      internal_list_limit: 10,
    };

    const response = await callDataForSeo("/v3/backlinks/summary/live", [task]);

    const result =
      response?.tasks?.[0]?.result?.[0]?.items?.[0] ??
      response?.result?.[0]?.items?.[0] ??
      null;

    if (!result) return null;

    return {
      domain: d,
      rank: result.rank ?? null,
      backlinks: result.backlinks ?? null,
      referringDomains: result.referring_domains ?? null,
      backlinksSpamScore: result.backlinks_spam_score ?? null,
      crawledPages: result.crawled_pages ?? null,
    };
  } catch (err) {
    console.error("[domain-rank] DataForSEO error:", err?.message || err);
    return null;
  }
}

