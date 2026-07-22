-- Capacity is always pets (spec: 2026-07-22-pets-capacity-units-design.md). Every capacity limit is
-- now expressed and enforced in PETS. The house-sit cap — historically MaxPerDay (bookings per day)
-- — folds into MaxConcurrentPets (pets per day) so BOTH pool kinds read a single column.
--
-- MaxPerDay is RETIRED IN PLACE (the 0015 precedent): the column stays so schema.sql, the local DB,
-- and the remote DB keep the exact same shape, but after this migration no code reads or writes it.
-- A future cleanup migration may drop it. NULL stays NULL (= unlimited). Reinterpreting a house-sit
-- cap of N bookings as N pets only TIGHTENS capacity, never loosens it — the owner's stated intent.
-- Production risk is nil: only the two seeded demo tenants exist and both leave the house-sit cap NULL.
--
-- COALESCE prefers an existing MaxConcurrentPets, so a re-run is a no-op on already-copied rows.
-- Still: apply exactly once, and only via `wrangler d1 execute --file` (below). Write a new
-- migration rather than re-running.
--
-- Apply with:
--   npx wrangler d1 execute pawbook-db --local  --file ./migrations/0017_pets_capacity_units.sql
--   npx wrangler d1 execute pawbook-db --remote --file ./migrations/0017_pets_capacity_units.sql

UPDATE TenantServices
SET MaxConcurrentPets = COALESCE(MaxConcurrentPets, MaxPerDay)
WHERE CapacityKind = 'housesit';
