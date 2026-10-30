// Script to backfill backlink scores for Dec 13 and Dec 15
// This fixes Authority scores that dropped due to missing backlink CSV
const supabaseUrl = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function backfillBacklinks() {
  console.log('=== Backfilling Backlink Scores for Dec 13 & 15 ===\n');
  
  const propertyUrl = 'https://www.alanranger.com';
  const datesToFix = ['2025-12-13', '2025-12-15'];
  const correctBacklinkScore = 87; // From Dec 16-17 audits
  
  // Get current data for these dates
  const response = await fetch(
    `${supabaseUrl}/rest/v1/audit_results?select=audit_date,authority_score,authority_behaviour_score,authority_ranking_score,authority_backlink_score,authority_review_score&property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=in.(${datesToFix.join(',')})&order=audit_date.asc`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  if (!response.ok) {
    console.error(`❌ Error fetching data: ${response.status} ${response.statusText}`);
    return;
  }
  
  const records = await response.json();
  console.log(`Found ${records.length} records to update:\n`);
  
  for (const record of records) {
    const currentBacklink = record.authority_backlink_score;
    const currentAuthority = record.authority_score;
    
    console.log(`📅 ${record.audit_date}:`);
    console.log(`   Current: Authority=${currentAuthority}, Backlinks=${currentBacklink}`);
    
    if (currentBacklink === 0 || currentBacklink === null) {
      // Recalculate Authority with correct backlink score
      const behaviour = record.authority_behaviour_score || 0;
      const ranking = record.authority_ranking_score || 0;
      const backlinks = correctBacklinkScore;
      const reviews = record.authority_review_score || 0;
      
      const newAuthority = Math.round(
        0.4 * behaviour +
        0.2 * ranking +
        0.2 * backlinks +
        0.2 * reviews
      );
      
      console.log(`   New: Authority=${newAuthority}, Backlinks=${backlinks}`);
      console.log(`   Change: Authority ${currentAuthority} → ${newAuthority} (+${newAuthority - currentAuthority})`);
      
      // Update in Supabase
      const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${record.audit_date}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            authority_backlink_score: backlinks,
            authority_score: newAuthority
          })
        }
      );
      
      if (updateResponse.ok) {
        const updated = await updateResponse.json();
        console.log(`   ✅ Updated successfully`);
      } else {
        const errorText = await updateResponse.text();
        console.error(`   ❌ Update failed: ${updateResponse.status} ${errorText}`);
      }
    } else {
      console.log(`   ⚠️ Backlink score already set (${currentBacklink}), skipping`);
    }
    console.log('');
  }
  
  console.log('=== Backfill Complete ===');
}

backfillBacklinks().catch(console.error);

