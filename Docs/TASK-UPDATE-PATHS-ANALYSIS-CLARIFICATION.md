# Task Update Paths Analysis - Clarification (2026-02-01)

This is a companion note to `TASK-UPDATE-PATHS-ANALYSIS.md`.
That file appears to be UTF-16 encoded and shows garbled characters if opened as UTF-8.
To avoid corrupting it, this note captures the plain-English clarification here.

## Plain-English Clarification

- URL task metrics use page-level totals (all queries for the page).
- Keyword task metrics use query-level totals (one keyword only).
- These are different slices of GSC and are not expected to match 1:1.
- Optimisation baseline/latest are snapshots captured at the time of Add Measurement/Rebaseline,
  not recalculated later.
