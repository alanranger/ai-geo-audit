/**
 * The only Google Organic and AI Mode request builders.
 * Organic rank uses resolve_poisoned_results. Feature blocks do not.
 * Map pack and AI Overview are not read from the poisoned-results response.
 */

export const ORGANIC_ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
export const AI_MODE_ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced';
export const SERP_METHOD = 'resolve_poisoned_on_2026-11-18';

export function organicTask(fields, resolvePoisoned) {
  return {
    ...fields,
    resolve_poisoned_results: resolvePoisoned === true,
    resolve_goto_urls: false,
  };
}

export function aiModeTask(keyword, locationName) {
  return {
    keyword,
    language_name: 'English',
    location_name: locationName || 'United Kingdom',
    device: 'desktop',
    os: 'windows',
  };
}

export async function postOrganicTasks(auth, tasks) {
  const res = await fetch(ORGANIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth.startsWith('Basic ') ? auth : `Basic ${auth}`,
    },
    body: JSON.stringify(tasks),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export async function postAiMode(auth, keyword, locationName) {
  const res = await fetch(AI_MODE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth.startsWith('Basic ') ? auth : `Basic ${auth}`,
    },
    body: JSON.stringify([aiModeTask(keyword, locationName)]),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}
