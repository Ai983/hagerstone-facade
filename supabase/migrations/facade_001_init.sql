-- ============================================================================
-- facade_001_init.sql
-- Self-contained `facade` schema for the Hagerstone Facade System.
-- Additive + idempotent. Never touches cps or finance schemas.
-- RLS grant model mirrors cps: a SECURITY DEFINER membership function gates
-- per-table SELECT/INSERT/UPDATE/DELETE policies (role = public).
-- ============================================================================

create schema if not exists facade;

-- ---------------------------------------------------------------------------
-- Core tables (exact PRD §4 DDL)
-- ---------------------------------------------------------------------------
create table if not exists facade.sections (
  id uuid primary key default gen_random_uuid(),
  section_no text not null,
  name text not null,
  default_unit_weight_kg_per_m numeric(10,3),
  finish text, notes text, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (section_no, name)
);

create table if not exists facade.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null,   -- aluminium|conversion|coating|silicone|fastener|screw|gasket|bracket|glass|acp|dgu|hardware|other
  unit text not null,       -- kg|m|mtr|bottle|pcs|sqm|set
  default_rate numeric(12,2) not null default 0,
  is_infill boolean default false, is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists facade.rate_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null, effective_from date not null default current_date,
  aluminium_per_kg numeric(12,2) not null,
  conversion_per_kg numeric(12,2) not null,
  powder_coating_per_kg numeric(12,2) not null,
  is_active boolean default true,
  created_by uuid references public.employees(id),
  created_at timestamptz default now()
);

create table if not exists facade.systems (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  category text, description text,
  panel_width_mm numeric(10,1), panel_height_mm numeric(10,1), panel_area_sqm numeric(12,4),
  apply_powder_coating boolean default true,
  labour_per_sqm numeric(12,2) default 0, freight_per_sqm numeric(12,2) default 0,
  wastage_pct numeric(5,2) default 10, design_pct numeric(5,2) default 2.5,
  misc_pct numeric(5,2) default 2.5, pmc_pct numeric(5,2) default 5,
  oh_profit_pct numeric(5,2) default 18,
  is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists facade.system_members (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references facade.systems(id) on delete cascade,
  section_id uuid references facade.sections(id),
  member_name text not null,
  cutlength_m numeric(12,4) not null default 0,
  number integer not null default 0,
  qty numeric(12,4) not null default 1,
  unit_weight_kg_per_m numeric(10,3),
  sort_order integer default 0
);

create table if not exists facade.system_materials (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references facade.systems(id) on delete cascade,
  material_id uuid references facade.materials(id),
  qty numeric(14,4) not null default 0,
  rate_override numeric(12,2),
  is_infill boolean default false, wastage_applies boolean default false,
  sort_order integer default 0
);

create table if not exists facade.system_rates (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references facade.systems(id) on delete cascade,
  rate_card_id uuid references facade.rate_cards(id),
  rate_per_sqm numeric(14,4) not null, breakdown jsonb,
  computed_at timestamptz default now(),
  computed_by uuid references public.employees(id)
);

create table if not exists facade.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- FAC-PRJ-YYYY-NNNN
  client_name text not null, project_name text not null,
  location text, site_address text,
  status text default 'enquiry',        -- enquiry|estimating|quoted|approved|in_execution|completed|lost
  created_by uuid references public.employees(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists facade.estimates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- FAC-EST-YYYY-NNNN
  project_id uuid not null references facade.projects(id) on delete cascade,
  version integer default 1, status text default 'draft',
  total_amount numeric(16,2) default 0, notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz default now()
);

create table if not exists facade.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references facade.estimates(id) on delete cascade,
  system_id uuid references facade.systems(id),
  elevation_ref text,
  area_sqm numeric(14,4) not null default 0,
  rate_per_sqm numeric(14,4) not null default 0,
  amount numeric(16,2) generated always as (area_sqm * rate_per_sqm) stored,
  notes text, sort_order integer default 0
);

create table if not exists facade.quotations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- FAC-QT-YYYY-NNNN
  project_id uuid not null references facade.projects(id) on delete cascade,
  estimate_id uuid references facade.estimates(id),
  status text default 'draft',          -- draft|sent|approved|rejected|expired
  valid_until date, terms text, total_amount numeric(16,2) default 0,
  created_by uuid references public.employees(id),
  created_at timestamptz default now()
);

create table if not exists facade.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references facade.quotations(id) on delete cascade,
  description text not null, system_id uuid references facade.systems(id),
  area_sqm numeric(14,4), rate_per_sqm numeric(14,4), amount numeric(16,2),
  sort_order integer default 0
);

create table if not exists facade.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references facade.projects(id) on delete cascade,
  stage text not null, status text default 'pending',
  owner_id uuid references public.employees(id),
  started_at timestamptz, completed_at timestamptz, notes text,
  sort_order integer default 0
);

create table if not exists facade.procurement_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- FAC-PR-YYYY-NNNN
  project_id uuid not null references facade.projects(id) on delete cascade,
  status text default 'draft',
  exported_to_cps boolean default false, export_payload jsonb, exported_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists facade.procurement_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references facade.procurement_requests(id) on delete cascade,
  material_id uuid references facade.materials(id),
  description text, qty numeric(14,4), unit text, sort_order integer default 0
);

create table if not exists facade.payments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- FAC-PAY-YYYY-NNNN
  project_id uuid not null references facade.projects(id) on delete cascade,
  payment_type text not null,           -- client_invoice|vendor_payment
  party_name text, amount numeric(16,2) not null, status text default 'pending',
  exported_to_finance boolean default false, export_payload jsonb, exported_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists facade.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null, entity_id uuid, action text not null,
  actor_id uuid references public.employees(id), meta jsonb,
  created_at timestamptz default now()
);

create table if not exists facade.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references facade.projects(id) on delete cascade,
  doc_type text, storage_path text,
  uploaded_by uuid references public.employees(id),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Reference-ID helper — one helper for FAC-PRJ / FAC-EST / FAC-QT / FAC-PR / FAC-PAY
-- Per-year sequence. SECURITY DEFINER so it bypasses RLS on the counter table.
-- ---------------------------------------------------------------------------
create table if not exists facade.ref_counters (
  prefix text not null,
  year int not null,
  last_no int not null default 0,
  primary key (prefix, year)
);

create or replace function facade.next_ref(p_prefix text)
returns text
language plpgsql
security definer
set search_path = facade, pg_temp
as $$
declare
  v_year int := extract(year from now())::int;
  v_no int;
begin
  insert into facade.ref_counters (prefix, year, last_no)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year)
  do update set last_no = facade.ref_counters.last_no + 1
  returning last_no into v_no;
  return format('FAC-%s-%s-%s', p_prefix, v_year, lpad(v_no::text, 4, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at touch trigger for mutable master tables
-- ---------------------------------------------------------------------------
create or replace function facade.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['sections','materials','systems','projects'] loop
    execute format('drop trigger if exists trg_touch_%1$s on facade.%1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on facade.%1$s
         for each row execute function facade.touch_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Membership gate (mirrors cps.is_cps_user). A facade user is an active hub
-- employee whose role/grants include the `facade` module.
-- ---------------------------------------------------------------------------
create or replace function facade.is_facade_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = auth.uid()
      and coalesce(e.is_active, true)
      and (
        exists (
          select 1 from public.employee_module_access ema
          where ema.employee_id = e.id
            and ema.module_id = 'facade'
            and coalesce(ema.can_access, true)
        )
        or exists (
          select 1 from public.roles r
          where r.id = e.role
            and 'facade' = any (r.default_modules)
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Schema + object grants (RLS does the real gating, mirrors cps)
-- ---------------------------------------------------------------------------
grant usage on schema facade to anon, authenticated, service_role;
grant all on all tables in schema facade to anon, authenticated, service_role;
grant all on all sequences in schema facade to anon, authenticated, service_role;
grant execute on all functions in schema facade to anon, authenticated, service_role;
alter default privileges in schema facade grant all on tables to anon, authenticated, service_role;
alter default privileges in schema facade grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema facade grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on every facade table (PRD §4 block)
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='facade' loop
    execute format('alter table facade.%I enable row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Policies: 4 per table gated on facade.is_facade_user().
-- ref_counters is intentionally excluded (touched only via SECURITY DEFINER
-- next_ref), so it stays RLS-locked to direct client access.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname='facade' and tablename <> 'ref_counters'
  loop
    execute format('drop policy if exists %1$s_select on facade.%1$s;', t);
    execute format('drop policy if exists %1$s_insert on facade.%1$s;', t);
    execute format('drop policy if exists %1$s_update on facade.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on facade.%1$s;', t);

    execute format('create policy %1$s_select on facade.%1$s for select to public using (facade.is_facade_user());', t);
    execute format('create policy %1$s_insert on facade.%1$s for insert to public with check (facade.is_facade_user());', t);
    execute format('create policy %1$s_update on facade.%1$s for update to public using (facade.is_facade_user()) with check (facade.is_facade_user());', t);
    execute format('create policy %1$s_delete on facade.%1$s for delete to public using (facade.is_facade_user());', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Expose the facade schema to PostgREST (append-only; cps/finance untouched)
-- ---------------------------------------------------------------------------
alter role authenticator set pgrst.db_schemas = 'public, finance, cps, facade';
notify pgrst, 'reload config';
