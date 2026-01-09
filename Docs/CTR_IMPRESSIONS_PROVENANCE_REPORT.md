# CTR + Impressions Provenance Audit Report
## Ranking & AI Tab - Data Source Analysis

**Generated:** 2025-01-17  
**Scope:** CTR and Impressions metrics displayed in Ranking & AI keyword table

---

## 1. UI Component + Field Names

### Location
**File:** `audit-dashboard.html`

### Table Column Display
**Lines:** 26295-26307

```26295:26307:audit-dashboard.html
        // CTR
        const tdCtr = document.createElement("td");
        const ctrMetrics = getCtrMetricsForKeyword({
          keyword: row.keyword,
          url: row.ranking_url
        });
        if (ctrMetrics && ctrMetrics.ctr != null && ctrMetrics.impressions != null) {
          const ctrPercent = (ctrMetrics.ctr * 100).toFixed(2);
          tdCtr.textContent = `${ctrPercent}%`;
          tdCtr.style.color = '#1e293b';
        } else {
          tdCtr.textContent = "—";
          tdCtr.style.color = '#94a3b8';
        }
        tr.appendChild(tdCtr);
```

### Scorecard Display (Keyword Detail Panel)
**Lines:** 26768-26770

```26768:26770:audit-dashboard.html
        html += `<span>CTR (last 30 days): <strong style="color: #1e293b;">${ctrPercent}%</strong></span>`;
        html += `<span>·</span>`;
        html += `<span>Impressions: <strong style="color: #1e293b;">${impressionsFormatted}</strong></span>`;
```

### Field Names Used
- **Function:** `getCtrMetricsForKeyword(key)` where `key = { keyword: string, url: string }`
- **Return object:** `{ ctr: number (0-1 decimal), impressions: number, clicks: number }`
- **Display variables:**
  - `ctrPercent = ctrMetrics.ctr * 100` (converted to percentage)
  - `impressionsFormatted = ctrMetrics.impressions.toLocaleString()`
  - `ctrMetrics.clicks` (stored but not displayed in table)

---

## 2. Data Flow: Component → API → Database

### Step 1: Data Retrieval Function
**File:** `audit-dashboard.html`  
**Lines:** 24728-24862

```24728:24862:audit-dashboard.html
    function getCtrMetricsForKeyword(key) {
      try {
        // Get audit data from localStorage using loadAuditResultsSync
        const savedAudit = loadAuditResultsSync();
        if (!savedAudit) {
          debugLog('[CTR Metrics] No saved audit found in localStorage', 'warn');
          return null;
        }
        if (!savedAudit.searchData) {
          debugLog('[CTR Metrics] No searchData in saved audit', 'warn');
          return null;
        }
        if (!savedAudit.searchData.queryPages) {
          debugLog('[CTR Metrics] No queryPages in searchData. Available keys: ' + Object.keys(savedAudit.searchData || {}).join(', '), 'warn');
          return null;
        }

        const queryPages = savedAudit.searchData.queryPages || [];
        // ... matching logic ...
```

**Source:** `savedAudit.searchData.queryPages` from localStorage (cached from last audit run)

### Step 2: Matching Logic
The function attempts three matching strategies (in order):

1. **Exact match:** Keyword + URL (normalized)
   ```24789:24797:audit-dashboard.html
        if (exactMatch && exactMatch.ctr != null && exactMatch.impressions != null) {
          // CTR is stored as percentage (0-100), convert to decimal for consistency
          const ctrDecimal = typeof exactMatch.ctr === 'number' ? (exactMatch.ctr / 100) : parseFloat(exactMatch.ctr) / 100;
          return {
            ctr: ctrDecimal,
            impressions: exactMatch.impressions || 0,
            clicks: exactMatch.clicks || 0
          };
        }
   ```

2. **Keyword-only match:** Aggregate all pages for the keyword
   ```24805:24819:audit-dashboard.html
        if (keywordMatches.length > 0) {
          // Aggregate impressions, clicks, and calculate weighted CTR
          let totalImpressions = 0;
          let totalClicks = 0;
          keywordMatches.forEach(m => {
            totalImpressions += (m.impressions || 0);
            totalClicks += (m.clicks || 0);
          });
          const aggregatedCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;
          
          return {
            ctr: aggregatedCtr,
            impressions: totalImpressions,
            clicks: totalClicks
          };
        }
   ```

3. **URL-only match:** Aggregate all queries for the page
   ```24840:24854:audit-dashboard.html
        if (urlMatches.length > 0) {
          // Aggregate for this URL
          let totalImpressions = 0;
          let totalClicks = 0;
          urlMatches.forEach(m => {
            totalImpressions += (m.impressions || 0);
            totalClicks += (m.clicks || 0);
          });
          const aggregatedCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;
          
          return {
            ctr: aggregatedCtr,
            impressions: totalImpressions,
            clicks: totalClicks
          };
        }
   ```

### Step 3: GSC API Endpoint
**File:** `api/aigeo/gsc-entity-metrics.js`  
**Lines:** 455-480

```455:480:api/aigeo/gsc-entity-metrics.js
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        rowLimit: 10000, // Higher limit for segmentation
      }),
    });
    
    const queryPages = [];
    if (queryPageResponse.ok) {
      const queryPageData = await queryPageResponse.json();
      if (queryPageData.rows && Array.isArray(queryPageData.rows)) {
        queryPageData.rows.forEach(row => {
          queryPages.push({
            query: row.keys[0] || '',
            page: row.keys[1] || '',
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
        });
      }
    }
```

**API:** Google Search Console API  
**Endpoint:** `https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`  
**Method:** POST  
**Dimensions:** `['query', 'page']` (query + page combination)

### Step 4: Date Range Logic
**File:** `api/aigeo/utils.js`  
**Lines:** 12-41

```12:41:api/aigeo/utils.js
export function parseDateRange(req, accountForGSCDelay = false) {
  const { startDate, endDate } = req.query;
  
  // Default to last 30 days if not provided
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date();
  
  if (!startDate) {
    start.setDate(start.getDate() - 30);
  }
  
  // Google Search Console data is typically delayed by 2-3 days
  // If accountForGSCDelay is true, subtract 2 days from endDate to avoid requesting data that doesn't exist yet
  if (accountForGSCDelay && !endDate) {
    end.setDate(end.getDate() - 2);
  }
  
  // Format as YYYY-MM-DD
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}
```

**Default Date Range:** Last 30 days (rolling, not fixed)  
**GSC Delay Handling:** Optional 2-day offset if `accountForGSCDelay = true`

### Step 5: Storage
**File:** `audit-dashboard.html`  
**Lines:** 6032-6036

```6032:6036:audit-dashboard.html
          // Truncate queryPages if too large
          if (searchData?.queryPages && Array.isArray(searchData.queryPages) && searchData.queryPages.length > 2000) {
            debugLog(`⚠ Truncating queryPages from ${searchData.queryPages.length} to 2000 items`, 'warn');
            searchData.queryPages = searchData.queryPages.slice(0, 2000);
          }
```

**Storage Location:**
- **Primary:** localStorage (via `saveAuditResults()`)
- **Secondary:** Supabase `audit_results` table (JSON blob in `search_data.queryPages`)
- **Note:** If `queryPages` exceeds 2000 items, it's truncated to 2000

---

## 3. Source: GSC vs DataForSEO

### ✅ Google Search Console (GSC) - CONFIRMED

**Evidence:**
1. **API Endpoint:** `api/aigeo/gsc-entity-metrics.js` uses GSC API
   ```60:60:api/aigeo/gsc-entity-metrics.js
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
   ```

2. **Request Parameters:**
   - **Dimensions:** `['query', 'page']` (query + page combination)
   - **Date Range:** Last 30 days (default)
   - **Row Limit:** 10,000
   - **No filters:** Country/device not filtered (site-wide data)

3. **Response Mapping:**
   ```470:477:api/aigeo/gsc-entity-metrics.js
          queryPages.push({
            query: row.keys[0] || '',
            page: row.keys[1] || '',
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
   ```

### ❌ DataForSEO - NOT USED

**Evidence:** No DataForSEO API calls found for CTR/impressions. DataForSEO is only used for:
- Search volume (monthly average)
- SERP features detection
- Ranking positions (SERP snapshot)

---

## 4. Metric Definition: Keyword vs Keyword+Page

### ✅ Keyword + Page Dimension (query + page)

**Evidence:**
1. **GSC API Request:**
   ```460:460:api/aigeo/gsc-entity-metrics.js
        dimensions: ['query', 'page'],
   ```

2. **Matching Logic Priority:**
   - **First:** Exact match on keyword + URL (query + page)
   - **Second:** Keyword-only aggregate (fallback)
   - **Third:** URL-only aggregate (fallback)

3. **What This Means:**
   - **Primary:** CTR/Impressions are tied to **both** the keyword AND the Classic Ranking URL (page)
   - **Fallback:** If no exact match, aggregates all pages for the keyword OR all queries for the page
   - **Not site-wide:** Data is specific to query+page combinations

### Example: "beginners photography class"

For keyword "beginners photography class" with URL "https://www.alanranger.com/beginners-photography-lessons/":

1. **First attempt:** Match exact query+page combination from `queryPages` array
2. **If not found:** Aggregate all pages that rank for "beginners photography class"
3. **If still not found:** Aggregate all queries that rank on "/beginners-photography-lessons/"

---

## 5. CTR Calculation Formula

### Formula
```javascript
CTR = (clicks / impressions) * 100
```

### Data Flow
1. **GSC API returns:** `ctr` as decimal (0-1), e.g., 0.125 = 12.5%
2. **Storage:** Converted to percentage (0-100), e.g., 12.5
   ```475:475:api/aigeo/gsc-entity-metrics.js
            ctr: row.ctr ? row.ctr * 100 : 0,
   ```
3. **Retrieval:** Converted back to decimal (0-1) for consistency
   ```24791:24791:audit-dashboard.html
          const ctrDecimal = typeof exactMatch.ctr === 'number' ? (exactMatch.ctr / 100) : parseFloat(exactMatch.ctr) / 100;
   ```
4. **Display:** Converted to percentage for UI
   ```26300:26300:audit-dashboard.html
          const ctrPercent = (ctrMetrics.ctr * 100).toFixed(2);
   ```

### Sanity Check
**Example:** CTR 12.50% with Impressions 16
- **Expected clicks:** 16 * 0.125 = 2 clicks
- **Formula verification:** 2 / 16 = 0.125 = 12.5% ✅

---

## 6. Fallback/Placeholder Behavior

### When No Data Available
**File:** `audit-dashboard.html`  
**Lines:** 26303-26306

```26303:26306:audit-dashboard.html
        } else {
          tdCtr.textContent = "—";
          tdCtr.style.color = '#94a3b8';
        }
```

**Behavior:**
- **Display:** "—" (em dash)
- **Color:** Gray (`#94a3b8`)
- **No placeholder values:** No constants, no rank-based proxies, no "not wired" copy

### No Proxy/Placeholder Found
- ✅ No hardcoded CTR values
- ✅ No rank-based CTR estimation
- ✅ No "CTR not wired" UI copy
- ✅ Returns `null` if no match found

---

## 7. Summary

### Source of Truth
**✅ Google Search Console (GSC) API**

### Exact Field Names
- **Storage:** `searchData.queryPages[]` array
- **Fields per item:** `{ query, page, clicks, impressions, ctr, position }`
- **CTR format:** Percentage (0-100) in storage, decimal (0-1) in function return

### Date Range
- **Default:** Last 30 days (rolling)
- **Logic:** `startDate = today - 30 days`, `endDate = today`
- **GSC Delay:** Optional 2-day offset available but not used by default

### Definition
- **Primary:** Keyword + Page dimension (query + page combination)
- **Fallback 1:** Keyword-only aggregate (all pages for keyword)
- **Fallback 2:** URL-only aggregate (all queries for page)
- **Not:** Site-wide query aggregated

### Filters Applied
- **Dimensions:** `['query', 'page']` (no country/device filter)
- **Row Limit:** 10,000
- **No country filter:** Site-wide data (all countries)
- **No device filter:** All devices combined

### Contradictions
- ✅ **None found:** UI correctly shows "CTR (last 30 days)" and data is from GSC
- ✅ **No proxy claims:** No UI copy claiming placeholder/proxy data
- ✅ **Real data:** All CTR/impressions come from GSC API

### Quick Sanity Check
**CTR 12.50% with Impressions 16:**
- **Clicks = 2** (16 * 0.125 = 2)
- **Formula:** `ctr = clicks / impressions` ✅
- **Stored:** Yes, `clicks` field exists in `queryPages` array
- **Displayed:** No, clicks not shown in table (only CTR % and Impressions)

---

## 8. Code References

### Key Files
1. **UI Rendering:** `audit-dashboard.html` lines 26295-26307, 26768-26770
2. **Data Retrieval:** `audit-dashboard.html` lines 24728-24862
3. **GSC API:** `api/aigeo/gsc-entity-metrics.js` lines 455-480
4. **Date Range:** `api/aigeo/utils.js` lines 12-41

### Key Functions
- `getCtrMetricsForKeyword(key)` - Retrieves CTR metrics from cached audit data
- `loadAuditResultsSync()` - Loads audit data from localStorage
- `parseDateRange(req)` - Calculates date range (default: last 30 days)

---

**Report Complete**
























