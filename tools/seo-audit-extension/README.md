# Audit this page (Traditional SEO)

One click on any alanranger.com page opens the AI GEO Audit dashboard on that page's
**All rules for this URL** panel (last saved results from the database), then runs
**Re-audit page**. Results are saved back per page (server-side merge), so the dashboard,
other devices and the Monday job all see the same data.

Squarespace: save/publish your edits first — the audit fetches the live page.

## Option A — Chrome extension (toolbar button)

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → choose this folder (`tools/seo-audit-extension`).
3. Pin **Alan Ranger - Audit this page** to the toolbar.
4. On any alanranger.com page, click the button. It reuses one dashboard tab.

## Option B — Bookmarklet (no install)

Create a bookmark named **Audit this page** with this as the URL:

```text
javascript:(()=>{if(!/(^|\.)alanranger\.com$/i.test(location.hostname)){alert('Open an alanranger.com page first.');return;}window.open('https://ai-geo-audit.vercel.app/audit-dashboard.html?seoPage='+encodeURIComponent(location.origin+location.pathname)+'&reaudit=1','aigeoSeoAudit');})();
```

## Deep link (what both use)

`https://ai-geo-audit.vercel.app/audit-dashboard.html?seoPage=<page URL>&reaudit=1`

Omit `&reaudit=1` to just open the page's saved results without re-auditing.
Only alanranger.com URLs are accepted.
