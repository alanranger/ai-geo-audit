/**
 * Audit + store link presence: workshops → near-me for photography holidays uk
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  scanPageForLink,
  linkStatusFromScan,
  toAbsoluteUrl
} from '../lib/configIntegrity/pageLinkAudit.mjs';
import { assignIntegrityFindingIds } from '../lib/configIntegrity/findingIds.mjs';
import { runIntegrityCheck } from '../lib/configIntegrity/runIntegrityCheck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const from = '/photography-workshops';
const to = '/photography-workshops-near-me';
const kw = 'photography holidays uk';
const now = new Date().toISOString();

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const abs = toAbsoluteUrl(from);
const resp = await fetch(abs, {
  headers: {
    'User-Agent': 'AlanRangerSEO-PageAudit/1.0',
    Accept: 'text/html'
  }
});
const html = await resp.text();
const scan = scanPageForLink(html, to, kw);
const link_status = linkStatusFromScan(scan);
console.log({ http: resp.status, link_status, scan });

// loose near-me link samples
const samples = [];
const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  const inner = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/workshops-near-me/i.test(attrs) || /workshops-near-me/i.test(inner)) {
    samples.push({ href: (attrs.match(/href\s*=\s*["']([^"']+)/i) || [])[1], text: inner.slice(0, 100) });
  }
}
console.log('near-me links on workshops page:', samples.slice(0, 20));
console.log(
  'holiday text positions:',
  [...html.matchAll(/holiday[^<]{0,40}/gi)].map((x) => x[0]).slice(0, 15)
);

const [row] = assignIntegrityFindingIds([
  {
    check: 3,
    subject: kw,
    preferred_path: from,
    assigned_path: to
  }
]);

// Discover columns for page_audit
const { data: sample } = await sb.from('config_integrity_page_audit').select('*').limit(1);
const cols = sample?.[0] ? Object.keys(sample[0]) : [];
console.log('page_audit cols', cols);

const i = html.toLowerCase().indexOf('holiday');
if (i >= 0) {
  console.log('context around holiday:\n', html.slice(Math.max(0, i - 250), i + 250));
}

const payload = {
  finding_key: row.findingId,
  property_url: PROPERTY,
  keyword: kw,
  from_path: from,
  to_path: to,
  link_status,
  sample_href: scan.sampleHref || '',
  sample_anchor: scan.sampleAnchor || '',
  anchor_text: scan.sampleAnchor || '',
  link_to_url: scan.sampleHref?.startsWith('http')
    ? scan.sampleHref
    : `${PROPERTY}${scan.sampleHref || to}`,
  checked_at: now,
  target_ok: true,
  detail: 'keep_specialist Alan 11 Aug — multi-day hub; weak anchor Residential Workshops'
};
const { error } = await sb.from('config_integrity_page_audit').upsert(payload, {
  onConflict: 'finding_key'
});
if (error) throw error;
console.log('page_audit saved', row.findingId, link_status);

const result = await runIntegrityCheck({ runSource: 'cli_audit_holidays_uk_link', persist: true });
const withIds = assignIntegrityFindingIds(result.findings || []);
const hit = withIds.find((f) => String(f.subject || '').toLowerCase() === kw);
console.log(
  JSON.stringify(
    {
      hit: hit
        ? {
            id: hit.findingId,
            suggested_action: hit.suggested_action
          }
        : null
    },
    null,
    2
  )
);
