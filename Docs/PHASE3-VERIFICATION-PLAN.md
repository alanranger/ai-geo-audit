# Phase 3: Verification Plan

**Status**: 🔄 **IN PROGRESS**  
**Created**: 2026-01-08

---

## Approach

Due to the large file size (`audit-dashboard.html` > 2MB), we'll use a systematic approach:

1. **Document expected behavior** for each button (✅ DONE)
2. **Search for specific code patterns** that indicate data source usage
3. **Verify each finding** by examining code sections
4. **Document inconsistencies** as they're found
5. **Create fixes** based on findings

---

## Verification Patterns to Search For

### Pattern 1: Supabase First (Correct)
```javascript
// Should see:
const latestAudit = await fetchLatestAuditFromSupabase(propertyUrl, false);
// OR
if (typeof fetchLatestAuditFromSupabase === 'function') {
  latestAudit = await fetchLatestAuditFromSupabase(propertyUrl, false);
}
```

### Pattern 2: localStorage Fallback (Acceptable)
```javascript
// Should see AFTER Supabase check:
if (!latestAudit) {
  const local = localStorage.getItem('last_audit_results');
  // ... use local with warning
}
```

### Pattern 3: localStorage First (INCORRECT - needs fix)
```javascript
// Should NOT see this first:
const local = localStorage.getItem('last_audit_results');
// ... use local without checking Supabase first
```

### Pattern 4: URL Matching (Should be consistent)
```javascript
// Should see:
const normalizedUrl = normalizeUrlForDedupe ? normalizeUrlForDedupe(url) : url.toLowerCase()...;
// OR
const result = computeAiMetricsForPageUrl(url, combinedRows);
```

---

## Button-by-Button Verification

### Button 1: Add Measurement

**Search Strategy**:
1. Find handler: `getElementById('optimisation-add-measurement-btn')`
2. Search for: `fetchLatestAuditFromSupabase` in handler context
3. Search for: `localStorage.getItem('last_audit_results')` in handler context
4. Search for: `localStorage.getItem('rankingAiData')` in handler context
5. Search for: `computeAiMetricsForPageUrl` in handler context
6. Search for: `/api/optimisation/task/.*/measurement` in handler context

**Expected Findings**:
- ✅ Should call `fetchLatestAuditFromSupabase()` first
- ✅ Should fall back to localStorage only if Supabase unavailable
- ✅ Should use `computeAiMetricsForPageUrl()` for URL tasks
- ✅ Should use `combinedRows` for keyword tasks
- ✅ Should call measurement API endpoint

---

### Button 2: Rebaseline

**Search Strategy**:
1. Find handler: `getElementById('optimisation-rebaseline-btn')`
2. Same patterns as Add Measurement

**Expected Findings**:
- ✅ Should call `fetchLatestAuditFromSupabase()` first
- ✅ Should mark `is_baseline: true` in measurement
- ✅ Should use same data fetching logic as Add Measurement

---

### Button 3: Update Task Latest

**Search Strategy**:
1. Find function: `window.updateTaskLatest()`
2. Same patterns as Add Measurement

**Expected Findings**:
- ✅ Should use same logic as Add Measurement (per reference docs)
- ✅ Should call measurement API endpoint

---

### Button 4: Bulk Update All Tasks

**Search Strategy**:
1. Find function: `window.bulkUpdateAllTasks()`
2. Check if it fetches audit once for all tasks
3. Check if it reuses same audit data

**Expected Findings**:
- ✅ Should fetch from Supabase once (not per task)
- ✅ Should reuse audit data for all tasks
- ✅ Should batch process efficiently

---

### Button 5: Run Audit Scan

**Search Strategy**:
1. Find function: `window.runAudit()`
2. Search for: External API calls (GSC, Local Signals, etc.)
3. Search for: Supabase save operations
4. Search for: localStorage updates

**Expected Findings**:
- ✅ Should fetch fresh from external APIs
- ✅ Should NOT read from Supabase (creates new audit)
- ✅ Should save to Supabase first
- ✅ Should update localStorage after Supabase save

---

### Button 6: Run Ranking & AI Scan

**Search Strategy**:
1. Find function: `window.loadRankingAiData()` or similar
2. Search for: DataForSEO API calls
3. Search for: Supabase save operations

**Expected Findings**:
- ✅ Should fetch fresh from DataForSEO API
- ✅ Should save to Supabase first
- ✅ Should update localStorage after Supabase save

---

### Button 7: Run Money Pages Scan

**Search Strategy**:
1. Find function: `window.dashboardRunMoneyPagesScan()`
2. Search for: `fetchLatestAuditFromSupabase` calls
3. Search for: Supabase write operations (should be none)

**Expected Findings**:
- ✅ Should read from Supabase only
- ✅ Should NOT fetch fresh from APIs
- ✅ Should NOT save to Supabase (read-only)

---

### Button 8: Run All Audits & Updates

**Search Strategy**:
1. Find function: `window.runDashboardGlobalRun()`
2. Check execution order
3. Check error handling

**Expected Findings**:
- ✅ Should execute in correct order
- ✅ Should handle errors gracefully

---

## Next Steps

1. Use targeted grep searches for each button
2. Document findings in `PHASE3-AUDIT-FINDINGS.md`
3. Create fixes for any inconsistencies found
4. Test each button after fixes

---

**Last Updated**: 2026-01-08
