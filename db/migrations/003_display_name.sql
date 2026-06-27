-- Human-readable item name, backfilled from ao-bin-dumps formatted/items.json.
alter table items add column if not exists display_name text;

-- Case-insensitive substring search over name + id (price checker search).
create index if not exists idx_items_display_name_trgm on items (lower(display_name));
create index if not exists idx_items_item_id_lower on items (lower(item_id));
