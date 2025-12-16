const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';
const PROPERTY_URL = 'https://www.alanranger.com';

async function checkDatabase() {
  // Check recent audits
  const auditsUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(PROPERTY_URL)}&order=audit_date.desc&limit=5&select=audit_date,schema_total_pages,schema_pages_with_schema,schema_coverage`;
  const auditsRes = await fetch(auditsUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const audits = await auditsRes.json();
  console.log(`\nFound ${audits.length} audit records:`);
  audits.forEach((r, i) => {
    console.log(`${i+1}. ${r.audit_date}: totalPages=${r.schema_total_pages}, withSchema=${r.schema_pages_with_schema}, coverage=${r.schema_coverage}`);
  });

  // Check latest audit in detail
  const latestUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(PROPERTY_URL)}&order=audit_date.desc&limit=1&select=audit_date,schema_total_pages,schema_pages_with_schema,schema_coverage,schema_pages_detail,schema_types`;
  const latestRes = await fetch(latestUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const latest = await latestRes.json();
  
  if (latest && latest.length > 0) {
    const r = latest[0];
    console.log(`\nLatest audit (${r.audit_date}) details:`);
    console.log(`  schema_total_pages: ${r.schema_total_pages}`);
    console.log(`  schema_pages_with_schema: ${r.schema_pages_with_schema}`);
    console.log(`  schema_coverage: ${r.schema_coverage}`);
    console.log(`  schema_pages_detail type: ${typeof r.schema_pages_detail}`);
    
    if (r.schema_pages_detail) {
      let pagesDetail = r.schema_pages_detail;
      if (typeof pagesDetail === 'string') {
        try {
          pagesDetail = JSON.parse(pagesDetail);
        } catch (e) {
          console.log(`  schema_pages_detail: string parse error: ${e.message}`);
        }
      }
      if (Array.isArray(pagesDetail)) {
        console.log(`  schema_pages_detail: array with ${pagesDetail.length} pages`);
        if (pagesDetail.length > 0) {
          console.log(`  First page sample:`, JSON.stringify(pagesDetail[0], null, 2).substring(0, 300));
        }
      } else if (typeof pagesDetail === 'object') {
        console.log(`  schema_pages_detail: object with keys: ${Object.keys(pagesDetail).join(', ')}`);
      }
    } else {
      console.log(`  schema_pages_detail: null or undefined`);
    }
    
    if (r.schema_types) {
      let types = r.schema_types;
      if (typeof types === 'string') {
        try {
          types = JSON.parse(types);
        } catch (e) {
          console.log(`  schema_types: string parse error: ${e.message}`);
        }
      }
      if (Array.isArray(types)) {
        console.log(`  schema_types: array with ${types.length} types`);
        console.log(`  Types: ${types.slice(0, 20).join(', ')}${types.length > 20 ? '...' : ''}`);
      } else {
        console.log(`  schema_types: ${typeof types}`);
      }
    }
  }
}

checkDatabase().catch(console.error);







