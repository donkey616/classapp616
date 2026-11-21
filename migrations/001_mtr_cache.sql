create table if not exists mtr_schedule_cache (
  cache_key text primary key,
  body jsonb,
  fresh_until_ms double precision not null,
  refresh_until_ms double precision not null
);
