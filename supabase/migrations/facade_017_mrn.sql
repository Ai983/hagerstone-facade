-- ============================================================================
-- facade_017_mrn.sql  — Step 7: Material Receiving Note (MRN)
-- When goods are delivered against a procurement request, the store team records
-- what actually arrived (ordered vs received). An MRN can then raise a vendor
-- payable in finance. Manual entry; additive + idempotent. Never touches cps.
-- ============================================================================

create table if not exists facade.material_receiving_notes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                  -- FAC-MRN-YYYY-NNNN
  project_id uuid not null references facade.projects(id) on delete cascade,
  procurement_request_id uuid references facade.procurement_requests(id),
  vendor_name text,
  vendor_gstin text,
  invoice_ref text,
  received_date date default current_date,
  status text default 'received',             -- received|partial|verified|rejected
  notes text,
  total_value numeric(18,2) default 0,
  created_by uuid references public.employees(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists facade.mrn_line_items (
  id uuid primary key default gen_random_uuid(),
  mrn_id uuid not null references facade.material_receiving_notes(id) on delete cascade,
  procurement_line_id uuid references facade.procurement_lines(id),
  material_id uuid references facade.materials(id),
  description text,
  ordered_qty numeric(14,3) default 0,
  received_qty numeric(14,3) not null default 0,
  unit text,
  rate numeric(14,2) default 0,
  amount numeric(18,2) generated always as (received_qty * coalesce(rate,0)) stored,
  sort_order integer default 0
);

drop trigger if exists trg_mrn_touch on facade.material_receiving_notes;
create trigger trg_mrn_touch before update on facade.material_receiving_notes
  for each row execute function facade.touch_updated_at();

-- RLS + grants (mirror the facade grant model)
do $$
declare t text;
begin
  foreach t in array array['material_receiving_notes','mrn_line_items'] loop
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
