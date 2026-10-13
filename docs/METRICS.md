# Metric definitions

Implemented in `src/server/domain/pipeline.ts` and `src/server/services/metrics.ts`, and covered by unit and integration tests. All figures respect the viewer's record scope.

| Metric | Definition |
| --- | --- |
| Amount / TCV | `opportunities.amount` is always the total contract value in the deal's own currency. |
| ARR | Recurring deals with a contract term: `TCV / contract_months × 12`. Recurring deals without a term show ARR as **unknown** (never estimated). One-time deals have ARR = 0. |
| Effective probability | `probability_override` if set, otherwise the stage probability; clamped to 0–100. |
| Open pipeline | Σ amount of non-archived opportunities in stages of category `open`. |
| Weighted pipeline | Σ amount × effective probability ÷ 100 over open pipeline. |
| Closed-won (bookings) | Σ amount of opportunities in a `won` stage whose `closed_at` falls in the period. **Not** recognised revenue and **not** cash collected; neither is tracked yet. |
| Win rate | count(won) ÷ count(won + lost), for deals closed in the period. |
| Average deal size | Closed-won ÷ won count (hidden if any won deal lacks an FX rate). |
| Sales cycle | Mean days from `created_at` to `closed_at` for deals won in the period. |
| Forecast category | Set per deal, or derived from the stage: won → closed; lost → omitted; ≥75% → commit; ≥40% → best case; otherwise pipeline. |
| New leads | Leads created in the period (archived excluded). |
| Lead → converted | Leads created in the period that have since been converted. A cohort measure, not a same-period measure. |
| Stale lead | Open-status lead whose last contact (or creation) is older than the tenant's `staleLeadDays`. |
| Stalled deal | Open deal with no activity or stage change for `staleOpportunityDays`. |
| Currency | Converted to the tenant base currency with administrator-maintained rates. Deals in currencies without a rate are **excluded and counted** ("unconverted"), never summed raw. |
| Period boundaries | UTC calendar quarters and years: `[from, to)`. |
