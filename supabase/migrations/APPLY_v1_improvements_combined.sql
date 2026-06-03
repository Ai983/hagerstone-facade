-- ====================================================================
-- COMBINED v1.1 + v1.2 + v1.3 improvements (facade_004 + 005 + 006)
-- Paste into Supabase SQL Editor and Run. Additive + idempotent + safe to re-run.
-- ====================================================================


-- >>>>>>>>>>>>>>>> facade_004_v1_1.sql <<<<<<<<<<<<<<<<
-- ============================================================================
-- facade_004_v1_1.sql  â€” Improvements PRD v1.1 (Accuracy patch)
-- (numbered 004 because 003 was already shipped as facade_003_ai_source)
-- Additive + idempotent. All new behaviour defaults to current logic, so the
-- six seeded systems still reproduce the Excel within â‚¹1 with toggles OFF.
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


-- >>>>>>>>>>>>>>>> facade_005_v1_2.sql <<<<<<<<<<<<<<<<
-- ============================================================================
-- facade_005_v1_2.sql  â€” Improvements PRD v1.2 (Defensible numbers)
-- Additive + idempotent. Cut-optimization & scrap-credit default OFF, so the
-- six seeded systems still reproduce the Excel within â‚¹1 with toggles OFF.
-- Never touches cps / finance.
-- ============================================================================

-- 5: cut-optimization parameters (editable; defaults reproduce a 6 m bar)
alter table facade.systems   add column if not exists use_cut_optimization boolean default false; -- OFF = keep flat wastage path
alter table facade.rate_cards add column if not exists stock_bar_length_m   numeric(6,3) default 6.0;
alter table facade.rate_cards add column if not exists kerf_mm              numeric(6,2) default 4;
alter table facade.rate_cards add column if not exists bar_trim_mm          numeric(6,2) default 15;
alter table facade.rate_cards add column if not exists min_usable_offcut_mm numeric(8,2) default 500;

-- 6: scrap recovery credit (OFF by default)
alter table facade.systems   add column if not exists apply_scrap_credit boolean default false;
alter table facade.rate_cards add column if not exists scrap_recovery_pct numeric(5,2) default 70; -- % of metal value for clean 6063

-- store the optimization result for transparency
alter table facade.system_rates add column if not exists optimized_wastage_pct numeric(6,2);
alter table facade.system_rates add column if not exists offcut_kg            numeric(12,3);
alter table facade.system_rates add column if not exists scrap_credit_amount  numeric(14,2);

-- 7: estimate vs actual feedback loop
create table if not exists facade.actuals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references facade.projects(id) on delete cascade,
  estimate_id uuid references facade.estimates(id),
  total_alu_kg_actual numeric(14,3),
  wastage_pct_actual numeric(6,2),
  labour_cost_actual numeric(16,2),
  freight_cost_actual numeric(16,2),
  material_cost_actual numeric(16,2),
  notes text,
  recorded_by uuid references public.employees(id),
  recorded_at timestamptz default now()
);

-- RLS + grants for facade.actuals (mirror the facade grant model)
alter table facade.actuals enable row level security;
grant all on facade.actuals to anon, authenticated, service_role;
do $$
begin
  execute 'drop policy if exists actuals_select on facade.actuals';
  execute 'drop policy if exists actuals_insert on facade.actuals';
  execute 'drop policy if exists actuals_update on facade.actuals';
  execute 'drop policy if exists actuals_delete on facade.actuals';
  execute 'create policy actuals_select on facade.actuals for select to public using (facade.is_facade_user())';
  execute 'create policy actuals_insert on facade.actuals for insert to public with check (facade.is_facade_user())';
  execute 'create policy actuals_update on facade.actuals for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy actuals_delete on facade.actuals for delete to public using (facade.is_facade_user())';
end $$;


-- >>>>>>>>>>>>>>>> facade_006_v1_3.sql <<<<<<<<<<<<<<<<
-- ============================================================================
-- facade_006_v1_3.sql  â€” Improvements PRD v1.3 (Refinements)
-- Additive + idempotent. All new behaviour defaults to current logic
-- (no markup tier, is_sealant=false, no scenario) so the baseline is preserved.
-- Never touches cps / finance.
-- ============================================================================

-- 8: tiered markup + contingency
create table if not exists facade.markup_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- Standard / New-system / Complex / High-rise-coastal
  risk_level text,                    -- low|medium|high
  markup_pct numeric(5,2) not null,   -- replaces oh_profit_pct when chosen
  contingency_pct numeric(5,2) default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table facade.estimates add column if not exists markup_tier_id uuid references facade.markup_tiers(id);
alter table facade.estimates add column if not exists contingency_pct numeric(5,2) default 0;

-- 9: sealant / gasket bead-volume calc
alter table facade.system_materials add column if not exists is_sealant boolean default false;
alter table facade.system_materials add column if not exists perimeter_m numeric(12,3);
alter table facade.system_materials add column if not exists structural_bite_mm numeric(8,2);
alter table facade.system_materials add column if not exists glueline_mm numeric(8,2);
alter table facade.system_materials add column if not exists tube_volume_ml numeric(8,2);

-- 10 & 11: scenarios + revision snapshots
alter table facade.estimates add column if not exists scenario_label text;
create table if not exists facade.estimate_revisions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references facade.estimates(id) on delete cascade,
  snapshot jsonb not null,            -- full estimate + lines + total at save time
  changed_by uuid references public.employees(id),
  changed_at timestamptz default now(),
  change_note text
);

-- seed a couple of starter markup tiers (idempotent)
insert into facade.markup_tiers (name, risk_level, markup_pct, contingency_pct)
select * from (values
  ('Standard', 'low', 18.0, 0.0),
  ('New system', 'medium', 22.0, 3.0),
  ('Complex / high-rise coastal', 'high', 28.0, 5.0)
) as v(name, risk_level, markup_pct, contingency_pct)
where not exists (select 1 from facade.markup_tiers);

-- RLS + grants for the two new tables
alter table facade.markup_tiers enable row level security;
alter table facade.estimate_revisions enable row level security;
grant all on facade.markup_tiers, facade.estimate_revisions to anon, authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['markup_tiers','estimate_revisions'] loop
    execute format('drop policy if exists %1$s_select on facade.%1$s', t);
    execute format('drop policy if exists %1$s_insert on facade.%1$s', t);
    execute format('drop policy if exists %1$s_update on facade.%1$s', t);
    execute format('drop policy if exists %1$s_delete on facade.%1$s', t);
    execute format('create policy %1$s_select on facade.%1$s for select to public using (facade.is_facade_user())', t);
    execute format('create policy %1$s_insert on facade.%1$s for insert to public with check (facade.is_facade_user())', t);
    execute format('create policy %1$s_update on facade.%1$s for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())', t);
    execute format('create policy %1$s_delete on facade.%1$s for delete to public using (facade.is_facade_user())', t);
  end loop;
end $$;


