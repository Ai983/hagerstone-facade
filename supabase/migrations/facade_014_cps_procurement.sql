-- ============================================================================
-- facade_014_cps_procurement.sql  — One-click Procurement Request → CPS
-- Facade raises a CPS purchase requisition (assigned to Avisha) on demand.
-- Additive + idempotent. This is the ONLY place facade writes into cps, and it
-- does so through a controlled SECURITY DEFINER function (no direct table access).
-- ============================================================================

-- track the CPS PR created from a facade procurement_request
alter table facade.procurement_requests add column if not exists cps_pr_id uuid;
alter table facade.procurement_requests add column if not exists cps_pr_number text;

-- Controlled writer: creates a CPS purchase requisition + line items, assigned
-- to the procurement head (Avisha). SECURITY DEFINER so a facade user can raise
-- a PR without any direct grant on the cps schema.
create or replace function facade.raise_cps_pr(
  p_project_code text,
  p_project_site text,
  p_notes text,
  p_lines jsonb  -- [{description, quantity, unit, specs}]
)
returns jsonb
language plpgsql
security definer
set search_path = cps, facade, pg_temp
as $$
declare
  v_pr_id uuid;
  v_pr_number text;
  v_year int := extract(year from now())::int;
  v_seq int;
  v_line jsonb;
  v_avisha_id uuid := '5201704c-bbee-4d9d-a311-cfa44f6186f3'; -- procurement@hagerstone.com (procurement_head)
  v_sort int := 0;
begin
  -- only an active facade user may raise a PR
  if not facade.is_facade_user() then
    raise exception 'not authorised';
  end if;

  select coalesce(max(cast(split_part(pr_number, '-', 3) as int)), 0) + 1
  into v_seq
  from cps.cps_purchase_requisitions
  where pr_number like 'PR-' || v_year || '-%';

  v_pr_number := 'PR-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  insert into cps.cps_purchase_requisitions (
    pr_number, project_code, project_site, requested_by, assigned_to_user_id,
    status, priority, notes
  ) values (
    v_pr_number, p_project_code, p_project_site, v_avisha_id, v_avisha_id,
    'pending', 'normal', p_notes
  ) returning id into v_pr_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into cps.cps_pr_line_items (pr_id, description, quantity, unit, specs, sort_order)
    values (
      v_pr_id, v_line->>'description', (v_line->>'quantity')::numeric,
      v_line->>'unit', v_line->>'specs', v_sort
    );
    v_sort := v_sort + 1;
  end loop;

  return jsonb_build_object('pr_id', v_pr_id, 'pr_number', v_pr_number);
end;
$$;

grant execute on function facade.raise_cps_pr to authenticated, anon;
