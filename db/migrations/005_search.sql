create extension if not exists pg_trgm;

-- Drop the misnamed b-tree from migration 003 (never a real trigram index).
drop index if exists idx_items_display_name_trgm;

-- Trigram GIN index for fast fuzzy + substring search on names.
create index if not exists idx_items_display_name_gin
  on items using gin (display_name gin_trgm_ops);

-- Fuzzy item search: substring OR trigram-similar, ranked by similarity. Paginated.
create or replace function search_items(q text, lim int default 50, off int default 0)
returns setof items
language sql stable
as $$
  select *
  from items
  where display_name ilike '%' || q || '%'
     or similarity(display_name, q) > 0.2
  order by similarity(display_name, q) desc, display_name asc
  limit lim offset off
$$;
