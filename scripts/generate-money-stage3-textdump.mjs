/**
 * Stage 3 acceptance: textdump of commercial Money tab rows with intel columns.
 * Usage: node scripts/generate-money-stage3-textdump.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  enrichMoneyPageRow,
  buildKeywordRowLookup,
  loadLocked151Keywords,
  pathOnly
} from '../lib/audit/moneyPageRowIntel.js';
import { moneyRoleForUrl } from '../lib/audit/moneyPageRoles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const propertyUrl = 'https://www.alanranger.com';

const { data: overrides, error: ovErr } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('page_url,target_keyword,target_class,notes')
  .eq('property_url', propertyUrl);
if (ovErr) throw ovErr;

const { data: audits } = await sb
  .from('audit_results')
  .select('audit_date,scores')
  .eq('property_url', propertyUrl)
  .order('audit_date', { ascending: false })
  .limit(1);

let auditDate = audits?.[0]?.audit_date;
let rows = audits?.[0]?.scores?.moneyPagesMetrics?.rows || [];

if (!auditDate) {
  const { data: krDates } = await sb
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1);
  auditDate = krDates?.[0]?.audit_date;
}

if (!rows.length) {
  const masterPath = path.join(root, 'scripts/output/target-keyword-master-35.json');
  const master = JSON.parse(readFileSync(masterPath, 'utf8'));
  rows = master
    .filter((m) => {
      const sub = 'landing';
      const role = moneyRoleForUrl(m.url, sub);
      return role === 'commercial' || role === 'cannibal';
    })
    .map((m) => ({ url: m.url, subSegment: 'LANDING', moneyRole: moneyRoleForUrl(m.url, 'landing'), clicks: 0, impressions: 0 }));
}

if (!auditDate) {
  console.error('No audit_date found — run an audit first.');
  process.exit(1);
}

const { data: krRows, error: krErr } = await sb
  .from('keyword_rankings')
  .select('keyword,best_url,has_ai_overview,ai_overview_present_any,serp_surface_stack')
  .eq('property_url', propertyUrl)
  .eq('audit_date', auditDate);
if (krErr) throw krErr;

const lockedCsv = readFileSync(
  path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv'),
  'utf8'
);
const locked151 = loadLocked151Keywords(lockedCsv);
const byKw = buildKeywordRowLookup(krRows);

const overrideByPath = new Map();
for (const o of overrides || []) {
  const p = pathOnly(o.page_url);
  overrideByPath.set(p, o);
}

function classifySub(url) {
  const p = pathOnly(url);
  if (/\/products?\/|gift-voucher|special-offer/i.test(p)) return 'product';
  if (/\/events?\//i.test(p)) return 'event';
  return 'landing';
}

const commercial = [];
for (const row of rows) {
  const sub = String(row.subSegment || classifySub(row.url)).toLowerCase();
  const role = row.moneyRole || moneyRoleForUrl(row.url, sub === 'product' ? 'product' : sub === 'event' ? 'event' : 'landing');
  if (role !== 'commercial' && role !== 'cannibal') continue;
  const meta = overrideByPath.get(pathOnly(row.url)) || {};
  const kwKey = String(meta.target_keyword || '').trim().toLowerCase();
  const enriched = enrichMoneyPageRow(row, meta, kwKey ? byKw.get(kwKey) : null, locked151);
  commercial.push(enriched);
}

commercial.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));

const header = 'URL | Target kw | Fight type | Cannibal flag | Clicks | Impr';
const lines = [header, '---'];
for (const r of commercial) {
  lines.push([
    pathOnly(r.url),
    r.targetKeyword || '(cleared)',
    r.fightType || '—',
    r.cannibalFlag || '',
    r.clicks || 0,
    r.impressions || 0
  ].join(' | '));
}

const body = `${lines.join('\n')}\n`;
const outScript = path.join(root, 'scripts/output/money-stage3-commercial-textdump.txt');
const outDrive = path.join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/money-stage3-commercial-textdump.txt'
);
writeFileSync(outScript, body, 'utf8');
mkdirSync(path.dirname(outDrive), { recursive: true });
writeFileSync(outDrive, body, 'utf8');
console.log(`wrote ${commercial.length} commercial rows (audit ${auditDate})`);
console.log(outScript);
console.log('\n' + body);
