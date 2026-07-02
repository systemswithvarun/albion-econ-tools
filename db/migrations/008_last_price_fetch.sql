-- Cooldown timestamp for the manual price-fetch button. Written by every successful
-- pull (cron and manual). Manual route refuses to re-pull within 10 min of this.
alter table settings add column if not exists last_price_fetch_at timestamptz;
