// reset-auto-scenarios.mjs
//
// Re-pushes the canonical tier+lever weights to the three saved
// Auto: scenarios so any manual edits or drift from earlier session
// activity are reverted. Used to keep the dropdown's Easy/Balanced/
// Hard scenarios in a known-good state for repeated testing.

const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';

const CANONICAL = {
  'Auto: Easy path (quick wins)': {
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 2.0, schema: 1.5, aio: 0.5, rank: 0.2, surfacing: 0.5, conversion: 1.0 }
  },
  'Auto: Balanced path (most £ this month)': {
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 1.2, schema: 1.0, aio: 1.5, rank: 1.0, surfacing: 1.0, conversion: 1.2 }
  },
  'Auto: Hard path (full-commit compound)': {
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 1.0, schema: 1.0, aio: 1.5, rank: 1.5, surfacing: 1.2, conversion: 1.0 }
  }
};

function wrap(raw) {
  const out = {};
  for (const k of Object.keys(raw)) out[k] = { strategic_weight: Number(raw[k]) };
  return out;
}

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function main() {
  const list = await getJson(`${BASE}/api/aigeo/revenue-funnel-scenarios?propertyUrl=${encodeURIComponent(PROPERTY)}`);
  const scenarios = list.scenarios || [];
  for (const name of Object.keys(CANONICAL)) {
    const s = scenarios.find(x => x.name === name);
    if (!s) { console.log('SKIP (not found):', name); continue; }
    const c = CANONICAL[name];
    const body = {
      scenarioId: s.id, propertyUrl: PROPERTY,
      tier_weights:  wrap(c.tier),
      lever_weights: wrap(c.lever)
    };
    const r = await fetch(`${BASE}/api/aigeo/revenue-funnel-config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    console.log((r.ok ? 'OK    ' : 'FAIL  ') + name);
  }
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
