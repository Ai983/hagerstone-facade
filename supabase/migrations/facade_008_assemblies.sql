-- ============================================================================
-- facade_008_assemblies.sql  — Supplementary A1 (parametric assemblies)
-- (renumbered from the PRD's facade_006 because 006 was already shipped)
-- Additive + idempotent. Assemblies are optional; existing system-based
-- estimates are unaffected. Never touches cps / finance.
-- ============================================================================

create table if not exists facade.assemblies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  category text, description text,
  base_width_mm numeric(10,1) not null,
  base_height_mm numeric(10,1) not null,
  apply_powder_coating boolean default true,
  labour_per_sqm numeric(12,2) default 0, freight_per_sqm numeric(12,2) default 0,
  wastage_pct numeric(5,2) default 10, design_pct numeric(5,2) default 2.5,
  misc_pct numeric(5,2) default 2.5, pmc_pct numeric(5,2) default 5,
  oh_profit_pct numeric(5,2) default 18,
  is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists facade.assembly_members (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references facade.assemblies(id) on delete cascade,
  section_id uuid references facade.sections(id),
  member_name text not null,
  orientation text not null default 'fixed',     -- horizontal | vertical | fixed
  base_cutlength_m numeric(12,4) default 0,       -- used only when orientation='fixed'
  number integer not null default 0,
  qty numeric(12,4) not null default 1,
  unit_weight_kg_per_m numeric(10,3),
  sort_order integer default 0
);

create table if not exists facade.assembly_materials (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references facade.assemblies(id) on delete cascade,
  material_id uuid references facade.materials(id),
  qty_per_unit numeric(14,4) default 0,           -- consumables: per-assembly qty
  is_infill boolean default false,                -- infill area derived from WxH
  wastage_applies boolean default false,
  sort_order integer default 0
);

-- instantiate an assembly into an estimate line
alter table facade.estimate_lines add column if not exists assembly_id uuid references facade.assemblies(id);
alter table facade.estimate_lines add column if not exists inst_width_mm numeric(10,1);
alter table facade.estimate_lines add column if not exists inst_height_mm numeric(10,1);
alter table facade.estimate_lines add column if not exists inst_count integer default 1;

-- RLS + grants for the new tables
do $$
declare t text;
begin
  foreach t in array array['assemblies','assembly_members','assembly_materials'] loop
    execute format('alter table facade.%I enable row level security', t);
    execute format('grant all on facade.%I to anon, authenticated, service_role', t);
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
