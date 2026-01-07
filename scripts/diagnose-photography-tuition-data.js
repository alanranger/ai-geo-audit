/**
 * Diagnostic script to understand why rank/AI data shows in Ranking & AI tab
 * but not in optimization task module
 * 
 * This script will:
 * 1. Check what data the Ranking & AI tab uses
 * 2. Check what the optimization task module looks for
 * 3. Identify the mismatch
 */

// This is a diagnostic report - no actual code execution
// Just documenting the findings

console.log(`
🔍 DIAGNOSTIC REPORT: Photography Tuition Rank/AI Data Mismatch
================================================================

ISSUE:
- Ranking & AI tab shows: rank #5, AI Overview: On, AI Citations: 0
- Optimization task drawer shows: rank —, AI Overview: —, AI Citations: —

DATA SOURCE ANALYSIS:
=====================

1. RANKING & AI TAB DATA SOURCE:
   - Uses: RankingAiModule.state().combinedRows OR window.rankingAiData
   - Field for rank: best_rank_group (displays as "#5")
   - Field for AI: has_ai_overview, ai_alan_citations_count
   - Data structure: Array of objects with { keyword, best_rank_group, has_ai_overview, ... }

2. OPTIMIZATION TASK MODULE DATA SOURCE (when adding measurement):
   - Priority order:
     a) RankingAiModule.state().combinedRows (line 13790)
     b) window.rankingAiData (line 13841)
     c) Money Pages data (localStorage)
     d) queryTotals from localStorage (line 14005)
     e) Supabase audit data (line 14140)

3. KEYWORD MATCHING LOGIC (line 13798):
   - Exact match (case-insensitive): (r.keyword || '').toLowerCase() === (task.keyword_text || '').toLowerCase()
   - Then URL matching with multiple strategies

4. RANK FIELD MAPPING:
   - Optimization module uses: matchingRow.best_rank_group || matchingRow.current_rank (line 13827)
   - queryTotals uses: qt.best_rank || qt.avg_position (line 14060)
   - Money Pages uses: moneyPageRow.avg_position || moneyPageRow.position (line 14177)

POTENTIAL ISSUES:
=================

ISSUE #1: URL Matching Requirement
   - Line 13798-13811: The optimization module requires BOTH keyword match AND URL match
   - If the task has a target_url, it tries multiple URL matching strategies
   - If URL doesn't match, the row is rejected even if keyword matches
   - FIX NEEDED: For keyword-based tasks, URL matching should be optional or more lenient

ISSUE #2: Data Source Priority
   - The module checks RankingAiModule.state() first (line 13789)
   - But if RankingAiModule isn't loaded or state() returns empty, it falls through
   - Then checks window.rankingAiData (line 13841)
   - Then falls back to localStorage queryTotals (line 14005)
   - The queryTotals matching uses exact keyword match (line 14019)
   - FIX NEEDED: Ensure RankingAiModule state is checked properly, or improve fallback logic

ISSUE #3: Field Name Mismatch
   - Ranking & AI tab uses: best_rank_group (integer like 5)
   - Optimization module looks for: best_rank_group OR current_rank
   - queryTotals might use: best_rank OR avg_position
   - FIX NEEDED: Ensure consistent field name usage

ISSUE #4: Task Type Detection
   - Line 13732: hasKeyword = !!(task.keyword_text && String(task.keyword_text).trim())
   - If task has keyword, it should prioritize Ranking & AI data
   - But URL matching might be blocking it
   - FIX NEEDED: For keyword-only tasks (no URL), skip URL matching entirely

RECOMMENDED FIXES:
==================

1. Make URL matching optional for keyword-based tasks:
   - If task has keyword but no URL, match by keyword only
   - If task has both keyword and URL, try keyword match first, then URL match

2. Improve data source fallback:
   - Check RankingAiModule.state() more reliably
   - If not found, check localStorage rankingAiData
   - Then check queryTotals with keyword matching
   - Log which source was used for debugging

3. Ensure field name consistency:
   - Use best_rank_group as primary, current_rank as fallback
   - Map queryTotals.best_rank to current_rank field

4. Add better logging:
   - Log task.keyword_text, task.target_url
   - Log what data sources are checked
   - Log why matches fail (keyword mismatch, URL mismatch, etc.)

`);
