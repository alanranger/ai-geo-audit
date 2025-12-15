/**
 * Domain Type Autofill Script - Aggressive classification
 * 
 * Scans all domains in snapshots + pending queue and classifies them using
 * aggressive tiered matching to achieve 80%+ coverage.
 * 
 * Usage:
 *   node scripts/domain-type-autofill.js --dry-run
 *   node scripts/domain-type-autofill.js --commit
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ensureDomainTypeMapping, suggestDomainType } from '../lib/domainTypeClassifier.js';
import { normalizeDomain } from '../lib/domainStrength/domains.js';

// Load environment variables from .env.local or .env
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local or .env');
  console.error('   Please set these environment variables before running the script.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/**
 * Get candidate domains from snapshots and pending queue
 */
async function getCandidateDomains() {
  const domains = new Set();
  
  // From snapshots
  console.log('📊 Fetching domains from domain_strength_snapshots...');
  const { data: snapshotRows, error: snapshotError } = await supabaseAdmin
    .from('domain_strength_snapshots')
    .select('domain')
    .not('domain', 'is', null);
  
  if (snapshotError) {
    console.error('  ✗ Error fetching domains from snapshots:', snapshotError);
  } else {
    snapshotRows.forEach(row => {
      const normalized = normalizeDomain(row.domain);
      if (normalized) domains.add(normalized);
    });
    console.log(`  ✓ Found ${snapshotRows.length} snapshot rows, ${domains.size} unique domains`);
  }
  
  // From pending queue
  console.log('📋 Fetching domains from domain_rank_pending...');
  const { data: pendingRows, error: pendingError } = await supabaseAdmin
    .from('domain_rank_pending')
    .select('domain')
    .not('domain', 'is', null);
  
  if (pendingError) {
    console.error('  ✗ Error fetching domains from pending queue:', pendingError);
  } else {
    const beforeSize = domains.size;
    pendingRows.forEach(row => {
      const normalized = normalizeDomain(row.domain);
      if (normalized) domains.add(normalized);
    });
    const newCount = domains.size - beforeSize;
    console.log(`  ✓ Found ${pendingRows.length} pending rows, ${newCount} new unique domains`);
  }
  
  return Array.from(domains).filter(Boolean);
}

/**
 * Get domains that need classification
 */
async function getDomainsNeedingClassification(candidateDomains) {
  if (candidateDomains.length === 0) return [];
  
  // Fetch existing classifications in chunks
  const chunkSize = 100;
  const existingMap = new Map();
  
  for (let i = 0; i < candidateDomains.length; i += chunkSize) {
    const chunk = candidateDomains.slice(i, i + chunkSize);
    const inList = `(${chunk.map(d => `"${d}"`).join(',')})`;
    
    const { data, error } = await supabaseAdmin
      .from('domain_strength_domains')
      .select('domain, domain_type, domain_type_source')
      .in('domain', chunk);
    
    if (error) {
      console.error(`  ✗ Error fetching existing classifications for chunk:`, error);
      continue;
    }
    
    if (data) {
      data.forEach(row => {
        existingMap.set(row.domain, {
          domain_type: row.domain_type,
          domain_type_source: row.domain_type_source
        });
      });
    }
  }
  
  // Filter: need classification if:
  // - Not in existingMap (new domain)
  // - domain_type is null or 'unmapped'
  // - domain_type_source is NOT 'manual' (we never overwrite manual)
  const needsClassification = candidateDomains.filter(domain => {
    const existing = existingMap.get(domain);
    if (!existing) return true; // New domain
    if (existing.domain_type_source === 'manual') return false; // Never overwrite manual
    if (!existing.domain_type || existing.domain_type === 'unmapped') return true; // Needs classification
    return false; // Already classified (non-manual)
  });
  
  return needsClassification;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--commit');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  
  console.log('\n🔍 Domain Type Autofill Script');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update database)'}\n`);
  
  // Get candidate domains
  const candidateDomains = await getCandidateDomains();
  console.log(`\n📝 Processing ${candidateDomains.length} total domains...\n`);
  
  // Get domains needing classification
  const domainsToProcess = await getDomainsNeedingClassification(candidateDomains);
  const finalDomains = limit ? domainsToProcess.slice(0, limit) : domainsToProcess;
  
  console.log(`📋 ${domainsToProcess.length} domains need classification`);
  if (limit) console.log(`   (Processing first ${limit} due to --limit)\n`);
  else console.log('');
  
  const summary = {
    scanned: candidateDomains.length,
    needs_classification: domainsToProcess.length,
    processed: finalDomains.length,
    by_type: {},
    by_source: {},
    by_confidence_band: { high: 0, medium: 0, low: 0 },
    inserted: 0,
    updated: 0,
    skipped_manual: 0,
    skipped_no_change: 0,
    errors: 0,
  };
  
  for (const domain of finalDomains) {
    if (dryRun) {
      const suggestion = suggestDomainType(domain);
      if (suggestion) {
        const confBand = suggestion.confidence >= 80 ? 'high' : suggestion.confidence >= 50 ? 'medium' : 'low';
        summary.by_type[suggestion.domain_type] = (summary.by_type[suggestion.domain_type] || 0) + 1;
        summary.by_source[suggestion.source] = (summary.by_source[suggestion.source] || 0) + 1;
        summary.by_confidence_band[confBand]++;
        console.log(`  [WOULD ${dryRun ? 'INSERT/UPDATE' : 'INSERT'}] ${domain} → ${suggestion.domain_type} (${suggestion.confidence}% confidence, ${suggestion.source})`);
      } else {
        console.log(`  ⊘ SKIP (parse failed): ${domain}`);
      }
    } else {
      const result = await ensureDomainTypeMapping(supabaseAdmin, domain, 'autofill-script');
      
      if (result.status === 'inserted') {
        summary.inserted++;
        const confBand = result.confidence >= 80 ? 'high' : result.confidence >= 50 ? 'medium' : 'low';
        summary.by_type[result.domain_type] = (summary.by_type[result.domain_type] || 0) + 1;
        summary.by_confidence_band[confBand]++;
        console.log(`  ✓ INSERTED: ${domain} → ${result.domain_type} (${result.confidence}% confidence)`);
      } else if (result.status === 'updated') {
        summary.updated++;
        const confBand = result.confidence >= 80 ? 'high' : result.confidence >= 50 ? 'medium' : 'low';
        summary.by_type[result.domain_type] = (summary.by_type[result.domain_type] || 0) + 1;
        summary.by_confidence_band[confBand]++;
        console.log(`  ✓ UPDATED: ${domain} → ${result.domain_type} (${result.confidence}% confidence)`);
      } else if (result.status === 'skipped' && result.reason === 'manual override exists') {
        summary.skipped_manual++;
        console.log(`  ⊘ SKIPPED: ${domain} (Manual override)`);
      } else if (result.status === 'skipped' && result.reason === 'existing non-auto mapping') {
        summary.skipped_no_change++;
        console.log(`  ⊘ SKIPPED: ${domain} (No change needed)`);
      } else if (result.status === 'error') {
        summary.errors++;
        console.log(`  ✗ ERROR: ${domain} - ${result.reason}`);
      } else {
        console.log(`  ⊘ SKIPPED: ${domain} (${result.reason || 'N/A'})`);
      }
      
      // Progress indicator
      if (summary.processed % 50 === 0 && summary.processed > 0) {
        console.log(`  ... processed ${summary.processed}/${finalDomains.length} domains ...`);
      }
      summary.processed++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log('='.repeat(60));
  console.log(`  Scanned:              ${summary.scanned}`);
  console.log(`  Needs classification:  ${summary.needs_classification}`);
  console.log(`  Processed:            ${summary.processed}`);
  
  if (!dryRun) {
    console.log(`  Inserted:              ${summary.inserted}`);
    console.log(`  Updated:               ${summary.updated}`);
    console.log(`  Skipped (manual):      ${summary.skipped_manual}`);
    console.log(`  Skipped (no change):   ${summary.skipped_no_change}`);
    console.log(`  Errors:                ${summary.errors}`);
  }
  
  if (Object.keys(summary.by_type).length > 0) {
    console.log('\n  By type:');
    Object.entries(summary.by_type)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`    ${type.padEnd(20)} ${count}`);
      });
  }
  
  if (Object.keys(summary.by_source).length > 0) {
    console.log('\n  By source:');
    Object.entries(summary.by_source)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        console.log(`    ${source.padEnd(20)} ${count}`);
      });
  }
  
  if (!dryRun && Object.keys(summary.by_confidence_band).length > 0) {
    console.log('\n  By confidence band:');
    console.log(`    High (≥80%)          ${summary.by_confidence_band.high}`);
    console.log(`    Medium (50-79%)      ${summary.by_confidence_band.medium}`);
    console.log(`    Low (<50%)           ${summary.by_confidence_band.low}`);
  }
  
  console.log('='.repeat(60));
  
  if (dryRun) {
    console.log('\n⚠️  This was a DRY RUN. No changes were made.');
    console.log('   Run with --commit to apply changes.\n');
  } else {
    console.log('\n✓ Changes applied to database.\n');
  }
}

main().catch(console.error);

