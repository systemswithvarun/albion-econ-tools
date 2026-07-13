-- items: master item catalog, populated by seed script
create table if not exists items (
  item_id      text primary key,           -- e.g. "T4_ARMOR_PLATE_SET1"
  base_name    text not null,
  tier         int not null,
  enchant      int not null default 0,     -- 0–4
  category     text not null,             -- weapon|armor|offhand|head|shoes|bag|satchel|resource|...
  is_artifact  bool not null default false,
  has_quality  bool not null default true,
  in_watchlist bool not null default false,
  display_name text,
  base_key     text                        -- item_id minus tier + enchant; family sort key (search only)
);

-- price_observations: one row per observed price tick
create table if not exists price_observations (
  id          bigserial primary key,
  item_id     text not null references items(item_id),
  city        text not null,              -- Thetford|FortSterling|Lymhurst|Bridgewatch|Martlock|Caerleon|BlackMarket
  quality     int not null default 1,    -- 1–5
  side        text not null,             -- 'buy_order' | 'sell_order'
  price       int not null,
  source      text not null default 'aodp', -- 'aodp' | 'guild'
  observed_at timestamptz not null default now(),
  constraint side_check check (side in ('buy_order', 'sell_order')),
  constraint source_check check (source in ('aodp', 'guild'))
);

create index if not exists idx_price_obs_lookup
  on price_observations (item_id, city, quality, side, observed_at desc);

-- daily_volume: latest daily avg sold per item+city
create table if not exists daily_volume (
  item_id    text not null references items(item_id),
  city       text not null,
  avg_sold   int not null,
  avg_price  int not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (item_id, city)
);

-- settings: one row per client_id (cookie-based anonymous identity).
create table if not exists settings (
  client_id text primary key,
  premium bool not null default false,
  region  text not null default 'west',
  disposable_cash  bigint  not null default 0,
  daily_target     bigint  not null default 0,
  min_margin_pct   numeric not null default 5,
  max_staleness_hr int     not null default 6,
  min_daily_volume int     not null default 0
);

-- fetch_state: single GLOBAL row for the shared price-fetch cooldown (cron + manual).
create table if not exists fetch_state (
  id int primary key default 1,
  last_price_fetch_at timestamptz,
  constraint fetch_state_single_row check (id = 1)
);

insert into fetch_state (id) values (1) on conflict do nothing;

-- recipes: empty in P1, populated P2
create table if not exists recipes (
  item_id       text not null references items(item_id),
  resource_id   text not null,
  quantity      int not null,
  is_returnable bool not null default true,  -- false for artifact resources
  primary key (item_id, resource_id)
);

-- Canonical latest price per (item, city, quality, side) for watchlist items.
-- distinct on + order by observed_at desc, source desc encodes the Doc 1 rule:
-- newest wins; on an exact observed_at tie, 'guild' > 'aodp' lexicographically.
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

-- Case-insensitive substring search over name + id (price checker search).
create index if not exists idx_items_item_id_lower on items (lower(item_id));

-- Favorites: one set per client_id (cookie-based anonymous identity).
-- sort_order: null = auto bucket (family + tier order), non-null = pinned position.
create table if not exists favorites (
  client_id  text not null,
  item_id    text not null references items(item_id),
  created_at timestamptz not null default now(),
  sort_order int,
  primary key (client_id, item_id)
);

create index if not exists idx_favorites_client_sort on favorites (client_id, sort_order);

create extension if not exists pg_trgm;

-- Trigram GIN index for fast fuzzy + substring search on names.
create index if not exists idx_items_display_name_gin
  on items using gin (display_name gin_trgm_ops);

-- Family sort key index (see migration 010).
create index if not exists idx_items_base_key on items (base_key);

-- Fuzzy item search: substring OR trigram-similar. Ordered so a matched family stays
-- contiguous and tier-ascending: family best-match desc -> base_key -> tier int -> enchant.
-- Tier comes from the int column, never the display string. Paginated.
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

-- Scoped, ordered favorites read (see migration 011). Pinned first (sort_order asc),
-- then auto (family + tier + enchant). Paginated.
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
    (f.sort_order is null),
    f.sort_order asc,
    i.base_key asc,
    i.tier asc,
    i.enchant asc
  limit lim offset off
$$;
