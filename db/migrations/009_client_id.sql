-- Per-client isolation via cookie-based client id (aep_client_id).
-- Existing unowned rows (null client_id) are dropped — data loss accepted.

-- favorites: composite PK (client_id, item_id)
alter table favorites add column if not exists client_id text;
delete from favorites where client_id is null;
alter table favorites drop constraint favorites_pkey;
alter table favorites alter column client_id set not null;
alter table favorites add primary key (client_id, item_id);

-- settings: one row per client_id (was a single global row, id=1)
alter table settings drop constraint single_row;
alter table settings drop column if exists last_price_fetch_at;  -- global infra → fetch_state below
alter table settings add column if not exists client_id text;
delete from settings where client_id is null;
alter table settings drop column id;
alter table settings alter column client_id set not null;
alter table settings add primary key (client_id);

-- fetch_state: single global row for the shared price-fetch cooldown (cron + manual,
-- which have no client_id). Kept separate so user prefs stay per-client.
create table if not exists fetch_state (
  id int primary key default 1,
  last_price_fetch_at timestamptz,
  constraint fetch_state_single_row check (id = 1)
);
insert into fetch_state (id) values (1) on conflict do nothing;
