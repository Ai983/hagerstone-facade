-- ============================================================================
-- facade_005_v1_2.sql  — Improvements PRD v1.2 (Defensible numbers)
-- Additive + idempotent. Cut-optimization & scrap-credit default OFF, so the
-- six seeded systems still reproduce the Excel within ₹1 with toggles OFF.
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
