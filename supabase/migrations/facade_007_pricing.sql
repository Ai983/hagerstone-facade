-- ============================================================================
-- facade_007_pricing.sql  — Supplementary A4 (import duty) + A3 (price feed scaffold)
-- (renumbered from the PRD's facade_008 because 006 was already shipped)
-- Additive + idempotent. Default import_duty_pct = 0 → baseline unchanged.
-- Never touches cps / finance.
-- ============================================================================

alter table facade.rate_cards add column if not exists import_duty_pct numeric(5,2) default 0;
alter table facade.rate_cards add column if not exists price_source text default 'manual';  -- manual | feed

create table if not exists facade.price_feed_log (
  id uuid primary key default gen_random_uuid(),
  metal text default 'aluminium',
  index_name text,                         -- e.g. LME-3M, MCX Aluminium
  value_per_kg_inr numeric(12,2),
  fetched_at timestamptz default now(),
  source_note text
);

alter table facade.price_feed_log enable row level security;
grant all on facade.price_feed_log to anon, authenticated, service_role;
do $$
begin
  execute 'drop policy if exists price_feed_log_select on facade.price_feed_log';
  execute 'drop policy if exists price_feed_log_insert on facade.price_feed_log';
  execute 'drop policy if exists price_feed_log_update on facade.price_feed_log';
  execute 'drop policy if exists price_feed_log_delete on facade.price_feed_log';
  execute 'create policy price_feed_log_select on facade.price_feed_log for select to public using (facade.is_facade_user())';
  execute 'create policy price_feed_log_insert on facade.price_feed_log for insert to public with check (facade.is_facade_user())';
  execute 'create policy price_feed_log_update on facade.price_feed_log for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy price_feed_log_delete on facade.price_feed_log for delete to public using (facade.is_facade_user())';
end $$;
