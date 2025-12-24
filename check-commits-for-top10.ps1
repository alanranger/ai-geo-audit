# Script to systematically check commits for "Suggested Top 10" section
# Checks commits going backwards from c8965e6 to 4954504

param(
    [string]$RepoPath = ".",
    [string]$GitHubRepo = "",  # e.g., "alanranger/ai-geo-audit"
    [string]$GitHubToken = ""  # Optional: for private repos or rate limits
)

$ErrorActionPreference = "Stop"

# List of commits to check (in reverse chronological order, newest first)
$commitsToCheck = @(
    @{Hash = "c8965e6"; Message = "Fix Portfolio chart: Use date_end for weekly bucketing"},
    @{Hash = "3635c6a"; Message = "Fix Portfolio chart: Include Jan 2025 in monthly view"},
    @{Hash = "dda9abe"; Message = "Fix Portfolio chart: Restore monthly default"},
    @{Hash = "af7009b"; Message = "Fix Portfolio chart: Filter to last 12 months only"},
    @{Hash = "1440ad3"; Message = "Fix Portfolio chart: Default time grain to monthly"},
    @{Hash = "a7f7261"; Message = "Fix: Remove duplicate activeStatuses declaration"},
    @{Hash = "a9621e0"; Message = "Fix: Show 'Being Optimised' for all active task statuses"},
    @{Hash = "1104ec9"; Message = "Fix: Re-render Suggested Top 10 cards after task creation"},
    @{Hash = "01f9d69"; Message = "Update Money Pages Performance doc: Add Phase 4 completion status"},
    @{Hash = "25dc72e"; Message = "Update documentation: Add Phase 4 Suggested Top 10 feature"},
    @{Hash = "e6eedfc"; Message = "Fix optimization status check, make URLs clickable"},
    @{Hash = "0bf6279"; Message = "Refine Suggested Top 10 cards"},
    @{Hash = "da43bf0"; Message = "Add Suggested Top 10 section if it's missing"},
    @{Hash = "7d735c5"; Message = "Use requestAnimationFrame to ensure DOM is updated"},
    @{Hash = "417576a"; Message = "Add max retry limit and increase initial delay"},
    @{Hash = "bb9d186"; Message = "Add retry loop to wait for container to be rendered"},
    @{Hash = "0fa2bd6"; Message = "Add retry mechanism when container not found"},
    @{Hash = "b3875f9"; Message = "Move helper functions to top of script"},
    @{Hash = "cf6da60"; Message = "Replace stub with full implementation"},
    @{Hash = "8e7ea58"; Message = "Define stub function at script start"},
    @{Hash = "5d1ef48"; Message = "Initialize function at script start"},
    @{Hash = "c13e959"; Message = "Remove IIFE wrapper - define function at top level"},
    @{Hash = "55bf400"; Message = "Wrap function definition in IIFE"},
    @{Hash = "059b299"; Message = "Fix: Check window.renderMoneyPagesSuggestedTop10"},
    @{Hash = "9fa74fa"; Message = "Add debug logging to track function definition"},
    @{Hash = "680fb73"; Message = "Add debug logging to verify function is defined"},
    @{Hash = "3886df9"; Message = "Fix: Clean up function definition"},
    @{Hash = "83e3e64"; Message = "Fix: Use window.renderMoneyPagesSuggestedTop10"},
    @{Hash = "7c6096b"; Message = "Fix: Make renderMoneyPagesSuggestedTop10 globally accessible"},
    @{Hash = "fc79654"; Message = "Fix: Use moneyPagePriorityData as data source for Suggested Top 10"},
    @{Hash = "a259b59"; Message = "Fix: Add error handling for Suggested Top 10 table rendering"},
    @{Hash = "4954504"; Message = "Phase 4 Step 1: Add Suggested (Top 10) priority pages table"}
)

# Search patterns to look for
$searchPatterns = @(
    "suggested-top10",
    "Suggested.*Top.*10",
    "renderMoneyPagesSuggestedTop10",
    "money-pages-suggested-top10",
    "money-pages-suggested-top10-container"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking Commits for 'Suggested Top 10'" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to repo directory
Push-Location $RepoPath

try {
    # Try to fetch from remote if GitHub repo is specified
    if ($GitHubRepo -and -not (Test-Path ".git")) {
        Write-Host "WARNING: Not a git repository. Skipping git fetch." -ForegroundColor Yellow
    } elseif ($GitHubRepo) {
        Write-Host "Fetching commits from remote..." -ForegroundColor Yellow
        try {
            git fetch origin --all 2>&1 | Out-Null
            Write-Host "[OK] Fetched from remote" -ForegroundColor Green
} catch {
            Write-Host "WARNING: Could not fetch from remote: $_" -ForegroundColor Yellow
        }
    }

    $results = @()
    $foundMissing = $false
    $lastCommitWithFeature = $null

foreach ($commit in $commitsToCheck) {
    $hash = $commit.Hash
    $message = $commit.Message
    
    Write-Host "Checking commit: $hash" -ForegroundColor White
    Write-Host "  Message: $message" -ForegroundColor Gray
    
    $found = $false
    $matches = @()
    
        # Try to get file content from git
    try {
            $fileContent = git show "$hash`:audit-dashboard.html" 2>&1
        
            if ($LASTEXITCODE -eq 0 -and $fileContent) {
                # Check each search pattern
            foreach ($pattern in $searchPatterns) {
                $patternMatches = $fileContent | Select-String -Pattern $pattern -CaseSensitive:$false
                if ($patternMatches) {
                    $found = $true
                        $matches += $patternMatches | Select-Object -First 3 | ForEach-Object { $_.Line.Trim() }
                    }
                }
            } else {
                Write-Host "  WARNING: Could not retrieve file from git (commit may not exist locally)" -ForegroundColor Yellow
                
                # Try GitHub API if repo and token are provided
                if ($GitHubRepo -and $GitHubToken) {
                    Write-Host "  Trying GitHub API..." -ForegroundColor Yellow
                    try {
                        $url = "https://api.github.com/repos/$GitHubRepo/contents/audit-dashboard.html?ref=$hash"
                        $headers = @{
                            "Authorization" = "token $GitHubToken"
                            "Accept" = "application/vnd.github.v3.raw"
                        }
                        
                        $response = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
                        $fileContent = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($response.content))
                        
                        foreach ($pattern in $searchPatterns) {
                            $patternMatches = $fileContent | Select-String -Pattern $pattern -CaseSensitive:$false
                            if ($patternMatches) {
                                $found = $true
                                $matches += $patternMatches | Select-Object -First 3 | ForEach-Object { $_.Line.Trim() }
                            }
                        }
                    } catch {
                        Write-Host "  WARNING: GitHub API failed: $_" -ForegroundColor Yellow
                    }
                }
            }
        } catch {
            Write-Host "  WARNING: Error checking commit: $_" -ForegroundColor Yellow
        }
        
        $status = if ($found) { "[FOUND]" } else { "[MISSING]" }
        $color = if ($found) { "Green" } else { "Red" }
        
        Write-Host "  Status: $status" -ForegroundColor $color
        
        if ($matches.Count -gt 0) {
            Write-Host "  Matches found:" -ForegroundColor Gray
            $matches | ForEach-Object {
                $line = $_.Substring(0, [Math]::Min(80, $_.Length))
                Write-Host "    - $line..." -ForegroundColor DarkGray
            }
        }
        
        $results += [PSCustomObject]@{
            Hash = $hash
            Message = $message
            Found = $found
            Matches = $matches.Count
        }
        
        # Track when we first find it missing
        if (-not $found -and -not $foundMissing) {
            $foundMissing = $true
            Write-Host ""
            Write-Host "*** FIRST MISSING AT: $hash ***" -ForegroundColor Red
            Write-Host "   This commit or the one before it removed the feature!" -ForegroundColor Red
        }
        
        # Track last commit with feature
        if ($found) {
            $lastCommitWithFeature = $hash
    }
    
    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

    $foundCount = ($results | Where-Object { $_.Found }).Count
    $missingCount = ($results | Where-Object { -not $_.Found }).Count

Write-Host "Total commits checked: $($results.Count)" -ForegroundColor White
    Write-Host "Found: $foundCount" -ForegroundColor Green
    Write-Host "Missing: $missingCount" -ForegroundColor Red
    Write-Host ""
    
    if ($lastCommitWithFeature) {
        Write-Host "Last commit WITH feature: $lastCommitWithFeature" -ForegroundColor Green
    }
    
    # Find the transition point
    $transitionPoint = $null
    for ($i = 0; $i -lt $results.Count - 1; $i++) {
        if ($results[$i].Found -and -not $results[$i + 1].Found) {
            $transitionPoint = $results[$i]
    Write-Host ""
            Write-Host "*** TRANSITION POINT FOUND ***" -ForegroundColor Yellow
            Write-Host "   Commit WITH feature: $($transitionPoint.Hash)" -ForegroundColor Green
            Write-Host "   Commit WITHOUT feature: $($results[$i + 1].Hash)" -ForegroundColor Red
            Write-Host "   -> The feature was removed between these two commits!" -ForegroundColor Yellow
            break
        }
    }
    
    if (-not $transitionPoint) {
Write-Host ""
        Write-Host "WARNING: Could not find transition point. All commits checked are missing the feature." -ForegroundColor Yellow
        Write-Host "   This suggests the feature was removed before commit c8965e6." -ForegroundColor Yellow
    }
    
    # Export results to CSV
    $csvPath = "commit-check-results.csv"
    $results | Export-Csv -Path $csvPath -NoTypeInformation
    Write-Host ""
    Write-Host "Results exported to: $csvPath" -ForegroundColor Cyan
    
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
