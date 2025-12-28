# Test Supabase Connection using REST API
# This script tests the connection to Supabase without requiring Node.js

$supabaseUrl = "https://igzvwbvgvmzvvzoclufx.supabase.co"
$supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M"

Write-Host "🔌 Testing Supabase Connection..." -ForegroundColor Cyan
Write-Host "   URL: $supabaseUrl" -ForegroundColor Gray
Write-Host ""

$headers = @{
    "apikey" = $supabaseKey
    "Authorization" = "Bearer $supabaseKey"
    "Content-Type" = "application/json"
}

# Helper function to build URI
function Build-Uri {
    param($base, $params)
    $queryString = ($params | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '&'
    return "$base?$queryString"
}

# Test 1: Query audit_results table
Write-Host "📊 Test 1: Querying audit_results table..." -ForegroundColor Yellow
try {
    $uri = Build-Uri "$supabaseUrl/rest/v1/audit_results" @{
        "select" = "property_url,audit_date,visibility_score"
        "limit" = "1"
    }
    $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
    Write-Host "   ✅ Successfully queried audit_results (found $($response.Count) records)" -ForegroundColor Green
    if ($response.Count -gt 0) {
        Write-Host "   Sample record: $($response[0].property_url) - $($response[0].audit_date)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""

# Test 2: Query keyword_rankings table
Write-Host "📊 Test 2: Querying keyword_rankings table..." -ForegroundColor Yellow
try {
    $uri = Build-Uri "$supabaseUrl/rest/v1/keyword_rankings" @{
        "select" = "keyword,best_rank_group"
        "limit" = "1"
    }
    $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
    Write-Host "   ✅ Successfully queried keyword_rankings (found $($response.Count) records)" -ForegroundColor Green
    if ($response.Count -gt 0) {
        Write-Host "   Sample keyword: $($response[0].keyword) - Rank: $($response[0].best_rank_group)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""

# Test 3: Get latest audit
Write-Host "📊 Test 3: Getting latest audit..." -ForegroundColor Yellow
try {
    $uri = Build-Uri "$supabaseUrl/rest/v1/audit_results" @{
        "select" = "*"
        "order" = "audit_date.desc"
        "limit" = "1"
    }
    $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
    if ($response.Count -gt 0) {
        $latest = $response[0]
        Write-Host "   ✅ Found latest audit: $($latest.audit_date) for $($latest.property_url)" -ForegroundColor Green
        Write-Host "   Scores: Visibility=$($latest.visibility_score), Authority=$($latest.authority_score), Content/Schema=$($latest.content_schema_score)" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  No audit records found (this is OK if you haven't run any audits yet)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ Connection test complete!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now use Supabase in your scripts." -ForegroundColor Cyan
