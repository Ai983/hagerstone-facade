-- ============================================================================
-- facade_004_v1_1.sql  — Improvements PRD v1.1 (Accuracy patch)
-- (numbered 004 because 003 was already shipped as facade_003_ai_source)
-- Additive + idempotent. All new behaviour defaults to current logic, so the
-- six seeded systems still reproduce the Excel within ₹1 with toggles OFF.
-- Never touches cps / finance.
-- ============================================================================

-- 1 & 2: price validity + escalation on the rate card and quotations
alter table facade.rate_cards add column if not exists valid_until date;
alter table facade.rate_cards add column if not exists escalation_note text;
alter table facade.quotations add column if not exists price_valid_until date;
alter table facade.quotations add column if not exists escalation_clause text;

-- 3: landed-cost controls for aluminium (default 'landed' + 0% uplift = no change)
alter table facade.rate_cards add column if not exists aluminium_basis text default 'landed';        -- 'landed' | 'stockist'
alter table facade.rate_cards add column if not exists freight_handling_pct numeric(5,2) default 0;  -- uplift applied ONLY when basis='stockist'
-- NOTE: GST is excluded from cost when ITC is claimed; this uplift is freight + unloading + handling only.

-- 4: calculator config + validation thresholds (single config table, editable)
create table if not exists facade.calc_config (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  num_value numeric,
  text_value text,
  description text,
  updated_by uuid references public.employees(id),
  updated_at timestamptz default now()
);

insert into facade.calc_config (key, num_value, description) values
  ('margin_floor_pct', 10, 'Warn if OH&profit below this %'),
  ('wastage_min_pct', 5, 'Warn if wastage below this %'),
  ('wastage_max_pct', 20, 'Warn if wastage above this %'),
  ('price_stale_days', 14, 'Warn if rate card older than this many days')
on conflict (key) do nothing;

-- RLS + grants for the new table (mirror the facade grant model)
alter table facade.calc_config enable row level security;
grant all on facade.calc_config to anon, authenticated, service_role;

do $$
begin
  execute 'drop policy if exists calc_config_select on facade.calc_config';
  execute 'drop policy if exists calc_config_insert on facade.calc_config';
  execute 'drop policy if exists calc_config_update on facade.calc_config';
  execute 'drop policy if exists calc_config_delete on facade.calc_config';
  execute 'create policy calc_config_select on facade.calc_config for select to public using (facade.is_facade_user())';
  execute 'create policy calc_config_insert on facade.calc_config for insert to public with check (facade.is_facade_user())';
  execute 'create policy calc_config_update on facade.calc_config for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy calc_config_delete on facade.calc_config for delete to public using (facade.is_facade_user())';
end $$;
