-- ============================================================================
-- facade_006_v1_3.sql  — Improvements PRD v1.3 (Refinements)
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
