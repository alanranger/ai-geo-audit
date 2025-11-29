// scripts/sync-site-urls.js
//
// Auto-sync 06-site-urls.csv from alan-shared-resources to alanranger-schema.
// Safe, overwrite-only, no side-effects.

const fs = require("fs");
const path = require("path");

console.log("🔄 Starting CSV sync…");

const SOURCE = "G:/Dropbox/alan ranger photography/Website Code/Schema Tools/alan-shared-resources/csv/06-site-urls.csv";
const DEST   = "G:/Dropbox/alan ranger photography/Website Code/Schema Tools/alanranger-schema/public/06-site-urls.csv";

try {
  if (!fs.existsSync(SOURCE)) {
    console.error("❌ Source CSV missing:", SOURCE);
    process.exit(1);
  }

  fs.copyFileSync(SOURCE, DEST);
  console.log("✅ CSV synced successfully →", DEST);

} catch (err) {
  console.error("❌ CSV sync failed:", err);
  process.exit(1);
}

