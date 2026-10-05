/**
 * POST /api/aigeo/admin-ensure-business-targets
 * One-shot DDL+seed for business_targets + workshop attendees.
 * Auth: header x-arp-admin-key = ARP_ADMIN_KEY
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';

export const config = { runtime: 'nodejs' };

function authOk(req) {
  const key = process.env.ARP_ADMIN_KEY || '';
  const got = req.headers['x-arp-admin-key'] || req.query?.key || '';
  return key && got && key === got;
}

function connString() {
  const pass = process.env.SUPABASE_DB_PASSWORD;
  const url = process.env.SUPABASE_URL;
  if (!pass || !url) throw new Error('SUPABASE_DB_PASSWORD or SUPABASE_URL missing');
  const ref = new URL(url).hostname.split('.')[0];
  return `postgresql://postgres.${ref}:${encodeURIComponent(pass)}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!authOk(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const sqlPath = path.join(process.cwd(), 'migrations', '20261005_business_targets_gp_tiers.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const client = new pg.Client({
      connectionString: connString(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20000
    });
    await client.connect();
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT survival_gp_monthly, stretch1_gp_monthly, stretch2_gp_monthly, effective_from
       FROM business_targets WHERE property_url='https://www.alanranger.com'
       ORDER BY effective_from DESC LIMIT 1`
    );
    await client.end();
    res.status(200).json({ ok: true, business_targets: rows[0] || null });
  } catch (err) {
    console.error('[admin-ensure-business-targets]', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
