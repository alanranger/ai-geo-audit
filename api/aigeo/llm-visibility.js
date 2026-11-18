/**
 * GET standalone LLM / ChatGPT visibility snapshots (not Google AIO).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { createClient } from '@supabase/supabase-js';
import { pictureFrom, engineLine, engineRows, ENGINE_KEYS } from '../../lib/acquisition/ai-picture.js';

const PROPERTY = 'https://www.alanranger.com';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return send(res, 500, { error: 'supabase_not_configured' });

    const propertyUrl = String(req.query?.propertyUrl || PROPERTY).trim();
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from('llm_visibility_snapshots')
      .select('id, run_at, cadence, domain_mentions, historical, aggregated, prompt_results, topic_competitors, cost_usd, meta')
      .eq('property_url', propertyUrl)
      .order('run_at', { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);

    const latest = data?.[0] || null;
    const prompts = Array.isArray(latest?.prompt_results) ? latest.prompt_results : [];
    const named = prompts.filter((p) => p?.named === true).length;
    const picture = pictureFrom(data || []);
    const engine_tiles = ENGINE_KEYS.map((key) => ({ key, ...engineLine(picture.engines?.[key]) }));

    return send(res, 200, {
      surface: 'standalone_llm',
      label: 'ChatGPT / LLM answers',
      not_google_aio: true,
      latest,
      engine_tiles,
      engine_rows: engineRows(picture),
      break_note: picture.breakNote || '',
      cluster_rows: picture.clusterRows || [],
      history: (data || []).map((r) => ({
        id: r.id,
        run_at: r.run_at,
        named_of_prompts: r.meta?.named_of_prompts || null,
        prompt_bank_version: r.meta?.prompt_bank_version ?? null,
        engines: r.meta?.engines ? Object.fromEntries(['chat_gpt', 'gemini', 'perplexity', 'claude'].map((k) => [k, r.meta.engines[k] ? { ok: r.meta.engines[k].ok, named: r.meta.engines[k].named, of: r.meta.engines[k].of, sometimes: r.meta.engines[k].sometimes || 0 } : null])) : null,
        mentions: r.domain_mentions?.items_count ?? null,
        cost_usd: r.cost_usd,
      })),
      summary: latest ? {
        run_at: latest.run_at,
        mentions: latest.domain_mentions?.items_count ?? null,
        citation_sample_count: latest.domain_mentions?.citation_sample_count ?? null,
        citation_to_mention_ratio: latest.domain_mentions?.citation_to_mention_ratio ?? null,
        prompts_named: named,
        prompts_total: prompts.length,
        cost_usd: latest.cost_usd,
      } : null,
    });
  } catch (err) {
    return send(res, 500, { error: String(err?.message || err) });
  }
}
