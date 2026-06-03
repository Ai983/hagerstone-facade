# Hagerstone Facade System — Improvements PRD (v1.1 → v2)

**For:** Claude Code (VS Code) build agent
**Builds on:** the existing, deployed Facade System (`facade` schema in Hub Project). This PRD only **adds** to it.
**Scope:** estimator / costing workflow only — accuracy, error reduction, margin protection. No design / BIM / procurement / finance scope.
**Source:** internal facade-estimating market research (cut-optimization, live pricing, validation, feedback loops).

---

## 0. Golden rules for this whole PRD

1. **Never break the verified baseline.** Every new behaviour is a **toggle that defaults to the current logic** (flat wastage, static price, single % stack). The six seeded systems must still reproduce the Excel within ₹1 when all new toggles are OFF. Only when a user switches a feature ON does the rate change — and they must recalibrate.
2. **All new numbers are editable defaults**, never hardcoded constants. Wastage bands, scrap %, landed uplift, kerf, markup tiers — all live in editable config rows and are flagged "calibrate against real jobs."
3. **Additive, idempotent migrations only** (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, numbered `facade_003_*`, `facade_004_*`, …). Never edit a shipped migration.
4. **Never touch `cps` or `finance` schemas.**
5. Every change to a rate, markup, or config value writes to `facade.audit_log`.

---

## 1. What we are improving (point-wise index)

**v1.1 — Accuracy patch (small, ship first)**
1. Rate "valid until" date on the rate card + on every quotation
2. Auto-inserted price-escalation clause on quotations
3. Landed-cost base for aluminium (not bare stockist rate)
4. Calculator guardrails / validation warnings

**v1.2 — Defensible numbers**
5. Real 1D cut-optimization to replace the flat wastage %
6. Optional scrap-recovery credit
7. Estimate-vs-actual feedback loop

**v1.3 — Refinements**
8. Tiered / risk-based markup + separate contingency line
9. Calculated sealant/gasket consumption (bead volume)
10. Side-by-side scenario comparison with live margin
11. Version history + field-level audit on estimates

**v2 — Later / conditional (data- or volume-gated)**
12. AI quantity take-off from elevation drawings (buy a tool, human review)
13. AI rate-suggestion + anomaly/outlier flagging (needs 12–24 months of actuals from #7)

---

## 2. v1.1 — Accuracy patch

### Migration `facade_003_v1_1.sql`
```sql
-- 1 & 2: price validity + escalation on the rate card and quotations
alter table facade.rate_cards   add column if not exists valid_until date;
alter table facade.rate_cards   add column if not exists escalation_note text;
alter table facade.quotations   add column if not exists price_valid_until date;
alter table facade.quotations   add column if not exists escalation_clause text;

-- 3: landed-cost controls for aluminium (toggle defaults to OFF = current behaviour)
alter table facade.rate_cards add column if not exists aluminium_basis text default 'landed';        -- 'landed' | 'stockist'
alter table facade.rate_cards add column if not exists freight_handling_pct numeric(5,2) default 0;  -- uplift applied only when basis='stockist'
-- NOTE: GST is excluded from cost when ITC is claimed; this uplift is freight + unloading + handling only.

-- 4: calculator config + validation thresholds (single config row, editable)
create table if not exists facade.calc_config (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  num_value numeric,
  text_value text,
  description text,
  updated_by uuid references public.employees(id),
  updated_at timestamptz default now()
);
insert into facade.calc_config (key, num_value, description) values
  ('margin_floor_pct', 10, 'Warn if OH&profit below this %'),
  ('wastage_min_pct', 5, 'Warn if wastage below this %'),
  ('wastage_max_pct', 20, 'Warn if wastage above this %'),
  ('price_stale_days', 14, 'Warn if rate card older than this many days')
on conflict (key) do nothing;
```

### Logic
- **Landed base:** `aluminium_effective_per_kg = aluminium_per_kg × (1 + freight_handling_pct/100)` only when `aluminium_basis = 'stockist'`; otherwise use `aluminium_per_kg` as-is. Use `aluminium_effective_per_kg` everywhere the rate formula currently uses `aluminium_per_kg`. Default `basis='landed'`, `freight_handling_pct=0` → **no change to baseline.**
- **Validity/escalation:** when a quotation is generated, copy `valid_until` → `price_valid_until` and `escalation_note` → `escalation_clause`; render both on the PDF.
- **Guardrails (validation function, runs on calculate + on quote generation):** return a list of `{severity: warn|block, message}` for:
  - OH&profit % < `margin_floor_pct` (warn; block if you choose an approval gate)
  - effective wastage outside [`wastage_min_pct`, `wastage_max_pct`] (warn)
  - active rate card older than `price_stale_days` (warn)
  - labour_per_sqm = 0 or freight_per_sqm = 0 (warn)
  - sealant tubes implausible vs perimeter (warn — see §4.9 once built)

### Acceptance
- Toggles OFF → all 6 systems still match Excel within ₹1.
- Quotation PDF shows a valid-until date and escalation clause.
- Setting a system's OH&profit below the floor raises a visible warning before the quote can be sent.

---

## 3. v1.2 — Defensible numbers

### Migration `facade_004_v1_2.sql`
```sql
-- 5: cut-optimization parameters (editable; defaults reproduce a 6 m bar)
alter table facade.systems add column if not exists use_cut_optimization boolean default false; -- OFF = keep flat wastage_pct
alter table facade.rate_cards add column if not exists stock_bar_length_m numeric(6,3) default 6.0;
alter table facade.rate_cards add column if not exists kerf_mm numeric(6,2) default 4;
alter table facade.rate_cards add column if not exists bar_trim_mm numeric(6,2) default 15;
alter table facade.rate_cards add column if not exists min_usable_offcut_mm numeric(8,2) default 500;

-- 6: scrap recovery credit (OFF by default)
alter table facade.systems   add column if not exists apply_scrap_credit boolean default false;
alter table facade.rate_cards add column if not exists scrap_recovery_pct numeric(5,2) default 70; -- % of metal value for clean 6063

-- store the optimization result for transparency
alter table facade.system_rates add column if not exists optimized_wastage_pct numeric(6,2);
alter table facade.system_rates add column if not exists offcut_kg numeric(12,3);
alter table facade.system_rates add column if not exists scrap_credit_amount numeric(14,2);

-- 7: estimate vs actual feedback loop
create table if not exists facade.actuals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references facade.projects(id) on delete cascade,
  estimate_id uuid references facade.estimates(id),
  total_alu_kg_actual numeric(14,3),
  wastage_pct_actual numeric(6,2),
  labour_cost_actual numeric(16,2),
  freight_cost_actual numeric(16,2),
  material_cost_actual numeric(16,2),
  notes text,
  recorded_by uuid references public.employees(id),
  recorded_at timestamptz default now()
);
```

### 1D cut-optimization algorithm (per profile section)
```
For each system S with use_cut_optimization = true:
  usable_bar_mm = (stock_bar_length_m * 1000) - bar_trim_mm
  Group S.members by section_id (same profile = nestable together).
  For each group:
     pieces = expand every member into a flat list of cut lengths in mm,
              repeated (member.number * member.qty) times.
     Sort pieces descending (First-Fit-Decreasing).
     Pack into bars: a piece fits in a bar if
        (current_bar_used + piece_mm + (kerf_mm if bar already has a piece else 0)) <= usable_bar_mm
     bars_used = number of bars opened.
     purchased_mm   = bars_used * (stock_bar_length_m * 1000)
     used_mm        = sum(pieces) + kerf_mm * (pieces_count - bars_used)
     offcut_mm      = purchased_mm - used_mm
     unit_weight    = member.unit_weight_kg_per_m (or section default) for that group
     purchased_kg  += (purchased_mm/1000) * unit_weight
     offcut_kg     += (offcut_mm/1000) * unit_weight
  total_alu_kg (optimized) = purchased_kg          // you buy whole bars
  optimized_wastage_pct = offcut_mm_total / used_mm_total * 100

Aluminium cost then uses total_alu_kg (optimized) instead of (used_kg * (1 + flat wastage)).
If apply_scrap_credit: scrap_credit = offcut_kg * aluminium_effective_per_kg * scrap_recovery_pct/100
   subtract scrap_credit from material_total.
```
When `use_cut_optimization = false`, keep the existing flat-`wastage_pct` path untouched (baseline preserved).

### Estimate-vs-actual
- Screen on a completed project to enter actuals; compute and display variance vs the estimate (alu kg, wastage %, labour, material, final).
- A "suggested defaults" panel: rolling average of `wastage_pct_actual` and labour per sqm across recent jobs → one-click to update a system's default (with confirmation + audit).

### Acceptance
- With optimization OFF, baseline unchanged.
- With optimization ON for a test system, the tool shows bars used, purchased kg, offcut kg, and a real wastage % — and recomputes rate/sqm using purchased metal.
- Entering actuals for a job produces a correct variance report; the suggested-default action updates only on confirm and is audit-logged.

---

## 4. v1.3 — Refinements

### Migration `facade_005_v1_3.sql`
```sql
-- 8: tiered markup + contingency
create table if not exists facade.markup_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- e.g. Standard / New-system / Complex / High-rise-coastal
  risk_level text,                    -- low|medium|high
  markup_pct numeric(5,2) not null,   -- replaces oh_profit_pct when chosen
  contingency_pct numeric(5,2) default 0,
  is_active boolean default true
);
alter table facade.estimates add column if not exists markup_tier_id uuid references facade.markup_tiers(id);
alter table facade.estimates add column if not exists contingency_pct numeric(5,2) default 0;

-- 9: sealant / gasket bead-volume calc
alter table facade.system_materials add column if not exists is_sealant boolean default false;
alter table facade.system_materials add column if not exists perimeter_m numeric(12,3);
alter table facade.system_materials add column if not exists structural_bite_mm numeric(8,2);
alter table facade.system_materials add column if not exists glueline_mm numeric(8,2);
alter table facade.system_materials add column if not exists tube_volume_ml numeric(8,2);

-- 10 & 11: scenarios + revision snapshots
alter table facade.estimates add column if not exists scenario_label text;     -- group alternates of one project
create table if not exists facade.estimate_revisions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references facade.estimates(id) on delete cascade,
  snapshot jsonb not null,            -- full estimate + lines + rates at save time
  changed_by uuid references public.employees(id),
  changed_at timestamptz default now(),
  change_note text
);
```

### Logic
- **Tiered markup:** when an estimate has a `markup_tier_id`, use that tier's `markup_pct` in place of the system `oh_profit_pct`, and add `contingency = basic × contingency_pct/100` as a **separate, labelled line** (not buried). Approval gate: estimates below `margin_floor_pct` need a manager flag.
- **Sealant bead volume:** for materials where `is_sealant = true`,
  `tubes = (perimeter_m × structural_bite_mm × glueline_mm) / tube_volume_ml`
  (perimeter in m, bite & glueline in mm, tube volume in ml). Use `ceil(tubes)` for purchase qty; feed into consumable_total. Add a guardrail if computed tubes deviates >50% from any manually entered qty.
- **Scenario comparison:** list estimates sharing a project with different `scenario_label` side by side — area, rate/sqm, final, margin — recalculated live.
- **Revisions:** on each estimate save, write a `snapshot` JSON; provide a diff view (what rate/markup/line changed, by whom).

### Acceptance
- Choosing a markup tier changes the rate predictably and shows contingency as its own line.
- Sealant qty auto-computes and matches a hand check; deviation guardrail fires when forced wrong.
- Two scenarios of one project show side by side with correct, independent totals.
- Every estimate save creates a restorable revision with author + note.

---

## 5. v2 — Later / conditional (do not build now)

### 12. AI quantity take-off from elevations (buy, don't build)
- Integrate an external takeoff tool (e.g. Togal/Kreo/Beam-class) **only if** elevation-takeoff volume is high. Feed extracted per-system areas into `estimate_lines` via the existing Edge-Function/Claude-proxy pattern, **with a mandatory human-review step**. Confidence contract: `{fields, confidence, confidence_reason}`, ≥70 auto-fill / <70 manual.
- **Gate:** justify by takeoff volume; pilot before rollout. Independent evidence (Univ. of Kansas study) suggests ~70% time saving and ~5% accuracy band — verify on your own drawings.

### 13. AI rate-suggestion + anomaly/outlier flagging
- **Gate:** requires 12–24 months of clean `facade.actuals` + estimate history (built in v1.2 #7). First step is a simple statistical outlier flag ("this rate/sqm is X% off your historical band for this system"), **not** ML. Human-in-the-loop only.

---

## 6. Build order

| Step | Migration | Deliverable | Gate |
|---|---|---|---|
| 1 | facade_003 | v1.1: validity/escalation, landed base, guardrails | Baseline ₹1 still green with toggles OFF |
| 2 | facade_004 | v1.2: cut-optimization, scrap credit, actuals loop | Optimization OFF = baseline; ON = shows bars/offcut/real % |
| 3 | facade_005 | v1.3: tiered markup, sealant calc, scenarios, revisions | Each feature's acceptance met |
| 4 | — | v2: AI takeoff + anomaly (only when gates met) | Volume / data gates satisfied |

Ship v1.1 to production on its own; it is low-risk and protects margin immediately. v1.2 and v1.3 follow once each passes its acceptance gate.

---

## 7. Conventions (carry into every session)
- Match the existing facade app: stack, Supabase client, auth, UI (shadcn), reference-ID helper, audit logging.
- New behaviour = toggle defaulting to current logic; baseline ₹1 match must survive every migration with toggles OFF.
- All thresholds/percentages live in `facade.calc_config`, `facade.rate_cards`, `facade.markup_tiers` as **editable** values; none hardcoded.
- Additive, idempotent, numbered migrations; never edit shipped ones.
- No writes to `cps` / `finance`.
- Audit every rate/markup/config change.

---

## 8. Honest caveats (state these in the UI, not just here)
- Default bands shipped here — wastage 5–20%, scrap recovery ~70%, kerf 4 mm, trim 15 mm, min offcut 500 mm, margin floor 10% — are **rules of thumb from research, not company-verified.** Treat as starting defaults and **calibrate from `facade.actuals`** before trusting them on live bids.
- The landed-cost uplift excludes GST on the assumption ITC is claimed; confirm with finance before enabling.
- Cut-optimization output is an *estimate* of offcut, not a fabrication cut-plan; real shop optimization (and any CNC) remains separate.
- AI items (v2) are deliberately gated; do not enable rate-suggestion/anomaly until real historical data exists, or it will produce confident-but-wrong numbers.
