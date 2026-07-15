-- 012: widen daily_volume.avg_price to bigint.
--
-- 007 created it as int. Silver prices for high-tier items exceed int range
-- (2,147,483,647), so an avg_price write can overflow and error.
--
-- This MUST be its own migration, not an edit to 007: on any database where 007 has
-- already run, `add column if not exists` is a no-op and would silently leave the
-- column as int while the file claimed bigint. alter ... type changes it for real.
-- Idempotent — re-running against a bigint column is a no-op in Postgres.

alter table daily_volume alter column avg_price type bigint;
