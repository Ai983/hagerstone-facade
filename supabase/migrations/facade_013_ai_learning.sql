-- ============================================================================
-- facade_013_ai_learning.sql  — Supplementary Tier 3 AI (gated; ships DISABLED)
-- Additive + idempotent. rate_suggest/anomaly/variance config rows were seeded
-- enabled=false in facade_009. Do NOT enable until ~12-24 months of real
-- facade.actuals exist, or these produce confident-but-wrong numbers.
-- Never touches cps / finance.
-- ============================================================================

create table if not exists facade.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  context text,                             -- rate|labour|anomaly|variance
  target_ref text,                          -- system/estimate/line id
  suggestion jsonb,                         -- {value, basis, sample_size}
  confidence numeric(5,2),
  created_at timestamptz default now()
);

-- ensure the gated config rows exist and remain disabled
insert into facade.ai_config (feature, enabled, confidence_threshold) values
  ('rate_suggest', false, 70), ('anomaly', false, 70), ('variance', false, 70)
on conflict (feature) do nothing;

alter table facade.ai_suggestions enable row level security;
grant all on facade.ai_suggestions to anon, authenticated, service_role;
do $$
begin
  execute 'drop policy if exists ai_suggestions_select on facade.ai_suggestions';
  execute 'drop policy if exists ai_suggestions_insert on facade.ai_suggestions';
  execute 'drop policy if exists ai_suggestions_update on facade.ai_suggestions';
  execute 'drop policy if exists ai_suggestions_delete on facade.ai_suggestions';
  execute 'create policy ai_suggestions_select on facade.ai_suggestions for select to public using (facade.is_facade_user())';
  execute 'create policy ai_suggestions_insert on facade.ai_suggestions for insert to public with check (facade.is_facade_user())';
  execute 'create policy ai_suggestions_update on facade.ai_suggestions for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy ai_suggestions_delete on facade.ai_suggestions for delete to public using (facade.is_facade_user())';
end $$;
