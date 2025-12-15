/**
 * Classify all domains and generate SQL for bulk application
 * Fetches domains from a SQL export and classifies them all
 */

import { suggestDomainType } from '../lib/domainTypeClassifier.js';
import { normalizeDomain } from '../lib/domainStrength/domains.js';
import fs from 'fs';

// Read domains from a file (we'll generate this from SQL)
// For now, we'll fetch via SQL and process

const domains = [
  // This will be populated from the SQL query result
];

// If domains file exists, read it
if (fs.existsSync('temp_all_domains.json')) {
  const data = JSON.parse(fs.readFileSync('temp_all_domains.json', 'utf8'));
  domains.push(...data.map(d => d.domain));
}

const classifications = [];
const summary = {
  by_type: {},
  by_source: {},
  by_confidence_band: { high: 0, medium: 0, low: 0 },
  total: 0,
  classified: 0,
  failed: 0
};

console.log(`🔍 Classifying ${domains.length} domains...\n`);

for (const domain of domains) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    summary.failed++;
    continue;
  }
  
  summary.total++;
  const suggestion = suggestDomainType(domain);
  
  if (!suggestion) {
    summary.failed++;
    continue;
  }
  
  summary.classified++;
  summary.by_type[suggestion.domain_type] = (summary.by_type[suggestion.domain_type] || 0) + 1;
  summary.by_source[suggestion.source] = (summary.by_source[suggestion.source] || 0) + 1;
  
  const confBand = suggestion.confidence >= 80 ? 'high' : suggestion.confidence >= 50 ? 'medium' : 'low';
  summary.by_confidence_band[confBand]++;
  
  classifications.push({
    domain: normalized,
    domain_type: suggestion.domain_type,
    domain_type_source: suggestion.source || 'auto',
    domain_type_confidence: suggestion.confidence,
    domain_type_reason: suggestion.reason,
    segment: suggestion.domain_type
  });
}

// Generate SQL
const sqlStatements = [];
const batchSize = 50;

for (let i = 0; i < classifications.length; i += batchSize) {
  const batch = classifications.slice(i, i + batchSize);
  
  let sql = 'INSERT INTO domain_strength_domains (domain, domain_type, domain_type_source, domain_type_confidence, domain_type_reason, segment, label, updated_at)\nVALUES\n';
  
  const values = batch.map((c, idx) => {
    const domainEscaped = c.domain.replace(/'/g, "''");
    const reasonEscaped = c.domain_type_reason.replace(/'/g, "''");
    return `  ('${domainEscaped}', '${c.domain_type}', '${c.domain_type_source}', ${c.domain_type_confidence}, '${reasonEscaped}', '${c.segment}', '${domainEscaped}', now())${idx < batch.length - 1 ? ',' : ''}`;
  });
  
  sql += values.join('\n');
  sql += '\nON CONFLICT (domain) DO UPDATE SET\n';
  sql += '  domain_type = EXCLUDED.domain_type,\n';
  sql += '  domain_type_source = EXCLUDED.domain_type_source,\n';
  sql += '  domain_type_confidence = EXCLUDED.domain_type_confidence,\n';
  sql += '  domain_type_reason = EXCLUDED.domain_type_reason,\n';
  sql += '  segment = EXCLUDED.segment,\n';
  sql += '  updated_at = EXCLUDED.updated_at\n';
  sql += "WHERE domain_strength_domains.domain_type_source IS NULL\n";
  sql += "   OR domain_strength_domains.domain_type_source != 'manual';\n";
  
  sqlStatements.push(sql);
}

// Write SQL to file
fs.writeFileSync('temp_all_classifications.sql', sqlStatements.join('\n\n'));

console.log('='.repeat(60));
console.log('📊 Classification Summary:');
console.log('='.repeat(60));
console.log(`  Total domains:        ${summary.total}`);
console.log(`  Classified:            ${summary.classified}`);
console.log(`  Failed:                ${summary.failed}`);
console.log(`  Coverage:              ${((summary.classified / summary.total) * 100).toFixed(1)}%`);

if (Object.keys(summary.by_type).length > 0) {
  console.log('\n  By type:');
  Object.entries(summary.by_type)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const pct = ((count / summary.classified) * 100).toFixed(1);
      console.log(`    ${type.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
    });
}

if (Object.keys(summary.by_source).length > 0) {
  console.log('\n  By source:');
  Object.entries(summary.by_source)
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      const pct = ((count / summary.classified) * 100).toFixed(1);
      console.log(`    ${source.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
    });
}

console.log('\n  By confidence band:');
console.log(`    High (≥80%)          ${summary.by_confidence_band.high}`);
console.log(`    Medium (50-79%)      ${summary.by_confidence_band.medium}`);
console.log(`    Low (<50%)           ${summary.by_confidence_band.low}`);

console.log('='.repeat(60));
console.log(`\n✅ Generated ${sqlStatements.length} SQL batches`);
console.log(`   SQL written to: temp_all_classifications.sql`);
console.log(`   Total classifications: ${classifications.length}\n`);

