/**
 * Score Surface/Top from production get-keyword-rankings, print SQL-ready values.
 *   node scripts/score-dials-from-prod.mjs --date=2026-10-05
 */
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';

const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : '2026-10-05';

const url = `${BASE}/api/supabase/get-keyword-rankings?propertyUrl=${encodeURIComponent(PROPERTY)}&auditDate=${encodeURIComponent(auditDate)}`;
const r = await fetch(url);
if (!r.ok) throw new Error(`fetch ${r.status}: ${(await r.text()).slice(0, 300)}`);
const j = await r.json();
const rows = j?.data || j?.rows || j?.keyword_rankings || j?.keywords || [];
const list = Array.isArray(rows) ? rows : [];
console.log('rows', list.length);
const surface = Math.round(Number(computeSurfaceVisibilityRollup(list).overall) || 0);
const top = Math.round(Number(computeTopOfPageRollup(list).overall) || 0);
const nullStack = list.filter((x) => !x.serp_surface_stack || (Array.isArray(x.serp_surface_stack) && !x.serp_surface_stack.length)).length;
console.log(JSON.stringify({ auditDate, measured: list.length, nullStack, surface, top }, null, 2));
