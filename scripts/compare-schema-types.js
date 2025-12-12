/**
 * Compare schema types from Schema Tools project with Supabase audit results
 * 
 * This script:
 * 1. Reads all JSON files from Schema Tools alanranger-schema directory
 * 2. Extracts @type values from each file
 * 3. Counts pages by schema type
 * 4. Compares with Supabase counts
 */

const fs = require('fs');
const path = require('path');

// Path to Schema Tools schema directory
const SCHEMA_DIR = path.join(__dirname, '../../Schema Tools/alanranger-schema');

function extractSchemaTypesFromJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    
    const types = [];
    
    // Extract @type
    if (json['@type']) {
      if (Array.isArray(json['@type'])) {
        types.push(...json['@type']);
      } else {
        types.push(json['@type']);
      }
    }
    
    // Also check for nested types in @graph
    if (json['@graph'] && Array.isArray(json['@graph'])) {
      json['@graph'].forEach(item => {
        if (item['@type']) {
          if (Array.isArray(item['@type'])) {
            types.push(...item['@type']);
          } else {
            types.push(item['@type']);
          }
        }
      });
    }
    
    return types.filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getSchemaTypeCountsFromFiles() {
  const typeCounts = {};
  const files = fs.readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.json'));
  
  console.log(`📁 Processing ${files.length} JSON files from Schema Tools...`);
  
  files.forEach(file => {
    const filePath = path.join(SCHEMA_DIR, file);
    const types = extractSchemaTypesFromJson(filePath);
    
    types.forEach(type => {
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
  });
  
  return typeCounts;
}

// Expected counts from Schema Tools (based on filename patterns)
const EXPECTED_COUNTS = {
  'BreadcrumbList': 220,
  'BlogPosting': 220,
  'ImageObject': 220,
  'WebPage': 220,
  'HowTo': 219,
  'FAQPage': 142
};

// Run comparison
const schemaToolsCounts = getSchemaTypeCountsFromFiles();

console.log('\n📊 Schema Types from Schema Tools JSON files:');
console.log('='.repeat(60));
Object.entries(schemaToolsCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`${type.padEnd(30)} ${count.toString().padStart(4)} files`);
  });

console.log('\n📊 Expected counts (from filename patterns):');
console.log('='.repeat(60));
Object.entries(EXPECTED_COUNTS)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`${type.padEnd(30)} ${count.toString().padStart(4)} pages`);
  });

console.log('\n💡 Next step: Compare with Supabase counts using SQL query');
console.log('   Run the SQL query in Supabase to get actual detected counts');

