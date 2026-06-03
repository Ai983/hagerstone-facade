# Hagerstone Facade System — Product Requirements Document (PRD)

**For:** Claude Code (VS Code) build agent
**Owner:** AI Hagerstone
**Status:** Build-ready. This document is the single source of truth. Build phase by phase; do not skip the acceptance checks.

---

## 0. How to use this PRD with Claude Code

1. Place this file (`FACADE_SYSTEM_PRD.md`) and `Consumption.xlsx` in the repo root.
2. Have the `hagerstone-cps` repo openable nearby — several steps say "replicate the cps pattern."
3. Connect Supabase (MCP) in Claude Code, or be ready to run SQL in the Supabase SQL Editor.
4. Work **one phase at a time** (§9). After each phase, confirm its **Acceptance Criteria** before moving on.
5. Hard rule: never modify the `cps` or `finance` schemas. Facade is self-contained.

---

## 1. Product summary

A self-contained **Facade System** that takes a job from enquiry → rate calculation → estimate/BOQ → quotation → execution tracking. It is a new module in the existing **Hub Project** (Supabase `tpfvnerrjhqwipyonngf`), with its own `facade` schema. It shares only the hub login. It keeps its **own** rate/BOQ engine (the `cps` BOQ tables are not used). Procurement/payment export to cps/finance is built but dormant (downloads only).

The core is a **rate calculator** that exactly reproduces the company's `Consumption.xlsx` costing logic.

---

## 2. Architecture (decided)

- **Frontend:** React + Vite + TypeScript + Tailwind + shadcn/ui, deployed on **Vercel**. (Same stack as cps.)
- **Data + Auth:** **Supabase** (Hub Project). New `facade` schema. Row-Level Security on. Auth shared with the hub (SSO via token handoff — replicate cps's `AuthCallback` + `ProtectedRoute`).
- **Server-side logic:** **Supabase Edge Functions** only, for: (a) the Claude AI proxy (never call Anthropic from the browser), (b) optional PDF generation. Mirror the cps `callClaude` proxy approach.
- **No separate Express/Railway backend.** Not needed (no mobile app, OCR, WebSockets, or cron). Revisit only if a facade mobile app or heavy background jobs appear later; the data layer would not change.
- **Rate engine:** a pure TypeScript function in the frontend for instant live calculation; computed snapshots persisted to the DB.

---

## 3. Users & roles

Roles come from the hub (`public.roles`). Facade uses existing roles; no new role required for v1:

| Role | Can do |
|---|---|
| admin / ai | Everything, including edit rate cards, sections, materials, system definitions |
| founder / management | View everything incl. cost/margin; approve quotations |
| project_manager | Create projects, estimates, quotations; run execution stages |
| (estimator) | Optional later: a role that edits estimates but cannot see OH&profit margin |

Cost/margin visibility: founders/management/admin see full build-up incl. OH&profit. (If you later add an `estimator` role, hide `oh_profit` figures from it — make this a simple role check, not a schema change.)

---

## 4. Data model — `facade` schema

Run as migration `facade_001_init.sql`. Additive, idempotent. (Full SQL — implement exactly.)

```sql
create schema if not exists facade;

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

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='facade' loop
    execute format('alter table facade.%I enable row level security;', t);
  end loop;
end $$;
```

**RLS:** read how cps writes its policies and replicate the same grant model on the facade tables. Do not leave RLS enabled with no policies.

**Reference IDs:** create a helper (Postgres function or TS util) generating `FAC-PRJ-YYYY-NNNN`, `FAC-EST-…`, `FAC-QT-…`, `FAC-PR-…`, `FAC-PAY-…` with a per-year sequence. Reuse one helper everywhere.

---

## 5. THE RATE FORMULA (verified against `Consumption.xlsx`)

This is the contract for the calculator. Verified: louvre 46,033.77 ÷ 4.9866 = **₹9,231.45** ✓; straight glazing and others follow identically.

```
Inputs: system S, its members[], its materials[], active rate_card R.

1) total_alu_kg = Σ ( member.cutlength_m * member.number * member.qty
                      * (member.unit_weight_kg_per_m or section.default_unit_weight_kg_per_m) )

2) aluminium_cost  = total_alu_kg * R.aluminium_per_kg
   conversion_cost = total_alu_kg * R.conversion_per_kg
   coating_cost    = S.apply_powder_coating ? total_alu_kg * R.powder_coating_per_kg : 0

3) for each system_material sm: rate = coalesce(sm.rate_override, material.default_rate); line = sm.qty * rate
   consumable_total = Σ line where NOT is_infill
   infill_total     = Σ line where is_infill
   wastage_cost     = infill_total * (S.wastage_pct / 100)

4) material_total = aluminium_cost + conversion_cost + coating_cost
                    + consumable_total + infill_total + wastage_cost

5) area = S.panel_area_sqm
   labour_cost  = area * S.labour_per_sqm
   freight_cost = area * S.freight_per_sqm
   basic        = material_total + labour_cost + freight_cost

6) design = basic * S.design_pct/100   (ALL FOUR % applied on basic, not compounding)
   misc   = basic * S.misc_pct/100
   pmc    = basic * S.pmc_pct/100
   ohp    = basic * S.oh_profit_pct/100
   final  = basic + design + misc + pmc + ohp
   rate_per_sqm = final / area
```

The calculator must return both `rate_per_sqm` and a full `breakdown` (every line above) for display and for the `system_rates.breakdown` snapshot.

---

## 6. Seed data (Phase 2)

Verified globals — seed directly:
- Rate card "Base Rate Card 2026": aluminium ₹297/kg, conversion ₹55/kg, powder coating ₹70/kg.

Verified per-system parameters:

| System | code | category | labour | freight | wastage | design | misc | pmc | OH&profit | coating |
|---|---|---|---|---|---|---|---|---|---|---|
| Straight Glazing | SG | glazing | 900 | 400 | 10 | 2.5 | 2.5 | 5 | 18 | yes |
| Curved Glazing | CG | glazing | 900 | 400 | 10 | 2.5 | 2.5 | 5 | 18 | yes |
| Alu. Louvres | LV | louvre | 800 | 400 | 10 | 2.5 | 2.5 | 5 | 18 | yes |
| ACP | ACP | acp | 800 | 300 | 10 | 2.5 | 2.5 | 5 | 10 | no |
| Frameless Doors | FD | door | 900 | 300 | 10 | 2.5 | 2.5 | 5 | 10 | n/a |
| Alu. Railing | RL | railing | 800 | 300 | 10 | 2.5 | 2.5 | 5 | 10 | yes |

Verified material rates: silicone ₹700/bottle · MS bracket ₹130/kg · Hilti fastener ₹160/pcs (override ₹140 on LV/ACP/RL) · screw 19×8 ₹0.5/pcs · screw 38×8 ₹0.6/pcs · EPDM ₹60/mtr (₹70 on RL) · glass 6+12+6 DGU ₹3000/sqm · curved glass ₹8000/sqm · ACP-Alucobond ₹2510/sqm · 24mm DGU ₹3000/sqm · Dorma machine set ₹12500/set · Dorma handle ₹5500/pcs.

**Member rows (section_no, cutlength, number, qty, unit weight): PARSE from `Consumption.xlsx` — do not hand-type.** Then verify each computed rate matches the sheet (§8 acceptance).

---

## 7. Feature requirements & acceptance criteria

### F1 — Rate Calculator (MVP)
- Manage sections, materials, and the active rate card.
- List systems; open one to edit members, materials, and parameters; show the live cost build-up; recalc on every edit.
- "Save snapshot" writes `system_rates` (rate + breakdown JSON).
- **Acceptance:** all 6 seeded systems compute `rate_per_sqm` within **₹1** of the Excel's "Rate per sqm".

### F2 — Projects & Estimates
- Create project (FAC-PRJ). Create estimate (FAC-EST) with lines: pick system, enter elevation_ref + area_sqm; rate snapshotted from current system rate; amount = area × rate; show estimate total; support versioning.
- **Acceptance:** a project with 2+ systems shows a correct total; revising creates version 2 without losing version 1.

### F3 — Quotations
- Generate quotation (FAC-QT) from an estimate; client fields (valid_until, terms, status); export clean PDF (company header, lines, totals, terms).
- **Acceptance:** PDF renders all lines + totals; status changes are audit-logged.

### F4 — Execution stages
- On quotation approval, seed standard stages (survey → … → handover); board view with owner/status/timestamps; aging colours (<12h green, 12–24h yellow, 24–48h amber, >48h red).
- **Acceptance:** approving a quotation auto-creates the stage list; stage status updates persist and are audit-logged.

### F5 — Export (dormant)
- "Export to CPS": build procurement_request + lines + payload; download JSON/CSV; mark exported. **No writes to cps schema.**
- "Export to Finance": build payment + payload; download JSON/CSV. **No writes to finance schema.**
- Payload shapes mirror cps procurement / finance payment columns (read-only inspect those at build time).
- **Acceptance:** exports produce a file and set the exported flag; cps/finance schemas are untouched (verify).

### F6 — AI assists (last, optional)
- Elevation PDF → per-system area take-off prefilling estimate lines, via Supabase Edge Function calling the Claude proxy. Confidence contract: `{fields, confidence, confidence_reason}`; ≥70 auto-fill, <70 manual + warning; store `*_source`.
- **Acceptance:** uploading a sample elevation returns areas; low-confidence shows the manual form.

---

## 8. Global acceptance gate (do not skip)
Phase 3 / F1 is the proof point: **the system is not correct until all six seeded systems reproduce the Excel's Rate/sqm within ₹1.** Block further phases until this passes.

---

## 9. Build sequence (one phase per Claude Code session)

| Phase | Deliverable |
|---|---|
| 0 | Scaffold app (Vite+React+TS+Tailwind+shadcn); copy cps Supabase client + AuthCallback + ProtectedRoute |
| 1 | Run `facade_001_init.sql`; add RLS policies (mirror cps) |
| 1b | Register `facade` module: append to default_modules of admin/ai/founder/management/project_manager; insert employee_module_access rows (public only) |
| 2 | Seed rate card, systems, materials (verified values) + parse members from Excel → `facade_002_seed.sql` |
| 3 | F1 Rate Calculator + **₹1 verification** |
| 4 | F2 Projects & Estimates |
| 5 | F3 Quotations + PDF |
| 6 | F4 Execution stages |
| 7 | F5 Export hooks (dormant) |
| 8 | F6 AI assists (Edge Function + Claude proxy) |
| 9 | Deploy to Vercel (same Supabase env as cps; redeploy after env change); add facade URL to hub portal; test SSO |

---

## 10. Conventions (carry into every session)
- Match cps: stack, Supabase client, auth flow, UI (shadcn), AI proxy, reference-ID helper, audit logging.
- Migrations additive + idempotent + numbered; never edit a shipped migration in place.
- **Never** write to `cps` or `finance` schemas. Read-only reference at export-mapping time only.
- All `default_modules` edits: verify column type first; append only; remove nothing; show before/after.
- Every create/update/delete on project, estimate, quotation, rate card, system → `facade.audit_log`.
- No secrets in frontend; Anthropic calls only via the Edge Function proxy.

---

## 11. Out of scope (v1)
Mobile app; CNC/cut-nesting optimization (wastage stays a % parameter for now); live two-way cps/finance integration (export is one-way file for now); structural/U-value engineering calcs.
