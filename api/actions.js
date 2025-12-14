/**
 * Actions endpoint (read-only).
 *
 * v1: emits domain-level "authority" actions derived from domain_strength_snapshots.
 *
 * GET /api/actions
 */

import {
  buildAuthorityActionsFromDomainStrength,
  getDomainStrengthSummariesForActions,
} from "../lib/domainStrength/getDomainStrengthForActions.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed. Use GET.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  try {
    const summaries = await getDomainStrengthSummariesForActions();
    const authorityActions = buildAuthorityActionsFromDomainStrength(summaries);

    return res.status(200).json({
      status: "ok",
      actions: authorityActions,
      meta: { generatedAt: new Date().toISOString(), source: "domain_strength_snapshots" },
    });
  } catch (e) {
    return res.status(500).json({
      status: "error",
      message: "Failed to build actions",
      details: e?.message || String(e),
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}
