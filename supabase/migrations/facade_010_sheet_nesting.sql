-- ============================================================================
-- facade_010_sheet_nesting.sql  — Supplementary A2 (2D sheet nesting for ACP/glass)
-- (renumbered from the PRD's facade_007). Additive + idempotent.
-- use_sheet_optimization defaults false → baseline area-based costing preserved.
-- Never touches cps / finance.
-- ============================================================================

alter table facade.materials add column if not exists sheet_width_mm numeric(10,1);
alter table facade.materials add column if not exists sheet_height_mm numeric(10,1);
alter table facade.materials add column if not exists sheet_edge_trim_mm numeric(8,2) default 10;
alter table facade.systems    add column if not exists use_sheet_optimization boolean default false;
alter table facade.assemblies add column if not exists use_sheet_optimization boolean default false;

create table if not exists facade.infill_pieces (
  id uuid primary key default gen_random_uuid(),
  system_id uuid references facade.systems(id) on delete cascade,
  assembly_id uuid references facade.assemblies(id) on delete cascade,
  estimate_line_id uuid references facade.estimate_lines(id) on delete cascade,
  material_id uuid references facade.materials(id),
  width_mm numeric(10,1) not null, height_mm numeric(10,1) not null,
  count integer not null default 1, allow_rotation boolean default true,
  sort_order integer default 0,
  source text default 'manual'
);

alter table facade.system_rates add column if not exists sheet_wastage_pct numeric(6,2);
alter table facade.system_rates add column if not exists sheets_used jsonb;

alter table facade.infill_pieces enable row level security;
grant all on facade.infill_pieces to anon, authenticated, service_role;
do $$
begin
  execute 'drop policy if exists infill_pieces_select on facade.infill_pieces';
  execute 'drop policy if exists infill_pieces_insert on facade.infill_pieces';
  execute 'drop policy if exists infill_pieces_update on facade.infill_pieces';
  execute 'drop policy if exists infill_pieces_delete on facade.infill_pieces';
  execute 'create policy infill_pieces_select on facade.infill_pieces for select to public using (facade.is_facade_user())';
  execute 'create policy infill_pieces_insert on facade.infill_pieces for insert to public with check (facade.is_facade_user())';
  execute 'create policy infill_pieces_update on facade.infill_pieces for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy infill_pieces_delete on facade.infill_pieces for delete to public using (facade.is_facade_user())';
end $$;
