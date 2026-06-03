-- ============================================================================
-- facade_009_ai_core.sql  — Supplementary AI core + Tier 1 staging tables
-- (renumbered from the PRD's facade_010). Additive + idempotent.
-- Gated features ship disabled; human-in-the-loop on anything touching price/qty.
-- Never touches cps / finance.
-- ============================================================================

create table if not exists facade.ai_config (
  id uuid primary key default gen_random_uuid(),
  feature text unique not null,            -- takeoff|scope|price_parse|review|nl_draft|rate_suggest|anomaly|variance
  enabled boolean default false,
  confidence_threshold numeric(5,2) default 70,
  provider text default 'claude_proxy',
  notes text,
  updated_at timestamptz default now()
);

create table if not exists facade.ai_runs (
  id uuid primary key default gen_random_uuid(),
  feature text not null,
  input_ref text,
  output jsonb,
  confidence numeric(5,2),
  confidence_reason text,
  accepted boolean,
  actor_id uuid references public.employees(id),
  created_at timestamptz default now()
);

-- provenance on AI-populated rows
alter table facade.estimate_lines add column if not exists source text default 'manual'; -- manual|ai_extracted|ai_override

-- AI-2: tender scope capture (staging; human-confirmed into an estimate)
create table if not exists facade.tender_scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references facade.projects(id) on delete cascade,
  document_id uuid references facade.documents(id),
  description text, system_guess text, area_sqm numeric(14,4),
  spec_notes text, confidence numeric(5,2), flagged boolean default false,
  status text default 'proposed',          -- proposed|accepted|rejected
  created_at timestamptz default now()
);

-- AI-3: material price proposals (human-confirmed into materials master)
create table if not exists facade.material_price_proposals (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references facade.materials(id),
  proposed_rate numeric(12,2), current_rate numeric(12,2),
  source_doc text, confidence numeric(5,2),
  status text default 'proposed',          -- proposed|accepted|rejected
  decided_by uuid references public.employees(id),
  created_at timestamptz default now()
);

-- seed ai_config: Tier 1 & 2 enabled; Tier 3 disabled (gated on data)
insert into facade.ai_config (feature, enabled, confidence_threshold) values
  ('takeoff', true, 70), ('scope', true, 70), ('price_parse', true, 70),
  ('review', true, 70), ('nl_draft', true, 70),
  ('rate_suggest', false, 70), ('anomaly', false, 70), ('variance', false, 70)
on conflict (feature) do nothing;

-- RLS + grants
do $$
declare t text;
begin
  foreach t in array array['ai_config','ai_runs','tender_scope_items','material_price_proposals'] loop
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
