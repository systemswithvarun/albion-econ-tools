-- 010: family sort key for item search.
--
-- Problem: search_items ordered by (similarity desc, display_name asc). display_name
-- carries the tier as a leading possessive word ("Adept's" = T4, "Elder's" = T8,
-- "Expert's" = T5), so alphabetical display_name scrambles a family's tiers (A, E, E …).
-- The tier int column existed but was never used in the sort.
--
-- Fix: add base_key (item_id stripped of tier + enchant) and order by the family's best
-- match first (so the searched family floats up as one block), then base_key, then the
-- tier INT ascending, then enchant. Tier comes from the column, never the display string.

alter table items add column if not exists base_key text;

-- Backfill: strip leading tier, then (enchanted rows only) the trailing _<enchant> suffix.
-- Byte-identical to toBaseKey() in db/seed/name-map.ts. The enchant guard preserves names
-- that legitimately end in a digit (e.g. T4_ARMOR_PLATE_SET1 has enchant 0 -> no strip).
update items
set base_key = case
  when enchant > 0
    then regexp_replace(regexp_replace(item_id, '^T\d+_', ''), '_' || enchant::text || '$', '')
  else regexp_replace(item_id, '^T\d+_', '')
end
where base_key is null;

alter table items alter column base_key set not null;

create index if not exists idx_items_base_key on items (base_key);

-- Reordered search: family best-match desc (whole family floats up together) -> base_key
-- -> tier int asc -> enchant asc. Match predicate UNCHANGED (ilike OR similarity > 0.2):
-- "knight" surfaces the knight family; "knight armor" pulls boots/helmet only if fuzzy
-- clears 0.2. base_key is a sort input only, never rendered.
create or replace function search_items(q text, lim int default 50, off int default 0)
returns setof items
language sql stable
as $$
  select i.*
  from items i
  where i.display_name ilike '%' || q || '%'
     or similarity(i.display_name, q) > 0.2
  order by
    max(similarity(i.display_name, q)) over (partition by i.base_key) desc nulls last,
    i.base_key asc,
    i.tier asc,
    i.enchant asc
  limit lim offset off
$$;
