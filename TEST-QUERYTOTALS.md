# queryTotals Test Script

This test script verifies that `queryTotals` are being saved and retrieved correctly from Supabase.

## What It Tests

1. **Fetches queryTotals** - Uses the same `/api/aigeo/gsc-entity-metrics` endpoint as the UI
2. **Saves to Supabase** - Uses the same `/api/supabase/save-audit` endpoint as the UI
3. **Verifies in Supabase** - Queries Supabase to confirm the data was saved correctly

## Prerequisites

- Node.js 18+ (for native `fetch` support)
- Environment variables set (or the app running locally/on Vercel)
- A valid property URL with GSC data

## Usage

### Option 1: Run against local server

```bash
# Start your local server first (if running locally)
# Then run:
LOCAL_URL=http://localhost:3000 TEST_PROPERTY_URL=https://your-site.com npm run test:querytotals
```

### Option 2: Run against Vercel deployment

```bash
# Set your Vercel URL
VERCEL_URL=your-app.vercel.app TEST_PROPERTY_URL=https://your-site.com npm run test:querytotals
```

### Option 3: Direct node execution

```bash
node test-querytotals.js
```

## Configuration

You can customize the test by setting environment variables:

- `TEST_PROPERTY_URL` - The property URL to test (default: `https://alanranger.com`)
- `TEST_DAYS` - Number of days for GSC data (default: 28)
- `BASE_URL` / `VERCEL_URL` / `LOCAL_URL` - The base URL of your API

The test uses 5 sample keywords by default:
- photography workshops
- camera training
- photo editing
- photography courses
- camera lessons

## Expected Output

```
============================================================
queryTotals Save/Retrieve Test
============================================================

[Step 1] Fetching queryTotals for 5 keywords...
✓ Fetched X queryTotals from GSC API

[Step 2] Saving queryTotals to Supabase...
✓ Saved queryTotals to Supabase successfully

[Step 3] Verifying queryTotals in Supabase...
✓ Verified queryTotals in Supabase: X items
✓ All required fields present in queryTotals

============================================================
✓ TEST PASSED: queryTotals saved and retrieved correctly!
============================================================
```

## Troubleshooting

### "No queryTotals returned from API"
- This is normal if the test keywords don't have GSC data
- The test will continue to verify the save/retrieve flow

### "queryTotals is missing from searchData"
- Check that the save endpoint is working correctly
- Verify the partial update logic is functioning

### "queryTotals is not an array"
- This indicates a data structure issue
- Check the save endpoint's handling of queryTotals

## What This Verifies

✅ The GSC API endpoint returns queryTotals correctly  
✅ The save endpoint accepts and processes queryTotals  
✅ The partial update logic only updates query_totals (doesn't overwrite other fields)  
✅ The get endpoint retrieves queryTotals correctly  
✅ The data structure is preserved (array format, required fields)

