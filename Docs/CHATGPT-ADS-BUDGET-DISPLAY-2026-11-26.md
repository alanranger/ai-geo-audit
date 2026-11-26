# ChatGPT Ads budget and bid display — 26 November 2026

Alan requested correction of the Marketing display after the Academy test exposed daily-only budget and legacy fixed-bid assumptions.

The shared card model now returns daily or lifetime budget labels and reads native Target CPC / Target CPA amounts, with an explicit average-cost label. Paused campaigns retain the same budget/bid information as active campaigns. Missing values remain unavailable.

Marketing and Strategy use those labels without appending an unconditional /day or max CPC. The gift campaign alone carries the £100 net / 115-click daily monitoring checks. A lifetime campaign shows its own provider total cap. Remaining amounts use the whole-flight provider totals, so changing the date filter cannot reset the remaining budget.

This changes reporting only: no provider budgets, bids, status, dates or tracking code are changed. Academy remains paused for the separately recorded tracking failure.

Validation: existing Ads tests plus paused lifetime/Target CPC, Gift-only stop scope and missing-value regression cases; browser rendering checks for both campaign selections and date-filter behaviour.
