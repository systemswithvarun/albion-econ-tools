-- items: master item catalog, populated by seed script
create table if not exists items (
  item_id      text primary key,           -- e.g. "T4_ARMOR_PLATE_SET1"
  base_name    text not null,
  tier         int not null,
  enchant      int not null default 0,     -- 0–4
  category     text not null,             -- weapon|armor|offhand|head|shoes|bag|satchel|resource|...
  is_artifact  bool not null default false,
  has_quality  bool not null default true,
  in_watchlist bool not null default false
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
  fetched_at timestamptz not null default now(),
  primary key (item_id, city)
);

-- settings: single row, global toggle
create table if not exists settings (
  id      int primary key default 1,
  premium bool not null default false,
  region  text not null default 'west',
  constraint single_row check (id = 1)
);

insert into settings (id) values (1) on conflict do nothing;

-- recipes: empty in P1, populated P2
create table if not exists recipes (
  item_id       text not null references items(item_id),
  resource_id   text not null,
  quantity      int not null,
  is_returnable bool not null default true,  -- false for artifact resources
  primary key (item_id, resource_id)
);
