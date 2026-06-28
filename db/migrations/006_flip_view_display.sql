create or replace view flip_latest_prices as
select distinct on (po.item_id, po.city, po.quality, po.side)
  po.item_id,
  i.base_name,
  i.display_name,
  i.enchant,
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
