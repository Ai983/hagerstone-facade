-- ============================================================================
-- facade_016_budget.sql  — Step 4 (main goal): automated Budget Sheet
-- Replaces the manual Excel "Cash Flow Project Input Form". A budget sits ABOVE
-- the rate-engine estimate: the estimate seeds Material/Production; the budget
-- adds the other cost heads, markup -> contract value, and a cash-flow plan.
-- The rate engine and shipped migrations are NOT touched.
-- Additive + idempotent. Never touches cps / finance.
-- ============================================================================

-- 1) Global, editable cost-head template (Permasteelisa default set) --------
create table if not exists facade.budget_template_heads (
  id uuid primary key default gen_random_uuid(),
  head_name text not null unique,
  sort_order integer default 0,
  calc_type text default 'manual',           -- manual|pct_of|from_estimate|staffing
  pct_value numeric(8,3),                     -- used when calc_type='pct_of'
  pct_basis text,                             -- material_production|total_costs|sales|none
  default_payment_delay_days integer default 0,
  is_active boolean default true
);

insert into facade.budget_template_heads
  (head_name, sort_order, calc_type, pct_value, pct_basis, default_payment_delay_days) values
  ('Engineering',                                1, 'manual',        null, 'none',               30),
  ('Project Management',                         2, 'staffing',      null, 'none',               30),
  ('Material',                                   3, 'from_estimate', null, 'none',               60),
  ('Production',                                 4, 'from_estimate', null, 'none',               60),
  ('Transport, Offsite storage & Packaging',    5, 'manual',        null, 'none',               60),
  ('Site costs',                                 6, 'manual',        null, 'none',               60),
  ('Subcontracting',                            7, 'manual',        null, 'none',               30),
  ('Intercompany charges',                      8, 'pct_of',           5, 'material_production',  0),
  ('Others',                                     9, 'pct_of',          14, 'total_costs',         0),
  ('Contingency',                               10, 'pct_of',           3, 'total_costs',        30)
on conflict (head_name) do nothing;

-- 2) A budget per project (versioned) --------------------------------------
create table if not exists facade.budgets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                  -- FAC-BUD-YYYY-NNNN
  project_id uuid not null references facade.projects(id) on delete cascade,
  estimate_id uuid references facade.estimates(id),
  name text,
  version integer default 1,
  status text default 'draft',                -- draft|approved
  reference_date date default current_date,
  start_date date,
  on_site_date date,
  completion_date date,
  markup_pct numeric(8,3) default 20,
  creditor_interest_pct numeric(8,3) default 15,
  debtor_interest_pct numeric(8,3) default 0,
  advance_pct numeric(8,3) default 10,
  retention_pct numeric(8,3) default 0,
  total_costs numeric(18,2) default 0,
  markup_amount numeric(18,2) default 0,
  contract_value numeric(18,2) default 0,
  cashflow_snapshot jsonb,
  created_by uuid references public.employees(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3) Cost heads of a budget (copied from the template at create time) -------
create table if not exists facade.budget_heads (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references facade.budgets(id) on delete cascade,
  head_name text not null,
  sort_order integer default 0,
  calc_type text default 'manual',
  value numeric(18,2) default 0,             -- resolved amount (computed or entered)
  pct_value numeric(8,3),
  pct_basis text,
  payment_delay_days integer default 0,
  deliver_from_month integer,
  deliver_from_year integer,
  deliver_to_month integer,
  deliver_to_year integer,
  notes text
);

-- 4) Project Management staffing build-up (feeds the PM head) ---------------
create table if not exists facade.budget_pm_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references facade.budgets(id) on delete cascade,
  description text,
  uom text,
  qty numeric(14,3) default 0,
  salary numeric(14,2) default 0,
  duration_months numeric(10,2) default 0,
  amount numeric(18,2) generated always as (qty * salary * duration_months) stored,
  sort_order integer default 0
);

-- 5) Material build-up (feeds the Material head; seeded from the BOM) -------
create table if not exists facade.budget_material_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references facade.budgets(id) on delete cascade,
  description text,
  qty numeric(14,3) default 0,
  uom text,
  rate numeric(14,2) default 0,
  amount numeric(18,2) generated always as (qty * rate) stored,
  source text default 'manual',              -- manual|estimate
  sort_order integer default 0
);

-- keep updated_at fresh on the header
drop trigger if exists trg_budgets_touch on facade.budgets;
create trigger trg_budgets_touch before update on facade.budgets
  for each row execute function facade.touch_updated_at();

-- 6) Global scalar defaults for the budget engine --------------------------
insert into facade.calc_config (key, num_value, description) values
  ('budget_markup_pct',            20, 'Default markup % on total cost -> contract value'),
  ('budget_creditor_interest_pct', 15, 'Interest % charged on a negative cash balance (creditor)'),
  ('budget_debtor_interest_pct',    0, 'Interest % earned on a positive cash balance (debtor)'),
  ('budget_advance_pct',           10, 'Default client advance % of contract'),
  ('budget_material_misc_pct',     10, 'Misc + contingency uplift % on the material build-up')
on conflict (key) do nothing;

-- RLS + grants (mirror the facade grant model)
do $$
declare t text;
begin
  foreach t in array array['budget_template_heads','budgets','budget_heads','budget_pm_lines','budget_material_lines'] loop
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

notify pgrst, 'reload schema';
