# Academy funnel page rewrites — May 2026

Companion to `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md`. Each `.html` file in
this folder is a **ready-to-paste Squarespace Code Block** for the page named
in its filename. Squarespace chrome (site nav, footer, login modal) is
untouched — these blocks are intended to replace only the page-body content.

## How to apply

1. In Squarespace, open the page editor for the target URL.
2. Locate the existing **Code Block** or **Markdown block** that contains the
   current hero / value / CTA copy.
3. Replace its contents with the corresponding `.html` file below.
4. Preview, then publish.

## Files

| File | Page | Status |
|---|---|---|
| `01-trial-expired.html` | `/academy/trial-expired` | **DEPRECATED** (2026-05-19) — superseded by the patched dashboard modal in `Academy/alanranger-academy-assesment/academy-dashboard-squarespace-snippet-v1.html`. Do not deploy. See file header and `CHANGELOG.md` for the full reason. |
| `02-free-online-photography-course.html` | `/free-online-photography-course` | Active **v3** — canonical lead-magnet page. Adds Course + FAQPage JSON-LD, author trust block, YouTube comparison table, six-question FAQ, three CTAs. Targets the AIO citation gap documented in `ACADEMY_FUNNEL_INVESTIGATION_2026-05.md`. |
| `03-free-photography-course.html` | `/free-photography-course` | **Stub (v3)** — page is 301-redirected to `/free-online-photography-course` (Alan applied the redirect on 2026-05-19). File kept as a minimal working CTA stub on the underlying Squarespace page in case the URL Mapping is ever removed. See `CANONICAL-DECISION.md`. |
| `04-academy-login.html` | `/academy/login` | Active — gate-page CTA hierarchy fix |

### `/academy/trial-expired` deployment (replaces the deprecated `01` rewrite)

Add a Squarespace URL Mapping at *Pages → Not Linked → settings (cog) → Advanced → URL Mappings*:

```
/academy/trial-expired -> /academy/dashboard 301
```

That hops members straight through to the patched dashboard modal. The
underlying Squarespace page can stay live for now (Memberstack's
gated-content redirect on the Trial plan still routes through it); the
301 just sits in front of it for direct hits.

## Pricing rules (per user clarification, 2026-05-19)

- **Pre-trial pages**: show £79/year only. We want full-price sign-ups.
- **Post-trial only**: SAVE20 → £59 first year, applied at re-activation
  within 7 days of trial expiry. The code is auto-applied at checkout.
- Trial-expired page IS the only public surface that mentions SAVE20.
  Post-expiry rewind emails (day+7, day+20, day+30, day+60) are the
  other surface.

## Squarespace + Memberstack notes (important)

The site uses **Memberstack v2** (loaded site-wide via Squarespace Code
Injection — labelled "ARP | Memberstack v2 — single install, editor-safe,
SITE-WIDE"). The Memberstack runtime watches the DOM for elements with
`data-ms-*` attributes and wires up click handlers automatically. That
is the *only* working route into the Stripe checkout — plain `href` links
to `/academy/login` will NOT trigger checkout for users whose trial has
expired.

The four button mechanics used across these rewrites:

| Attribute | Effect |
|---|---|
| `data-ms-modal="login"` | Opens the Memberstack **login** modal in-place |
| `data-ms-modal="signup"` + `data-ms-price:add="<price_id>"` | Opens the Memberstack **signup** modal AND attaches the given Stripe price so checkout happens from the modal |
| `id="arp-upgrade-checkout-btn"` | Picked up by Alan's site-wide JS to drive the **expired-trial reactivation** checkout (used on `/academy/upgrade` and on the new `/academy/trial-expired` block) |
| `id="arp-buy-annual"` + `data-ms-price="add"` + `data-ms-price-id="..."` | Legacy pattern on the old `/academy/trial-expired` page. Not used in v2 of these rewrites — the `#arp-upgrade-checkout-btn` flow handles expired trials end-to-end. |

Stripe price IDs (do not change):
- `prc_30-day-free-trial-mg18p0u9z` — trial (legacy-named; actual
  duration is **14 days**, enforced dynamically by
  `academy_config` in Supabase + `lib/academyTrial...`).
- `prc_annual-membership-jj7y0h89` — annual £79/yr. The SAVE20 promo
  applies automatically at Stripe checkout for users within 7 days of
  trial expiry (no manual code entry).

Page-level button IDs that must survive any edit (site JS depends on
them):
- `arp-academy-login` (outer `<div>` on `/academy/login`)
- `arpLoginBtn`, `arpTrialBtn`, `arpAnnualBtn` (on `/academy/login`)
- `arp-upgrade-checkout-btn` (on `/academy/upgrade` and on
  `/academy/trial-expired` v3)

If you ever need to reproduce the upgrade flow on a new page, copy the
button block from `01-trial-expired.html` verbatim — the IDs are what
makes the JS find and wire the click handler.

- `data-cta` attributes are added to every CTA so we can wire up
  GA4 / Plausible click tracking later without touching markup again.

## Validation checklist after pasting

For each page:

- [ ] Pricing is visible above the fold without scrolling
- [ ] One single primary CTA per page section
- [ ] FUD checkout warning appears AFTER the CTA, not before
- [ ] No duplicate sign-up form (newsletter form removed or relabelled)
- [ ] Page renders on mobile (max-width 768px) without horizontal scroll
- [ ] `data-cta` attributes are present on every Join / Start Trial / Reactivate button
