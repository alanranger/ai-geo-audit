/**
 * Domain Type Autofill Script
 * 
 * Populates domain_strength_domains with auto-suggested domain_type classifications
 * for all domains currently in snapshots and pending queue.
 * 
 * Usage:
 *   npm run domain:type:autofill -- --dry-run --limit 500
 *   npm run domain:type:autofill -- --no-dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { ensureDomainTypeMapping, normalizeDomain } from '../lib/domainTypeClassifier.js';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--no-dry-run') && (args.includes('--dry-run') || true); // Default to dry-run
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log(`\n🔍 Domain Type Autofill Script`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update database)'}`);
  if (limit) console.log(`Limit: ${limit} domains`);
  console.log('');

  // Step 1: Collect candidate domains
  const candidateDomains = new Set();
  
  // From domain_strength_snapshots
  console.log('📊 Fetching domains from domain_strength_snapshots...');
  try {
    const { data: snapshotDomains, error: snapshotError } = await supabase
      .from('domain_strength_snapshots')
      .select('domain')
      .not('domain', 'is', null);
    
    if (snapshotError) {
      console.error('Error fetching snapshot domains:', snapshotError);
    } else {
      snapshotDomains.forEach(row => {
        const normalized = normalizeDomain(row.domain);
        if (normalized) candidateDomains.add(normalized);
      });
      console.log(`  ✓ Found ${snapshotDomains.length} snapshot rows, ${candidateDomains.size} unique domains`);
    }
  } catch (e) {
    console.error('Error fetching snapshot domains:', e);
  }
  
  // From domain_rank_pending
  console.log('📋 Fetching domains from domain_rank_pending...');
  try {
    const { data: pendingDomains, error: pendingError } = await supabase
      .from('domain_rank_pending')
      .select('domain')
      .not('domain', 'is', null);
    
    if (pendingError) {
      if (pendingError.code === 'PGRST116' || pendingError.message.includes('does not exist')) {
        console.log('  ⚠ domain_rank_pending table does not exist (skipping)');
      } else {
        console.error('Error fetching pending domains:', pendingError);
      }
    } else {
      const beforeCount = candidateDomains.size;
      pendingDomains.forEach(row => {
        const normalized = normalizeDomain(row.domain);
        if (normalized) candidateDomains.add(normalized);
      });
      console.log(`  ✓ Found ${pendingDomains.length} pending rows, ${candidateDomains.size - beforeCount} new unique domains`);
    }
  } catch (e) {
    console.error('Error fetching pending domains:', e);
  }
  
  const allDomains = Array.from(candidateDomains);
  const domainsToProcess = limit ? allDomains.slice(0, limit) : allDomains;
  
  console.log(`\n📝 Processing ${domainsToProcess.length} domains (${allDomains.length} total available)...\n`);
  
  // Step 2: Process each domain
  const stats = {
    scanned: 0,
    suggested: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    alreadyManual: 0,
    errors: 0
  };
  
  for (const domain of domainsToProcess) {
    stats.scanned++;
    
    if (!dryRun) {
      try {
        const result = await ensureDomainTypeMapping(supabase, domain, 'autofill');
        
        switch (result.action) {
          case 'inserted':
            stats.inserted++;
            stats.suggested++;
            console.log(`  ✓ INSERTED: ${domain} → ${result.domain_type} (${result.confidence}% confidence)`);
            break;
          case 'updated':
            stats.updated++;
            stats.suggested++;
            console.log(`  ✓ UPDATED: ${domain} → ${result.domain_type} (${result.confidence}% confidence)`);
            break;
          case 'skipped':
            stats.skipped++;
            if (result.reason === 'Manual classification exists') {
              stats.alreadyManual++;
            }
            if (result.domain_type) {
              console.log(`  ⊘ SKIPPED: ${domain} (${result.reason})`);
            }
            break;
          case 'error':
            stats.errors++;
            console.error(`  ✗ ERROR: ${domain} - ${result.reason}`);
            break;
        }
      } catch (e) {
        stats.errors++;
        console.error(`  ✗ ERROR processing ${domain}:`, e.message);
      }
    } else {
      // Dry run: just check what would happen
      try {
        const { data: existing } = await supabase
          .from('domain_strength_domains')
          .select('domain, domain_type, domain_type_source')
          .eq('domain', domain)
          .single();
        
        if (existing) {
          if (existing.domain_type_source === 'manual') {
            stats.alreadyManual++;
            console.log(`  ⊘ SKIP (manual): ${domain} → ${existing.domain_type}`);
          } else if (existing.domain_type && existing.domain_type !== 'unmapped') {
            stats.skipped++;
            console.log(`  ⊘ SKIP (exists): ${domain} → ${existing.domain_type}`);
          } else {
            // Would update
            const { suggestDomainType } = await import('../lib/domainTypeClassifier.js');
            const suggestion = suggestDomainType(domain);
            if (suggestion) {
              stats.suggested++;
              stats.updated++;
              console.log(`  [WOULD UPDATE] ${domain} → ${suggestion.domain_type} (${suggestion.confidence}% confidence)`);
            } else {
              stats.skipped++;
              console.log(`  ⊘ SKIP (no suggestion): ${domain}`);
            }
          }
        } else {
          // Would insert
          const { suggestDomainType } = await import('../lib/domainTypeClassifier.js');
          const suggestion = suggestDomainType(domain);
          if (suggestion) {
            stats.suggested++;
            stats.inserted++;
            console.log(`  [WOULD INSERT] ${domain} → ${suggestion.domain_type} (${suggestion.confidence}% confidence)`);
          } else {
            stats.skipped++;
            console.log(`  ⊘ SKIP (no suggestion): ${domain}`);
          }
        }
      } catch (e) {
        stats.errors++;
        console.error(`  ✗ ERROR checking ${domain}:`, e.message);
      }
    }
    
    // Progress indicator
    if (stats.scanned % 50 === 0) {
      console.log(`  ... processed ${stats.scanned}/${domainsToProcess.length} domains ...`);
    }
  }
  
  // Step 3: Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log('='.repeat(60));
  console.log(`  Scanned:        ${stats.scanned}`);
  console.log(`  Suggested:       ${stats.suggested}`);
  console.log(`  Inserted:       ${stats.inserted}`);
  console.log(`  Updated:         ${stats.updated}`);
  console.log(`  Skipped:         ${stats.skipped}`);
  console.log(`  Already manual:  ${stats.alreadyManual}`);
  console.log(`  Errors:          ${stats.errors}`);
  console.log('='.repeat(60));
  
  if (dryRun) {
    console.log('\n⚠️  This was a DRY RUN. No changes were made.');
    console.log('   Run with --no-dry-run to apply changes.\n');
  } else {
    console.log('\n✓ Changes applied to database.\n');
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

