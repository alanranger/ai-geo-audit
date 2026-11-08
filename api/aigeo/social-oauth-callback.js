/**
 * Meta OAuth redirect target (Facebook Login for Business) for "Connect Facebook & Instagram".
 * Register exactly this URL as the Valid OAuth Redirect URI in the Meta app:
 *   https://ai-geo-audit.vercel.app/api/aigeo/social-oauth-callback
 * Protected by the one-use `state` from POST /api/aigeo/social {action:'connect-start'} (admin key, 10 minutes).
 * Always answers with a redirect to the Marketing tab carrying only ok / a reason code: never a token.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { supabaseAdmin, supabaseRepo } from '../../lib/social/repo.mjs';
import { handleCallback, redirectFor } from '../../lib/social/oauth.mjs';

export function makeCallbackHandler(deps) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const repo = req.method === 'GET' ? deps.repo() : null;
    const location = repo
      ? await handleCallback({ query: req.query || {}, repo, env: deps.env, fetchImpl: deps.fetchImpl, now: deps.now() })
      : redirectFor(req.method === 'GET' ? 'server_not_ready' : 'bad_request');
    res.setHeader('Location', location);
    return res.status(302).send('');
  };
}

export default makeCallbackHandler({
  repo: () => { const sb = supabaseAdmin(); return sb ? supabaseRepo(sb) : null; },
  env: process.env,
  fetchImpl: (...a) => fetch(...a),
  now: () => Date.now()
});
