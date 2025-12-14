/**
 * Read-only helpers for turning Domain Strength snapshots into Actions rows.
 *
 * NOTE: This module must NOT call DataForSEO.
 */

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeDomain(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    if (raw.includes("://")) return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    // ignore
  }
  return raw.replace(/^www\./, "").split("/")[0];
}

function num(x) {
  const n = typeof x === "number" ? x : Number.parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
}

/**
 * @typedef {Object} DomainStrengthSummary
 * @property {string} domain
 * @property {string|null} label
 * @property {string|null} segment
 * @property {number|null} score
 * @property {string|null} band
 */

/**
 * @typedef {Object} AuthorityAction
 * @property {string} id
 * @property {"domain"} level
 * @property {"authority"} type
 * @property {string} domain
 * @property {string} segment
 * @property {string} title
 * @property {string} description
 * @property {"High"|"Medium"|"Low"} priority
 * @property {"High"|"Medium"|"Low"} impact
 * @property {"High"|"Medium"|"Low"} difficulty
 * @property {{ domainStrengthScore: number|null, domainStrengthBand: string|null }} metrics
 */

function mapBandToPriorityAndImpact(band) {
  switch (band) {
    case "Very weak":
    case "Weak":
      return { priority: "High", impact: "High" };
    case "Moderate":
      return { priority: "Medium", impact: "Medium" };
    case "Strong":
    case "Very strong":
    default:
      return { priority: "Low", impact: "Low" };
  }
}

async function fetchCompetitorMeta(supabaseUrl, supabaseKey) {
  // Optional metadata (graceful): competitor_domains table may not exist.
  try {
    const competitorUrl =
      `${supabaseUrl}/rest/v1/competitor_domains` + `?select=domain,label,segment,is_active&limit=2000`;
    const resp = await fetch(competitorUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!resp.ok) return new Map();
    const rows = await resp.json();
    const active = Array.isArray(rows) ? rows.filter((c) => c && c.is_active) : [];

    return new Map(
      active
        .map((c) => {
          const d = normalizeDomain(c.domain);
          if (!d) return null;
          return [d, { label: c.label || d, segment: c.segment || null }];
        })
        .filter(Boolean)
    );
  } catch {
    return new Map();
  }
}

function getPrimaryDomain() {
  return normalizeDomain(process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || "alanranger.com");
}

/**
 * Fetch latest Domain Strength snapshot per domain.
 *
 * Read-only: Supabase reads only.
 *
 * @returns {Promise<DomainStrengthSummary[]>}
 */
export async function getDomainStrengthSummariesForActions() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const primaryDomain = getPrimaryDomain();
  const startDate = isoDateDaysAgo(548); // ~18 months

  // Sort by domain asc, snapshot_date desc; then take first row per domain.
  const queryUrl =
    `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
    `?engine=eq.google` +
    `&snapshot_date=gte.${startDate}` +
    `&select=domain,snapshot_date,score,band` +
    `&order=domain.asc&order=snapshot_date.desc` +
    `&limit=10000`;

  const resp = await fetch(queryUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(errorText || `Failed to fetch domain strength snapshots (HTTP ${resp.status})`);
  }

  const rows = await resp.json();
  const list = Array.isArray(rows) ? rows : [];

  const metaByDomain = await fetchCompetitorMeta(supabaseUrl, supabaseKey);

  const out = [];
  const seen = new Set();
  for (const r of list) {
    const domain = normalizeDomain(r?.domain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);

    const score = num(r?.score);
    const band = typeof r?.band === "string" ? r.band : null;

    const meta =
      metaByDomain.get(domain) ||
      (domain === primaryDomain
        ? { label: "Alan Ranger Photography", segment: "Your site" }
        : { label: domain, segment: null });

    out.push({
      domain,
      label: meta.label || null,
      segment: meta.segment || null,
      score,
      band: band || null,
    });
  }

  return out;
}

/**
 * Build domain-level authority actions from domain strength summaries.
 *
 * @param {DomainStrengthSummary[]} summaries
 * @returns {AuthorityAction[]}
 */
export function buildAuthorityActionsFromDomainStrength(summaries) {
  const primaryDomain = getPrimaryDomain();

  return (Array.isArray(summaries) ? summaries : [])
    .filter((s) => typeof s?.score === "number")
    // v1: only create actions for your own site (tracked primary domain)
    .filter((s) => normalizeDomain(s.domain) === primaryDomain || s.segment === "Your site")
    .map((s) => {
      const { priority, impact } = mapBandToPriorityAndImpact(s.band ?? null);
      const segment = s.segment || "Domain";

      return {
        id: `domain-strength:${s.domain}`,
        level: "domain",
        type: "authority",
        domain: s.domain,
        segment,
        title: "Build domain authority",
        description: `Domain strength for ${s.label || s.domain} is ${s.score?.toFixed(1) ?? "?"}/100 (${s.band || "no band"}). Focus on authority-building work: high-quality backlinks, citations, and mentions on relevant photography / education sites.`,
        priority,
        impact,
        difficulty: "High",
        metrics: {
          domainStrengthScore: s.score,
          domainStrengthBand: s.band,
        },
      };
    });
}
