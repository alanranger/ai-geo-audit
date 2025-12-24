# Commit Check Script Usage

## Overview

The `check-commits-for-top10.ps1` script systematically checks each commit going backwards from `c8965e6` to `4954504` to find when the "Suggested Top 10" section was removed.

## Prerequisites

- PowerShell (Windows)
- Git installed and configured
- (Optional) GitHub personal access token for private repos or rate limit issues

## Usage

### Basic Usage (Local Git Repository)

```powershell
cd "G:\Dropbox\alan ranger photography\Website Code\AI GEO Audit"
.\check-commits-for-top10.ps1
```

### With GitHub Repository (if commits not in local repo)

```powershell
.\check-commits-for-top10.ps1 -GitHubRepo "alanranger/ai-geo-audit" -GitHubToken "your_github_token"
```

### Parameters

- `-RepoPath`: Path to repository (default: current directory)
- `-GitHubRepo`: GitHub repository in format "owner/repo" (optional)
- `-GitHubToken`: GitHub personal access token (optional, for private repos or rate limits)

## What It Does

1. **Fetches commits** from remote (if GitHub repo specified)
2. **Checks each commit** for the presence of "Suggested Top 10" related code
3. **Searches for patterns**:
   - `suggested-top10`
   - `Suggested.*Top.*10`
   - `renderMoneyPagesSuggestedTop10`
   - `money-pages-suggested-top10`
   - `money-pages-suggested-top10-container`
4. **Reports results**:
   - Which commits have the feature
   - Which commits are missing it
   - The transition point where it was removed
5. **Exports results** to `commit-check-results.csv`

## Output

The script will:
- Show status for each commit (✓ FOUND or ✗ MISSING)
- Display matching lines when found
- Identify the transition point where the feature was removed
- Generate a summary report
- Export results to CSV

## Example Output

```
Checking commit: c8965e6
  Message: Fix Portfolio chart: Use date_end for weekly bucketing
  Status: ✗ MISSING

Checking commit: 1104ec9
  Message: Fix: Re-render Suggested Top 10 cards after task creation
  Status: ✓ FOUND
  Matches found:
    - window.renderMoneyPagesSuggestedTop10 = function() {
    - <section id="money-pages-suggested-top10">
    - <div id="money-pages-suggested-top10-container">

🔍 TRANSITION POINT FOUND:
   Commit WITH feature: 1104ec9
   Commit WITHOUT feature: a9621e0
   → The feature was removed between these two commits!
```

## Getting a GitHub Token (Optional)

If you need to check commits via GitHub API:

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scope: `repo` (for private repos) or `public_repo` (for public repos)
4. Copy the token and use it with `-GitHubToken` parameter

## Troubleshooting

### "Could not retrieve file from git"
- The commit may not be in your local repository
- Try fetching: `git fetch origin --all`
- Or use GitHub API with `-GitHubRepo` and `-GitHubToken`

### "GitHub API failed"
- Check your token has correct permissions
- Check the repository name format: "owner/repo"
- Check rate limits (GitHub allows 60 requests/hour for unauthenticated, 5000/hour for authenticated)

### "Not a git repository"
- Make sure you're in the correct directory
- Check that `.git` folder exists

## Next Steps

After running the script:

1. Review the CSV file for detailed results
2. Check the transition point commit on GitHub
3. Inspect the commit that removed the feature
4. Restore the "Suggested Top 10" section from the last commit that had it

