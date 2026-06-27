-- Single-user favorites (no auth/user column in v1).
create table if not exists favorites (
  item_id    text primary key references items(item_id),
  created_at timestamptz not null default now()
);
