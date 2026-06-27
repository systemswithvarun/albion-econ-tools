-- Module 1 (Flip) schema additions. Idempotent where practical.

-- Extend settings with flip filters (single-row settings table from Doc 1).
alter table settings add column if not exists disposable_cash bigint   not null default 0;
alter table settings add column if not exists daily_target    bigint   not null default 0;
alter table settings add column if not exists min_margin_pct  numeric  not null default 5;
alter table settings add column if not exists max_staleness_hr int     not null default 6;
alter table settings add column if not exists min_daily_volume int     not null default 0;

-- Canonical latest price per (item, city, quality, side) for watchlist items.
-- distinct on + order by observed_at desc, source desc encodes the Doc 1 rule:
-- newest wins; on an exact observed_at tie, 'guild' > 'aodp' lexicographically.
create or replace view flip_latest_prices as
select distinct on (po.item_id, po.city, po.quality, po.side)
  po.item_id,
  i.base_name,
  i.category,
  po.city,
  po.quality,
  po.side,
  po.price,
  po.source,
  po.observed_at
from price_observations po
join items i on i.item_id = po.item_id
where i.in_watchlist = true
order by po.item_id, po.city, po.quality, po.side, po.observed_at desc, po.source desc;
