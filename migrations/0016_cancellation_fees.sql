-- 0016_cancellation_fees.sql
-- Spec: docs/superpowers/specs/2026-07-21-cancellation-fees-design.md
--
-- Per-service tiered cancellation policy + per-booking assessed fee.
-- NULL = no policy / no fee assessed, matching the nullable-column convention.
--
-- NOT IDEMPOTENT — apply exactly once per database (wrangler's runner is transactional).
-- Apply with:
--   npx wrangler d1 execute pawbook-db --local  --file ./migrations/0016_cancellation_fees.sql
--   npx wrangler d1 execute pawbook-db --remote --file ./migrations/0016_cancellation_fees.sql

-- 1) Tiered policy per service: JSON array like
--    [{"withinDays":2,"percent":100},{"withinDays":7,"percent":50}]. NULL = no fee.
ALTER TABLE TenantServices ADD COLUMN CancellationTiers TEXT;

-- 2) Fee assessed at cancel time, whole dollars (matches EstCost). NULL = none assessed.
ALTER TABLE BookingRequests ADD COLUMN CancellationFee INTEGER;
