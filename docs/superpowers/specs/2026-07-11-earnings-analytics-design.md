# Earnings analytics: payment tracking + dashboard — design

**Date:** 2026-07-11
**Status:** Draft (pending subagent review + user approval)
**Branch target:** off `custom-services`

## Problem

Sitters have no view of the money side of their business. The only
money-shaped data in the schema is `BookingRequests.EstCost` (an INTEGER
whole-dollar *estimate* computed at booking time) and per-option `Rate` on
`TenantServiceOptions`. There is no record of what was actually paid, no
paid/unpaid state, no payment processor, and no reporting of any kind — the
admin app (`app/admin/App.tsx`) has sections for bookings, clients, services,
etc., but nothing that aggregates.

User decision during brainstorming: build **real payment tracking** (not
EstCost-only pseudo-revenue, not a Stripe integration), then build analytics
on recorded payments. A booking can have **multiple payment records**
(deposits, partial payments); outstanding balance = `EstCost` minus payments
recorded so far.

## Goals

1. A sitter can record payments against a booking (amount, method, date,
   optional note), and delete a mistakenly-entered one.
2. A new **Earnings** section in the admin dashboard shows:
   - Stat tiles: revenue this month, revenue last month, total outstanding,
     count of unpaid/partially-paid confirmed bookings.
   - **Revenue over time**: monthly bar chart of the last 12 months of
     recorded payments.
   - **Breakdown by service**: revenue per service (horizontal bars).
   - **Top clients**: highest-spending clients by recorded payments, with
     booking counts.
   - **Outstanding balances**: confirmed bookings not yet fully paid — who
     owes what — with an inline "record payment" action.
3. The Bookings section shows each booking's payment state (paid total vs
   `EstCost`) and offers the same record-payment action, so a sitter can log
   a payment at the moment they confirm a booking.
4. All aggregation happens server-side in SQL (D1/SQLite `GROUP BY`); the
   client renders one JSON payload.

## Non-goals

- **Payment processing.** No Stripe/PayPal APIs — sitters collect money
  however they already do (cash, Venmo, Zelle…) and record it here. The
  `Method` column keeps the door open for a processor later.
- **Cents.** Amounts are INTEGER whole dollars, matching `EstCost` and
  `Rate`. The rest of the schema is whole-dollar; introducing cents only for
  payments would poison every aggregate with unit ambiguity.
- **Invoicing/receipts.** No PDFs, no emails to clients about payments.
- **Charting library.** Charts are hand-rolled SVG/CSS — a 12-bar monthly
  chart is ~30 lines of JSX, and the repo's only runtime deps are
  hono/react/react-dom. Revisit if charts multiply or need
  tooltips/zoom/legends.
- **Date-range pickers / custom periods.** Fixed windows for v1: last 12
  months for the time chart, all-time for service/client breakdowns.
  Add filtering when a real sitter asks for it.
- **Expense tracking.** "Spending" for a sitter's business (supplies, gas)
  is a different feature; this is revenue-in only.

## Alternatives considered

**EstCost-only analytics (no payment tracking)** — zero schema change, but
every number would be an estimate of money that may never have arrived, and
"outstanding balances" would be impossible. Rejected by user during
brainstorming.

**Single paid/unpaid flag on BookingRequests** — one column instead of a
table, but cannot represent deposits or partial payments, which are the norm
for multi-hundred-dollar boarding stays. Rejected by user in favor of a
Payments table.

**Charting library (recharts et al.)** — ~100 kB+ into the admin bundle for
four static bar charts. Rejected; hand-rolled SVG.

## Design

### 1. Schema

New migration `migrations/0008_payments.sql` (+ `sql/schema.sql` updated in
lockstep):

```sql
CREATE TABLE IF NOT EXISTS Payments (
  Id TEXT PRIMARY KEY,
  TenantId TEXT NOT NULL REFERENCES Tenants(Id),
  BookingRequestId TEXT NOT NULL REFERENCES BookingRequests(Id),
  Amount INTEGER NOT NULL CHECK (Amount > 0), -- whole dollars, matching EstCost/Rate
  Method TEXT NOT NULL CHECK (Method IN ('cash', 'venmo', 'zelle', 'paypal', 'check', 'card', 'other')),
  PaidDate TEXT NOT NULL, -- 'YYYY-MM-DD', sitter-entered (defaults to today in the UI)
  Note TEXT,
  CreatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_Payments_Tenant_Date ON Payments (TenantId, PaidDate);
CREATE INDEX IF NOT EXISTS idx_Payments_Tenant_Booking ON Payments (TenantId, BookingRequestId);
```

Follows the Model A invariant (TenantId on every table). `PaidDate` is a
plain date the sitter types/accepts, not a server timestamp — payments are
often recorded days after they happen, and monthly grouping should follow
the sitter's stated date, not insertion time.

### 2. Repo layer (`server/db/repo.ts`)

New functions, all tenant-scoped like every existing query:

- `insertPayment(db, { tenantId, bookingRequestId, amount, method, paidDate, note })`
  — inserts iff the booking exists for this tenant, is not `ServiceType='blocked'`,
  and is not cancelled (guard in the `WHERE`/subquery, same atomic-guard
  idiom as `updateBookingStatus`). Returns the row or null.
- `deletePayment(db, tenantId, paymentId)` — returns whether a row changed
  (route 404s on false, the existing idiom).
- `listPaymentsForBookings(db, tenantId, bookingIds)` — payments grouped by
  booking, for the Bookings section's paid-total display. In practice
  implemented as a `PaidTotal` aggregate added to `listBookingsForTenant`
  via `LEFT JOIN (SELECT BookingRequestId, SUM(Amount) ...)` — one query,
  no N+1.
- `getAnalytics(db, tenantId)` — runs the four aggregate queries and
  returns one object:
  - **monthly**: `SELECT substr(PaidDate,1,7) AS Month, SUM(Amount) ... GROUP BY Month`
    over the last 12 months (missing months filled to 0 in JS).
  - **byService**: payments joined to `BookingRequests.ServiceType`, joined
    to `TenantServices.Label` for display names, `GROUP BY ServiceType`,
    all-time. Services deleted since payment keep the raw slug as label
    (LEFT JOIN, `COALESCE(Label, ServiceType)`).
  - **topClients**: payments joined through bookings to `EndUsers`,
    `GROUP BY EndUserId`, `SUM(Amount)` + `COUNT(DISTINCT BookingRequestId)`,
    ordered by total desc, `LIMIT 10`.
  - **outstanding**: confirmed bookings where
    `COALESCE(paid.Total, 0) < EstCost`, with customer name/email, EstCost,
    paid total, ordered by balance desc. Rows with `EstCost IS NULL` are
    excluded — a booking with no estimate can't have a computable balance.
  - **tiles**: this-month / last-month revenue derived from **monthly** in
    JS; outstanding total + count derived from **outstanding** in JS. No
    extra queries.

### 3. Admin routes (`server/routes/admin.ts`)

Added to the existing chained Hono app (same `adminAuth` + tenant middleware
stack as every other `/:slug/admin/*` route):

- `GET /:slug/admin/analytics` — returns `getAnalytics` payload verbatim.
- `POST /:slug/admin/bookings/:id/payments` — body
  `{ amount, method, paidDate, note? }`. Validates: amount is a positive
  integer (reuse the defensive-validation style at the top of the file),
  method is one of the allowed set, paidDate matches `YYYY-MM-DD`. 404 if
  `insertPayment` refuses (wrong tenant / blocked / cancelled). Returns the
  created payment plus the booking's new paid total.
- `DELETE /:slug/admin/bookings/:id/payments/:paymentId` — 404 if nothing
  deleted.

No KV caching on the analytics endpoint — it's a handful of indexed
aggregates over a prototype-scale D1; add caching only if it measurably
drags.

### 4. Frontend

- **`app/admin/sections/EarningsSection.tsx`** (new) — fetches
  `adminApi.analytics.get` on mount; renders stat tiles, the 12-month SVG
  bar chart, by-service horizontal bars, top-clients table, and the
  outstanding table with an inline record-payment form (amount, method
  select, date defaulting to today, note). Recording a payment re-fetches
  the payload. Empty states ("No payments recorded yet") for a brand-new
  tenant.
- **`app/admin/sections/BookingsSection.tsx`** — each non-blocked,
  non-cancelled booking row additionally shows `paid $X of $Y` (or
  `paid in full`) from the new `paidTotal` field, plus a "Record payment"
  action opening the same small form. The form component is shared:
  **`app/admin/RecordPaymentForm.tsx`**, imported by both sections.
- **`app/shared-ui/api.ts`** — `AnalyticsPayload`, `Payment` types;
  `adminApi.analytics.get` and `adminApi.payments.record/remove`;
  `AdminBooking` gains `paidTotal`.
- **`app/admin/App.tsx`** — `'earnings'` added to the `SectionKey` union,
  `SECTIONS` array (icon: an existing icon component or a small new one in
  the same style), and the `panels` record.
- Charts follow the admin app's existing visual language (accent color from
  tenant settings where the UI already does that); axis labels are plain
  text, no interactivity.

## Error handling

- Payment validation failures → 400 with a message, same shape as existing
  admin validation errors.
- Recording against a cancelled/blocked/foreign booking → 404 (repo guard
  returns null/false), matching the "row didn't change → not found" idiom.
- Analytics endpoint has no partial-failure mode: it's read-only SELECTs;
  any D1 error surfaces as the standard 500.
- Frontend: fetch errors in EarningsSection render the section's error
  message pattern used by other sections (whatever BookingsSection does on
  load failure).

## Testing

Per-concern test files, mirroring the existing convention:

- `server/__tests__/payments-repo.test.ts` — `insertPayment` guards
  (cancelled booking refused, blocked row refused, cross-tenant refused,
  happy path), `deletePayment` tenant scoping, paid-total aggregation on
  `listBookingsForTenant`.
- `server/__tests__/analytics.test.ts` — seed a tenant with bookings +
  payments and assert each aggregate: monthly buckets (including
  zero-filled months), by-service totals (including a deleted-service slug
  fallback), top-client ordering and booking counts, outstanding math
  (partial payment → correct balance; EstCost NULL excluded; fully-paid
  excluded; cancelled excluded), and route-level validation (bad amount,
  bad method, bad date → 400; foreign booking → 404).
- `server/__tests__/migration-0008.test.ts` — migration applies cleanly on
  a 0007-state DB, per the existing migration-test pattern.
