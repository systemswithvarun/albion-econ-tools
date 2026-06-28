alter table daily_volume add column if not exists avg_price int not null default 0;
