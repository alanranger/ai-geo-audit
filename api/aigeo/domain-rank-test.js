/**
 * DataForSEO Backlinks "domain rank" test endpoint
 *
 * GET /api/aigeo/domain-rank-test?domain=alanranger.com
 */

import { fetchDomainBacklinkSummary, fetchDomainBacklinkSummaryDebug } from "./dataforseo-client.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed. Use GET.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const domain = (req.query.domain && String(req.query.domain)) || "alanranger.com";
  const debugMode = String(req.query.debug || "").trim() === "1";
  const result = debugMode
    ? await fetchDomainBacklinkSummaryDebug(domain)
    : { data: await fetchDomainBacklinkSummary(domain), error: null };

  return res.status(200).json({
    status: "ok",
    domain,
    data: result.data,
    ...(debugMode ? { debug: { error: result.error } } : {}),
    meta: { generatedAt: new Date().toISOString() },
  });
}

