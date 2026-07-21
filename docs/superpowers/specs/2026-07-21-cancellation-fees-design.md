# Per-service cancellation fees — design

**Date:** 2026-07-21
**Status:** Approved

## Problem

Sitters have no way to define or assess a cancellation fee. Pawbook tracks money
but never collects it, so a cancellation fee here is a quote/ledger concept: the
sitter configures a policy per service, the fee is computed at cancel time, and
it flows into the existing payments/balance tracking as an amount owed.

## Decisions (from brainstorming)

- **Behavior:** compute + record the fee at cancel time, and surface it in the
  money ledger (balance/earnings), not just on the booking row.
- **Shape:** tiered schedule per service (e.g. 100% within 2 days of start, 50%
  within 7 days, free otherwise).
- **Trigger:** sitter chooses charge/waive when cancelling a confirmed booking.
  Declines never charge. No customer self-cancel endpoint (none exists today).
- **Disclosure:** the booking widget shows the policy before booking and shows
  any assessed fee on the customer's cancelled bookings.

## Data model

Migration `migrations/0016_cancellation_fees.sql`, with `sql/schema.sql` updated
in lockstep (both nullable — NULL = none, per the existing convention):

- `TenantServices.CancellationTiers TEXT` — JSON array, e.g.
  `[{"withinDays": 2, "percent": 100}, {"withinDays": 7, "percent": 50}]`.
  NULL = service has no cancellation fee. Follows the `Questions` JSON-column
  precedent; no child table.
- `BookingRequests.CancellationFee INTEGER` — whole dollars (matching
  `EstCost`). NULL = no fee assessed.

## Shared pure core

New `src/shared/pricing/cancellation-fee.ts` (zero runtime deps, like the rest
of `src/shared/`):

- `cancellationFee(tiers, estCost, startDate, cancelDate): number` — days until
  start via the existing `src/shared/util/dates.ts` math (tenant timezone);
  tightest tier whose `withinDays` covers the gap wins;
  returns `Math.round(estCost * percent / 100)`; 0 when outside every tier.
  A cancellation on or after the start date counts as `withinDays = 0`.
- `validateCancellationTiers(value)` — must be an array of 1–5 objects with
  integer `withinDays >= 0` strictly increasing and integer `percent` 1–100.
  Invalid input rejects the whole service save.

Server enforces these; the widget mirrors them for display, same as the rest of
the booking engine.

## Server

- `POST /:slug/admin/services` (`server/routes/admin.ts`): validate
  `CancellationTiers` with the shared validator before persisting.
- Status endpoint `POST /:slug/admin/bookings/:id/status` (`admin.ts:1019`):
  accepts optional `chargeFee: true`. Honored only when **all** hold:
  target status is `cancelled` (never `declined`), the booking is currently
  `confirmed`, the service has tiers, and the booking has `EstCost`. The fee is
  computed server-side (client-sent amounts never trusted) and stored in
  `BookingRequests.CancellationFee` in the same repo call that cancels.
  `chargeFee` on an ineligible request → 400.
- Payment guard (`server/db/repo.ts:610`): cancelled bookings currently refuse
  all payments. New rule: refuse unless the booking has a non-null
  `CancellationFee`, in which case payments are accepted up to the fee.
- Ledger: wherever balance/earnings compare payments to an expected amount, a
  cancelled booking's expected amount is `CancellationFee` (0 if NULL) instead
  of `EstCost`. That substitution is the full-ledger behavior — no new tables.
- Customer API: booking payloads include `CancellationFee`; the public
  tenant/services payload includes `CancellationTiers` for policy display.

## Admin UI

- `app/admin/sections/ServiceEditor.tsx`: tier list editor — rows of
  "within N days → P%", add/remove, max 5. Empty list saves as NULL.
- `app/admin/sections/BookingsSection.tsx`: when cancelling a confirmed booking
  on a service with tiers, show the computed fee and a charge/waive choice
  before confirming. Decline flow unchanged.
- Earnings/balance views show fee-owed on cancelled bookings with a fee.

## Widget

- `app/embed/BookTab.tsx`: when the selected service has tiers, render a
  one-line policy, e.g. "Cancellation: 100% within 2 days, 50% within 7 days".
- `app/embed/MineTab.tsx`: cancelled bookings with a fee show
  "Cancellation fee: $X".

## Error handling & edges

- Invalid tiers → 400 on service save.
- `chargeFee` when ineligible → 400 (explicit, not silently ignored).
- Fee is set only at cancel time and is immutable afterward. Correcting a
  mistaken charge is out of scope for v1 — the sitter just doesn't record
  payments against it.
- Fee of $0 (tiers exist but cancel is outside every window): store NULL, not 0
  — nothing owed, booking behaves like any other cancellation.

## Testing

- Unit tests for `cancellation-fee.ts`: tier boundary days, first-match
  ordering, rounding, empty/NULL tiers, same-day and past-start cancels,
  validator accept/reject cases.
- Server tests via `createTestEnv()` (real SQLite + real `sql/schema.sql`):
  charge flow stores the fee; waive stores nothing; decline never charges;
  ineligible `chargeFee` → 400; payment guard accepts payments up to the fee on
  a fee-bearing cancelled booking and still refuses on fee-less ones; tenant
  isolation on the new column reads.
