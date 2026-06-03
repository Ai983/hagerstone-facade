-- ============================================================================
-- facade_011_ai_assist.sql  — Supplementary Tier 2 AI (AI-4 second-checker)
-- Additive + idempotent. Advisory only — AI changes no number.
-- Never touches cps / finance.
-- ============================================================================

create table if not exists facade.estimate_reviews (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references facade.estimates(id) on delete cascade,
  findings jsonb,                           -- [{severity, message}]
  risk_summary text,                        -- plain-language narrative
  created_by_ai boolean default true,
  created_at timestamptz default now()
);

alter table facade.estimate_reviews enable row level security;
grant all on facade.estimate_reviews to anon, authenticated, service_role;
do $$
begin
  execute 'drop policy if exists estimate_reviews_select on facade.estimate_reviews';
  execute 'drop policy if exists estimate_reviews_insert on facade.estimate_reviews';
  execute 'drop policy if exists estimate_reviews_update on facade.estimate_reviews';
  execute 'drop policy if exists estimate_reviews_delete on facade.estimate_reviews';
  execute 'create policy estimate_reviews_select on facade.estimate_reviews for select to public using (facade.is_facade_user())';
  execute 'create policy estimate_reviews_insert on facade.estimate_reviews for insert to public with check (facade.is_facade_user())';
  execute 'create policy estimate_reviews_update on facade.estimate_reviews for update to public using (facade.is_facade_user()) with check (facade.is_facade_user())';
  execute 'create policy estimate_reviews_delete on facade.estimate_reviews for delete to public using (facade.is_facade_user())';
end $$;
