-- Adds the brute-force attempt counter to LoginCodes for databases created before the column
-- existed in schema.sql. Fresh databases already have it (CREATE TABLE in schema.sql), so only
-- run this against an already-provisioned DB:
--   npx wrangler d1 execute pawbook-db --local  --file ./migrations/0001_add_login_codes_attempts.sql
--   npx wrangler d1 execute pawbook-db --remote --file ./migrations/0001_add_login_codes_attempts.sql
ALTER TABLE LoginCodes ADD COLUMN Attempts INTEGER NOT NULL DEFAULT 0;
