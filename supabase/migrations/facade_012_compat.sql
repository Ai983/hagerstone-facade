-- ============================================================================
-- facade_012_compat.sql  — Supplementary A5 (compatibility warnings, light)
-- (renumbered from the PRD's facade_009). Additive + idempotent.
-- Warn-only plausibility checks; NOT structural engineering. No rules = no change.
-- Never touches cps / finance.
-- ============================================================================

create table if not exists facade.compatibility_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,                 -- e.g. glass_thickness_vs_pressure_plate
  section_id uuid references facade.sections(id),
  material_id uuid references facade.materials(id),
  min_value numeric, max_value numeric,
  severity text default 'warn',            -- warn only
  message text, is_active boolean default true
);

alter table facade.compatibility_rules enable row level security;
grant all on facade.compatibility_rules to anon, authenticated, service_role;
do $$
begin
  execute 'drop policy if exists compatibility_rules_select on facade.compatibility_rules';
  execute 'drop policy if exists compatibility_rules_insert on facade.compatibility_rules';
  execute 'drop policy if exists compatibility_rules_update on facade.compatibility_rules';
  execute 'drop policy if exists compatibility_rules_delete on facade.compatibility_rules';
  execute 'create policy compatibility_rules_select on facade.compatibility_rules for select to public using (facade.is_facade_user())';
  execute 'create policy compatibility_rules_insert on facade.compatibility_rules for insert to public with check (facade.is_facade_user())';
  execute 'create policy compatibility_rules_update on facade.compatibility_rules for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy compatibility_rules_delete on facade.compatibility_rules for delete to public using (facade.is_facade_user())';
end $$;
