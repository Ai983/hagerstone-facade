-- ============================================================================
-- facade_015_tenders.sql  — Step 1 of the guided flow: Tender (pre-project)
-- A tender is the entry point of a job, BEFORE a project exists. Scope items
-- (facade_009) can attach to a tender; "Convert to Project" carries them forward.
-- Additive + idempotent. Never touches cps / finance.
-- ============================================================================

create table if not exists facade.tenders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- FAC-TND-YYYY-NNNN
  client_name text not null,
  tender_name text not null,
  location text,
  site_address text,
  document_ref text,                         -- uploaded tender doc / drawing reference
  due_date date,
  status text default 'received',            -- received|scoping|qualified|converted|declined
  converted_project_id uuid references facade.projects(id),
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- let scope items attach to a tender (they already attach to a project)
alter table facade.tender_scope_items add column if not exists tender_id uuid references facade.tenders(id) on delete cascade;

-- keep updated_at fresh
drop trigger if exists trg_tenders_touch on facade.tenders;
create trigger trg_tenders_touch before update on facade.tenders
  for each row execute function facade.touch_updated_at();

-- RLS + grants (mirror the facade grant model)
do $$
declare t text;
begin
  foreach t in array array['tenders'] loop
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
