-- 011: favorites sort model — sticky-per-item with auto fallback (SPEC E1).
--
-- sort_order semantics:
--   null     = auto bucket. Sorts by family (base_key) + tier + enchant.
--   non-null = pinned to that manual position (drag). Lower = higher in the list.
-- Depends on items.base_key (migration 010) — single source for the base family;
-- not re-derived here.

alter table favorites add column if not exists sort_order int;

-- Pinned-first index for the scoped read.
create index if not exists idx_favorites_client_sort on favorites (client_id, sort_order);

-- Scoped, ordered favorites read. Pinned items (sort_order not null) first by
-- sort_order asc; then auto items (sort_order null) by base_key -> tier -> enchant.
-- (No quality key: an item has no quality dimension — quality is a price attribute.)
-- Paginated (PostgREST 1000-row rule holds even though no watchlist hits it).
create or replace function list_favorites(cid text, lim int default 100, off int default 0)
returns table (
  item_id      text,
  display_name text,
  tier         int,
  enchant      int,
  category     text,
  sort_order   int
)
language sql stable
as $$
  select f.item_id, i.display_name, i.tier, i.enchant, i.category, f.sort_order
  from favorites f
  join items i on i.item_id = f.item_id
  where f.client_id = cid
  order by
    (f.sort_order is null),   -- false (pinned) sorts before true (auto)
    f.sort_order asc,
    i.base_key asc,
    i.tier asc,
    i.enchant asc
  limit lim offset off
$$;
