# Fix: Raw Code Displaying in Money Pages UI

## Issue
Raw JavaScript code is showing in the Money Pages UI instead of the rendered table. This happens when `renderMoneyPagesTable` is not properly defined, returns an unexpected value, or throws an error that displays code.

## Root Cause
Multiple places in the code call `renderMoneyPagesTable` without proper error handling. If the function:
- Is not defined
- Returns a non-string value
- Throws an error that gets displayed

Then code or error messages can appear in the UI.

## Fix Applied

### 1. Added Safe Wrapper Function
Added `window.safeRenderMoneyPagesTable` that:
- Checks if `renderMoneyPagesTable` is a function
- Validates the return value is a string
- Catches errors and returns safe HTML error messages
- Prevents code from being displayed in the UI

**Location**: After `window.renderMoneyPagesTable = renderMoneyPagesTable;` assignments (lines ~33755 and ~61990)

### 2. Update All Direct Calls
All places that call `renderMoneyPagesTable` directly should be updated to:
1. Use `window.safeRenderMoneyPagesTable` if available, OR
2. Add proper error handling with try/catch
3. Validate the return value is a string before setting innerHTML

## Places That Need Updating

### Critical Locations (called on page load/tab switch):
1. **Line ~31805**: Sort handler - `tableContainer.innerHTML = await renderMoneyPagesTable(allRows, 1, rowsPerPage);`
2. **Line ~31834**: Rows-per-page change handler
3. **Line ~31860**: Previous page button handler
4. **Line ~31888**: Next page button handler
5. **Line ~17622**: Tab switch handler - `tableContainer.innerHTML = await renderMoneyPagesTable(...)`
6. **Line ~7064**: Task creation handler - `moneyPagesContainer.innerHTML = tableHtml;` (already has validation)
7. **Line ~7141**: Task creation handler - `moneyPagesContainer.innerHTML = tableHtml;` (already has validation)

### Pattern to Use:
```javascript
if (typeof window.safeRenderMoneyPagesTable === 'function') {
  tableContainer.innerHTML = await window.safeRenderMoneyPagesTable(rows, page, rowsPerPage);
} else if (typeof renderMoneyPagesTable === 'function') {
  try {
    const tableHtml = await renderMoneyPagesTable(rows, page, rowsPerPage);
    if (tableHtml && typeof tableHtml === 'string' && tableHtml.trim().length > 0) {
      tableContainer.innerHTML = tableHtml;
    } else {
      console.error('[Money Pages] renderMoneyPagesTable returned invalid result');
      tableContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">Error rendering table.</div>';
    }
  } catch (err) {
    console.error('[Money Pages] Error rendering table:', err);
    tableContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">Error rendering table.</div>';
  }
} else {
  console.error('[Money Pages] renderMoneyPagesTable is not a function');
  tableContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">Table render function not available.</div>';
}
```

## Testing

After applying fixes:
1. Open Money Pages tab
2. Verify table renders correctly (not showing code)
3. Test sorting - should re-render table
4. Test pagination - should re-render table
5. Test rows-per-page change - should re-render table
6. Check browser console for any errors

## Additional Notes

- There are duplicate `renderMoneyPagesTable` function definitions (lines ~29887 and ~58149)
- The safe wrapper function is defined twice (after each assignment to `window.renderMoneyPagesTable`)
- All direct calls should eventually use the safe wrapper for consistency
