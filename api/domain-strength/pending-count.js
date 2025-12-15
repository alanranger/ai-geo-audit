/**
 * Get count of pending domains in queue
 * 
 * GET /api/domain-strength/pending-count
 * Query params: ?engine=google (optional, default: google)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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
    const engine = req.query.engine || "google";

    if (!supabase) {
      return res.status(200).json({
        status: "ok",
        count: 0,
        engine,
        meta: { generatedAt: new Date().toISOString(), missingSupabase: true },
      });
    }

    const { count, error } = await supabase
      .from('domain_rank_pending')
      .select('*', { count: 'exact', head: true })
      .eq('search_engine', engine);

    if (error) {
      console.error('[pending-count] Error fetching count:', error);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch pending count",
        details: error.message,
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    return res.status(200).json({
      status: "ok",
      count: count || 0,
      engine,
      meta: { generatedAt: new Date().toISOString(), source: "domain_rank_pending" },
    });
  } catch (e) {
    return res.status(500).json({
      status: "error",
      message: e?.message || String(e),
      meta: { generatedAt: new Date().toISOString(), source: "domain-strength.pending-count", unexpected: true },
    });
  }
}

