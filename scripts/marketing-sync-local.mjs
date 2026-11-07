/**
 * Run the Marketing sync steps locally (same code as the cron). Prints counts only.
 *   node --env-file=.env.local scripts/marketing-sync-local.mjs [profiles,orders,postcodes,customers]
 */
import { rebuildCustomers } from '../lib/marketing/rebuild.mjs';
import { serviceClient } from '../lib/marketing/store.mjs';
import { syncOrders, syncPostcodes, syncProfiles } from '../lib/marketing/sync.mjs';

const STEPS = { profiles: syncProfiles, orders: syncOrders, postcodes: (sb) => syncPostcodes(sb, { limit: 5000 }), customers: rebuildCustomers };
const wanted = (process.argv[2] || Object.keys(STEPS).join(',')).split(',');
const sb = serviceClient();
for (const step of wanted) {
  const t0 = Date.now();
  const out = await STEPS[step](sb);
  console.log(step, `${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(out));
}
