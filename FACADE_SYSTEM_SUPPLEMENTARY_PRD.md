# Hagerstone Facade System — Supplementary Improvements PRD (Competitor-Research Items)

**For:** Claude Code (VS Code)
**Relationship:** This is a **separate** PRD. It does **not** replace `FACADE_SYSTEM_IMPROVEMENTS_PRD.md` (v1.1–v2). It adds only the items that competitor research surfaced as genuinely new — everything else in that research already matched the existing plan.
**Scope:** estimator / costing only. No design, BIM, structural, production/CNC, procurement, or finance scope.

---

## 0. Golden rules (same as the main PRD)
1. **Never break the verified baseline.** Every feature here is a **toggle that defaults to current behaviour**; the six seeded systems must still match the Excel within ₹1 when toggles are OFF.
2. **All numbers are editable defaults**, never hardcoded; flagged "calibrate against real jobs."
3. **Additive, idempotent migrations only**, numbered to continue the existing series: `facade_006_*` onward. Never edit a shipped migration.
4. **Never touch `cps` or `finance` schemas.**
5. Audit every rate/config change to `facade.audit_log`.

---

## 1. Items in this PRD

| # | Item | Value | Effort |
|---|---|---|---|
| A1 | Pre-built parametric assemblies (reusable building blocks) | Speed of estimating | Medium |
| A2 | 2D sheet nesting for ACP & glass (real sheet wastage) | Accuracy beyond aluminium | High |
| A3 | Semi-live LME-linked aluminium price feed (automation) | Margin (price freshness) | Medium |
| A4 | Import-duty line in landed cost | Accuracy (if importing) | Low |
| A5 | Profile/glass compatibility warnings (light, optional) | Error catch | Low |
| AI-1 | Takeoff from elevation drawings (areas, piece sizes, counts) | Accuracy: removes manual measure/count error | High |
| AI-2 | Scope/spec extraction from tender documents | Margin: stops missed-scope underquoting | Medium |
| AI-3 | Material-price parsing from supplier quotes/emails | Accuracy: fresh prices | Medium |
| AI-4 | Estimate "second-checker" (AI review + risk narrative) | Error catch / QA | Low–Medium |
| AI-5 | Natural-language estimate drafting | Speed / consistency | Low–Medium |
| AI-6 | Rate/labour suggestion from history (gated) | Accuracy (after data) | Medium |
| AI-7 | Anomaly/outlier flagging (gated) | Error catch (after data) | Medium |
| AI-8 | Estimate-vs-actual variance analysis (gated) | Self-improving accuracy | Medium |

The **A-items** come from competitor research; the **AI-items** are the AI integration layer (full detail in §6). All are additive and toggled; gated AI features ship disabled.

Deliberately **excluded** (research mentioned them, but they cross your scope): structural validation/moment-of-inertia, 3D/BIM, production/CNC, and embodied-carbon/sustainability tracking. See §8.

---

## 2. A1 — Parametric assemblies

**Problem:** today every estimate is built from raw members per full system. Competitors get speed from reusable parametric "building blocks" (a bay = mullion + transoms + glass) the estimator drops in and scales. This keeps your bottom-up logic but removes repetitive re-entry.

### Migration `facade_006_assemblies.sql`
```sql
create table if not exists facade.assemblies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  category text, description text,
  base_width_mm numeric(10,1) not null,
  base_height_mm numeric(10,1) not null,
  apply_powder_coating boolean default true,
  labour_per_sqm numeric(12,2) default 0, freight_per_sqm numeric(12,2) default 0,
  wastage_pct numeric(5,2) default 10, design_pct numeric(5,2) default 2.5,
  misc_pct numeric(5,2) default 2.5, pmc_pct numeric(5,2) default 5,
  oh_profit_pct numeric(5,2) default 18,
  is_active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists facade.assembly_members (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references facade.assemblies(id) on delete cascade,
  section_id uuid references facade.sections(id),
  member_name text not null,
  orientation text not null default 'fixed',     -- horizontal | vertical | fixed
  base_cutlength_m numeric(12,4) default 0,       -- used only when orientation='fixed'
  number integer not null default 0,
  qty numeric(12,4) not null default 1,
  unit_weight_kg_per_m numeric(10,3),
  sort_order integer default 0
);

create table if not exists facade.assembly_materials (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references facade.assemblies(id) on delete cascade,
  material_id uuid references facade.materials(id),
  qty_per_unit numeric(14,4) default 0,           -- consumables: per-assembly qty
  is_infill boolean default false,                -- infill area derived from W×H
  wastage_applies boolean default false,
  sort_order integer default 0
);

-- instantiate an assembly into an estimate line
alter table facade.estimate_lines add column if not exists assembly_id uuid references facade.assemblies(id);
alter table facade.estimate_lines add column if not exists inst_width_mm numeric(10,1);
alter table facade.estimate_lines add column if not exists inst_height_mm numeric(10,1);
alter table facade.estimate_lines add column if not exists inst_count integer default 1;
```

### Scaling logic (estimating-grade)
```
For an assembly instantiated at width W mm, height H mm, count N:
  member length_m = orientation = 'horizontal' -> W/1000
                    orientation = 'vertical'   -> H/1000
                    orientation = 'fixed'      -> base_cutlength_m
  per-assembly RMT(member) = length_m * member.number * member.qty
  line RMT(member)         = per-assembly RMT * N
  infill area per assembly = (W/1000) * (H/1000)   ; line infill area = area * N
  consumable qty           = assembly_material.qty_per_unit * N
Then apply the EXISTING rate formula (metal kg→cost, consumables, infill, wastage,
labour/sqm, freight/sqm, %-stack) using the assembly's own parameters.
```
Note: this is a **geometric estimating approximation**, not a shop drawing. It is for fast, consistent quoting — real fabrication lengths still come from drawings.

### Acceptance
- Create an assembly; instantiate it at a new W×H and count; member RMT, infill area, and consumables scale correctly (matches a manual check).
- An estimate built from assemblies produces the same total as the equivalent raw-member estimate, within rounding.
- Assemblies are optional; existing system-based estimates are unaffected.

---

## 3. A2 — 2D sheet nesting for ACP & glass

**Problem:** your planned cut-optimization (main PRD v1.2) is **1D** for aluminium bars. ACP and glass are cut from **sheets**, so their wastage should be derived by **2D nesting**, not a flat % on area.

### Migration `facade_007_sheet_nesting.sql`
```sql
alter table facade.materials add column if not exists sheet_width_mm numeric(10,1);
alter table facade.materials add column if not exists sheet_height_mm numeric(10,1);
alter table facade.materials add column if not exists sheet_edge_trim_mm numeric(8,2) default 10;
alter table facade.systems    add column if not exists use_sheet_optimization boolean default false;
alter table facade.assemblies add column if not exists use_sheet_optimization boolean default false;

-- individual infill piece sizes (needed for nesting; total-area entry still works when OFF)
create table if not exists facade.infill_pieces (
  id uuid primary key default gen_random_uuid(),
  system_id uuid references facade.systems(id) on delete cascade,
  assembly_id uuid references facade.assemblies(id) on delete cascade,
  estimate_line_id uuid references facade.estimate_lines(id) on delete cascade,
  material_id uuid references facade.materials(id),
  width_mm numeric(10,1) not null, height_mm numeric(10,1) not null,
  count integer not null default 1, allow_rotation boolean default true,
  sort_order integer default 0
);

alter table facade.system_rates add column if not exists sheet_wastage_pct numeric(6,2);
alter table facade.system_rates add column if not exists sheets_used jsonb;
```

### 2D nesting algorithm (heuristic — shelf / guillotine FFDH)
```
For each material group (same ACP/glass type) with use_sheet_optimization = true:
  usable_w = sheet_width_mm  - 2*sheet_edge_trim_mm
  usable_h = sheet_height_mm - 2*sheet_edge_trim_mm
  pieces = expand infill_pieces (respect count); optionally rotate to fit.
  Sort pieces by height descending. Place into horizontal "shelves" on a sheet
  (First-Fit Decreasing Height); open a new sheet when a piece fits on none.
  sheets_used  = number of sheets opened
  used_area    = Σ piece area ; sheet_area = sheet_width*sheet_height*sheets_used
  sheet_wastage_pct = (sheet_area - used_area)/sheet_area * 100
  infill_cost  = sheets_used * (priced per sheet)  OR  sheet_area_sqm * rate_per_sqm
```
When `use_sheet_optimization = false`, keep the existing flat-wastage-on-area path (baseline preserved).

### Honesty / limits
- This is a **rectangular, guillotine heuristic** — good for ACP and rectangular glass lites; it will not perfectly model L-shapes, complex cut-outs, or grain direction. It is an estimating tool, not a glass-cutting optimizer.
- Do this **only after** the 1D aluminium optimization (main PRD v1.2 #5) is working and verified.

### Acceptance
- Toggle OFF → baseline area-based costing unchanged.
- Toggle ON with a set of ACP piece sizes → returns sheets used, real sheet wastage %, and a recomputed infill cost that matches a manual sheet-count check.

---

## 4. A3 + A4 — Price-feed automation & import duty

**Problem:** v1.1 already adds validity dates + landed base, but updates are manual. Competitors push live LME-linked feeds. Also, imported aluminium/hardware carries customs duty not yet modelled.

### Migration `facade_008_pricing.sql`
```sql
alter table facade.rate_cards add column if not exists import_duty_pct numeric(5,2) default 0;
alter table facade.rate_cards add column if not exists price_source text default 'manual';  -- manual | feed

create table if not exists facade.price_feed_log (
  id uuid primary key default gen_random_uuid(),
  metal text default 'aluminium',
  index_name text,                         -- e.g. LME-3M, MCX Aluminium
  value_per_kg_inr numeric(12,2),
  fetched_at timestamptz default now(),
  source_note text
);
```

### Logic
- **Effective metal rate (extends v1.1 landed model):**
  `aluminium_effective_per_kg = aluminium_per_kg * (1 + freight_handling_pct/100 + import_duty_pct/100)`
  applied only when `aluminium_basis <> 'landed'`. Default duty 0 → no baseline change.
- **Feed (optional Edge Function on a schedule):** fetch a configured index, write a `price_feed_log` row. If `price_source='feed'`, surface "latest index = X, your rate card = Y, updated Z days ago" and offer a **one-click, audited** update of `aluminium_per_kg` — **human-in-the-loop, never silent.**

### Honesty
- A reliable, free INR aluminium feed is **not guaranteed**. Treat the feed as optional; the realistic default is **manual entry + the staleness reminder** from v1.1, with a paid/official index only if justified. Do not block quoting on a feed.

### Acceptance
- Setting `import_duty_pct` raises the effective metal rate correctly; 0 leaves baseline unchanged.
- If a feed is configured, a stale rate card shows the latest index and a confirm-to-update action that writes an audit row; if no feed, manual entry + reminder still works.

---

## 5. A5 — Compatibility warnings (optional, light)

**Problem:** a cheap error-catch competitors get from plausibility checks — e.g. a glass thickness that doesn't suit a chosen pressure plate. This is a **warning only**, explicitly **not** structural engineering.

### Migration `facade_009_compat.sql`
```sql
create table if not exists facade.compatibility_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,                 -- e.g. glass_thickness_vs_pressure_plate
  section_id uuid references facade.sections(id),
  material_id uuid references facade.materials(id),
  min_value numeric, max_value numeric,
  severity text default 'warn',            -- warn only
  message text, is_active boolean default true
);
```
Feed these into the existing guardrail/validation engine (main PRD v1.1 #4). Warn, never block. Keep the rule set small and editable.

### Acceptance
- A configured rule fires a warning on a non-compatible pairing; with no rules configured, nothing changes.

---

## 6. AI integration (AI-1 – AI-8)

**Purpose:** make the estimator faster and less error-prone with AI, *without* letting AI invent priced numbers. Honest framing: in 2026 the verified benefit of AI in estimating is mostly **speed/volume**; accuracy gains are smaller and **depend on drawing quality and your own historical data**. So AI is applied where it removes human error (takeoff, scope capture, fresh prices, QA), and anything that *suggests numbers* is gated until your data exists.

### 6.0 AI architecture & guardrails (apply to every AI feature)
- All AI calls go through the existing Claude proxy / Supabase **Edge Function** — never frontend → API; no keys in the browser.
- **Confidence contract:** every AI response returns `{fields, confidence (0–100), confidence_reason}`. `confidence ≥ ai_config.confidence_threshold` (default 70) → prefill; below → manual form with a visible warning. Store `source` = `ai_extracted | ai_override | manual` on every AI-populated row.
- **Human-in-the-loop on anything touching price or quantity.** AI never finalises a rate, quantity, or quote on its own.
- Every AI run is logged (`facade.ai_runs`); every accepted AI value is audited.

### Migration `facade_010_ai_core.sql`
```sql
create table if not exists facade.ai_config (
  id uuid primary key default gen_random_uuid(),
  feature text unique not null,            -- takeoff|scope|price_parse|review|nl_draft|rate_suggest|anomaly|variance
  enabled boolean default false,           -- gated features ship disabled
  confidence_threshold numeric(5,2) default 70,
  provider text default 'claude_proxy',
  notes text,
  updated_at timestamptz default now()
);

create table if not exists facade.ai_runs (
  id uuid primary key default gen_random_uuid(),
  feature text not null,
  input_ref text,                          -- doc id / estimate id / etc.
  output jsonb,
  confidence numeric(5,2),
  confidence_reason text,
  accepted boolean,
  actor_id uuid references public.employees(id),
  created_at timestamptz default now()
);

-- provenance on AI-populated rows
alter table facade.estimate_lines add column if not exists source text default 'manual'; -- manual|ai_extracted|ai_override
alter table facade.infill_pieces  add column if not exists source text default 'manual';

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
```

### Tier 1 — AI that removes human error (build now)
- **AI-1 Takeoff from elevation drawings.** Upload an elevation (PDF/CAD/image) to `facade.documents`; an Edge Function extracts per-system **areas, individual panel sizes (W×H), counts, and a system-type guess**. Writes `estimate_lines` (source=`ai_extracted`) and `infill_pieces` (feeding A2 2D nesting). **Mandatory human verification of dimensions.** Two options: (a) Claude vision via the proxy, or (b) integrate a specialist takeoff tool (Togal/Kreo/Beam AI) and import its quantities. Works best on clean vector/CAD; degrades on poor scans; not for hand sketches.
- **AI-2 Scope/spec extraction from tender documents.** Parse a tender BOQ/spec into `tender_scope_items` — items, specs, quantities — and **flag ambiguous / possibly-missed scope**. Estimator confirms items into an estimate. Attacks missed-scope underquoting.
- **AI-3 Material-price parsing.** Parse a supplier quote/email and propose `material_price_proposals`; estimator accepts → updates the materials master (audited). Keeps infill/hardware prices fresh.

### Migration `facade_011_ai_assist.sql`
```sql
create table if not exists facade.estimate_reviews (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references facade.estimates(id) on delete cascade,
  findings jsonb,                           -- structured issues (severity, message)
  risk_summary text,                        -- plain-language narrative
  created_by_ai boolean default true,
  created_at timestamptz default now()
);
```

### Tier 2 — AI assistant / checker (low risk)
- **AI-4 Estimate "second-checker".** On demand, AI reviews a finished estimate **on top of** the deterministic guardrails (main PRD v1.1 #4) and writes an `estimate_reviews` row: a risk/omission narrative ("freight missing on line 3; margin below floor; no escalation clause; louvre labour low vs history"). Advisory only — estimator decides; AI changes no number.
- **AI-5 Natural-language estimate drafting.** "400 sqm unitized curtain wall, 6+12+6 DGU, 18% margin" → AI drafts estimate lines from your assemblies/systems for review. Speed + consistency; confidence-gated and editable.

### Migration `facade_012_ai_learning.sql` (gated — ships disabled)
```sql
create table if not exists facade.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  context text,                             -- rate|labour|anomaly|variance
  target_ref text,                          -- system/estimate/line id
  suggestion jsonb,                         -- {value, basis, sample_size}
  confidence numeric(5,2),
  created_at timestamptz default now()
);
-- thresholds live in facade.ai_config (rows: rate_suggest, anomaly, variance), enabled=false until data exists
```

### Tier 3 — AI that needs YOUR data first (DO NOT ENABLE until the estimate-vs-actual loop has ~12–24 months of clean data)
- **AI-6 Rate/labour suggestion from history.** Suggest a rate or labour norm from similar past jobs. Ships **disabled**. Enabling before data exists produces confident-but-wrong numbers and **reduces** accuracy.
- **AI-7 Anomaly/outlier flagging.** Flag rates/lines outside your historical band. **Start as simple statistics** (mean/σ over `facade.actuals` + `facade.system_rates`), not ML; AI only explains. Gated on data.
- **AI-8 Estimate-vs-actual variance analysis.** AI summarises variance patterns from `facade.actuals` and proposes default adjustments (human-confirmed) — closes the learning loop.

### Acceptance (AI)
- Every AI feature respects the confidence gate and logs to `facade.ai_runs`; below-threshold outputs force a manual form.
- AI-1 returns areas/piece sizes/counts that a human verifies before they enter an estimate; nothing auto-finalises.
- AI-2 / AI-3 produce **proposals** that need explicit, audited human acceptance before affecting an estimate or the materials master.
- AI-4 produces a review without changing any number.
- Tier 3 features stay disabled until `ai_config.enabled` is turned on after data exists; enabling one with no history shows an "insufficient historical data" state, never a fabricated number.

---

## 7. Build order
1. `facade_008` (A4 import duty + A3 feed scaffold) — low effort, immediate.
2. `facade_006` (A1 assemblies) — the estimator-speed win.
3. `facade_010` (AI core + Tier 1: AI-1 takeoff, AI-2 scope, AI-3 price parse) — biggest AI accuracy wins; AI-1 pairs with A2.
4. `facade_007` (A2 2D nesting) — **only after** main-PRD 1D optimization is working; uses AI-1's piece sizes.
5. `facade_011` (Tier 2: AI-4 second-checker, AI-5 NL drafting) — low-risk assistants.
6. `facade_009` (A5 compatibility) — optional.
7. `facade_012` (Tier 3: AI-6/7/8) — **ships disabled; enable only after ~12–24 months of actuals.**

Each ships independently; all default to current behaviour (and gated AI ships disabled) until toggled on and calibrated.

---

## 8. Deliberately excluded (and why)
- **Structural validation / moment of inertia, 3D/BIM, production/CNC** — design & fabrication functions owned by other teams' systems; pulling them in is scope creep. (A *light* compatibility warning, A5, is the only nod in this direction and is non-engineering.)
- **Embodied-carbon / sustainability metrics** — a real market trend but **not an accuracy or margin lever**; add only if you start bidding green-certified projects and clients require it.
- **Live two-way CPS/Finance integration, mobile app** — covered/gated in the main PRD (v2); not duplicated here. (AI rate-suggestion/anomaly, previously listed in the main PRD's v2, are now fully specified here in §6 Tier 3.)

---

## 9. Honest caveats
- Nesting (1D and 2D) outputs are **heuristic estimating figures**, not fabrication cut-plans.
- Assembly scaling is a **geometric approximation** for quoting speed; real lengths come from shop drawings.
- All defaults (edge trim, duty %, wastage) are starting values to **calibrate against real jobs**.
- Market-size, CAGR, and "% faster / % more accurate" figures from the source research are **marketing/aggregator numbers** — do not treat as verified.
- **AI's verified 2026 benefit is mostly speed/volume, not accuracy** — accuracy gains are smaller and depend on drawing quality and your own historical data. Independent tests land within ~1.8–3% of ground truth; vendor "95–98%" claims are unverified.
- **AI vision takeoff needs clean drawings and human verification of dimensions**; it is unreliable on poor scans and not usable on hand sketches.
- **AI never finalises a price or quantity** — human-in-the-loop is mandatory on anything that affects a quote.
- **Tier 3 AI ships disabled.** Enabling rate-suggestion/anomaly/variance before real `facade.actuals` exist will produce confident-but-wrong numbers and **hurt** accuracy, not help it.
