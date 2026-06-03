// Generate facade_002_seed.sql from the verified parsed.json.
// Members + system_materials come straight from the parsed sheet data (no
// hand-transcription). Re-verifies the seed representation reproduces each
// sheet's Rate/sqm within ₹1 before emitting SQL.
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "parsed.json")));
const RATE_CARD = { aluminium_per_kg: 297, conversion_per_kg: 55, powder_coating_per_kg: 70 };

// ---- Normalized material catalog (PRD §6 verified values) ----
const CATALOG = [
  { name: "Weather Silicone",       category: "silicone", unit: "bottle", default_rate: 700,   is_infill: false },
  { name: "M.S. Bracket (HDG)",     category: "bracket",  unit: "kg",     default_rate: 130,   is_infill: false },
  { name: "S.S. Fastener - Hilti",  category: "fastener", unit: "pcs",    default_rate: 160,   is_infill: false },
  { name: "S.S. Screw 19x8",        category: "screw",    unit: "pcs",    default_rate: 0.5,   is_infill: false },
  { name: "S.S. Screw 38x8",        category: "screw",    unit: "pcs",    default_rate: 0.6,   is_infill: false },
  { name: "EPDM Gasket",            category: "gasket",   unit: "mtr",    default_rate: 60,    is_infill: false },
  { name: "Glass DGU 6+12+6",       category: "glass",    unit: "sqm",    default_rate: 3000,  is_infill: true },
  { name: "Curved Glass DGU",       category: "glass",    unit: "sqm",    default_rate: 8000,  is_infill: true },
  { name: "ACP - Alucobond",        category: "acp",      unit: "sqm",    default_rate: 2510,  is_infill: true },
  { name: "24mm DGU Glass",         category: "dgu",      unit: "sqm",    default_rate: 3000,  is_infill: true },
  { name: "Dorma Machine Set",      category: "hardware", unit: "set",    default_rate: 12500, is_infill: false },
  { name: "Dorma Handle",           category: "hardware", unit: "pcs",    default_rate: 5500,  is_infill: false },
];
const byName = Object.fromEntries(CATALOG.map((m) => [m.name, m]));

// Map a sheet material row -> catalog name.
function resolveCatalog(m) {
  const n = m.name.toLowerCase();
  if (n.includes("silicone")) return "Weather Silicone";
  if (n.includes("bracket")) return "M.S. Bracket (HDG)";
  if (n.includes("hilti") || n.includes("fastener")) return "S.S. Fastener - Hilti";
  if (n.includes("19*8") || n.includes("19x8")) return "S.S. Screw 19x8";
  if (n.includes("38*8") || n.includes("38x8")) return "S.S. Screw 38x8";
  if (n.includes("epdm")) return "EPDM Gasket";
  if (n.includes("alucobond") || (n.includes("acp") && !n.includes("dgu"))) return "ACP - Alucobond";
  if (n.includes("24mm") || n.includes("24 mm")) return "24mm DGU Glass";
  if (n.includes("machine set")) return "Dorma Machine Set";
  if (n.includes("handle")) return "Dorma Handle";
  if (n.includes("glass")) return m.rate >= 8000 ? "Curved Glass DGU" : "Glass DGU 6+12+6"; // straight vs curved by rate
  throw new Error(`Unmapped material: "${m.name}" (rate ${m.rate})`);
}

// ---- Build per-system seed rows ----
const sections = new Map(); // key section_no|name -> {section_no,name,unit_wt}
const memberRows = [];      // {code, member_name, section_no, section_name, cut, number, qty, unit_wt, sort}
const matRows = [];         // {code, mat_name, qty, rate_override, is_infill, wastage_applies, sort}

for (const s of data) {
  const code = s.cfg.code;
  s.members.forEach((mb, i) => {
    const key = `${mb.section_no}|${mb.group_header}`;
    if (!sections.has(key)) sections.set(key, { section_no: mb.section_no, name: mb.group_header, unit_wt: mb.unit_weight_kg_per_m });
    memberRows.push({ code, member_name: mb.member_name, section_no: mb.section_no, section_name: mb.group_header,
      cut: mb.cutlength_m, number: mb.number, qty: mb.qty, unit_wt: mb.unit_weight_kg_per_m, sort: i });
  });
  s.materials.filter((m) => !m.is_wastage_row).forEach((m, i) => {
    const catName = resolveCatalog(m);
    const cat = byName[catName];
    const override = Math.abs(m.rate - cat.default_rate) > 1e-9 ? m.rate : null;
    matRows.push({ code, mat_name: catName, qty: m.qty, rate_override: override,
      is_infill: cat.is_infill, wastage_applies: cat.is_infill, sort: i });
  });
}

// ---- Self-verify: recompute each system from the SEED representation ----
let allPass = true;
console.log("Re-verify seed representation:");
for (const s of data) {
  const cfg = s.cfg;
  const mem = memberRows.filter((r) => r.code === cfg.code);
  const mats = matRows.filter((r) => r.code === cfg.code);
  const aluKg = mem.reduce((t, r) => t + r.cut * r.number * r.qty * r.unit_wt, 0);
  const alu = aluKg * RATE_CARD.aluminium_per_kg;
  const conv = aluKg * RATE_CARD.conversion_per_kg;
  const coat = cfg.coating ? aluKg * RATE_CARD.powder_coating_per_kg : 0;
  const rate = (name) => { const c = byName[name]; return c.default_rate; };
  const consumable = mats.filter((r) => !r.is_infill).reduce((t, r) => t + r.qty * (r.rate_override ?? rate(r.mat_name)), 0);
  const infill = mats.filter((r) => r.is_infill).reduce((t, r) => t + r.qty * (r.rate_override ?? rate(r.mat_name)), 0);
  const wastage = infill * (cfg.wastage / 100);
  const materialTotal = alu + conv + coat + consumable + infill + wastage;
  const area = s.area;
  const basic = materialTotal + area * cfg.labour + area * cfg.freight;
  const final = basic * (1 + (cfg.design + cfg.misc + cfg.pmc + cfg.ohp) / 100);
  const r = final / area;
  const d = Math.abs(r - s.sheetRate);
  if (d >= 1) allPass = false;
  console.log(`  ${cfg.code.padEnd(4)} seed=${r.toFixed(2).padStart(10)} sheet=${s.sheetRate.toFixed(2).padStart(10)} Δ=${d.toFixed(3)} ${d < 1 ? "✓" : "✗"}`);
}
if (!allPass) { console.error("Seed verification FAILED"); process.exit(1); }
console.log("Seed representation reproduces all 6 rates within ₹1.\n");

// ---- Emit SQL ----
const q = (v) => (v == null ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const b = (v) => (v ? "true" : "false");
const SYS = {
  SG: { name: "Straight Glazing", category: "glazing", w: 4865, h: 6400, area: 31.136, coat: true, labour: 900, freight: 400, ohp: 18 },
  CG: { name: "Curved Glazing", category: "glazing", w: 4865, h: 6400, area: 31.136, coat: true, labour: 900, freight: 400, ohp: 18 },
  LV: { name: "Alu. Louvres", category: "louvre", w: 4865, h: 1025, area: 4.9866, coat: true, labour: 800, freight: 400, ohp: 18 },
  ACP: { name: "ACP", category: "acp", w: 1340, h: 7450, area: 9.983, coat: false, labour: 800, freight: 300, ohp: 10 },
  FD: { name: "Frameless Doors", category: "door", w: 1900, h: 3000, area: 5.7, coat: false, labour: 900, freight: 300, ohp: 10 },
  RL: { name: "Alu. Railing", category: "railing", w: null, h: null, area: 10, coat: true, labour: 800, freight: 300, ohp: 10 },
};

let sql = `-- ============================================================================
-- facade_002_seed.sql  (generated from Consumption (1).xlsx via scripts/gen-seed.mjs)
-- Verified: all 6 systems reproduce the Excel "Rate per sqm" within ₹1.
-- Additive + idempotent (upsert by natural keys; members/materials re-seeded).
-- ============================================================================

-- 1) Active rate card (PRD §6 verified globals)
insert into facade.rate_cards (name, effective_from, aluminium_per_kg, conversion_per_kg, powder_coating_per_kg, is_active)
select 'Base Rate Card 2026', current_date, 297, 55, 70, true
where not exists (select 1 from facade.rate_cards where name = 'Base Rate Card 2026');

-- 2) Material catalog
insert into facade.materials (name, category, unit, default_rate, is_infill, is_active) values
${CATALOG.map((m) => `  (${q(m.name)}, ${q(m.category)}, ${q(m.unit)}, ${m.default_rate}, ${b(m.is_infill)}, true)`).join(",\n")}
on conflict (name) do update set
  category = excluded.category, unit = excluded.unit,
  default_rate = excluded.default_rate, is_infill = excluded.is_infill, is_active = true;

-- 3) Sections (aluminium profiles; unit weight per profile)
insert into facade.sections (section_no, name, default_unit_weight_kg_per_m) values
${[...sections.values()].map((s) => `  (${q(s.section_no)}, ${q(s.name)}, ${s.unit_wt})`).join(",\n")}
on conflict (section_no, name) do update set
  default_unit_weight_kg_per_m = excluded.default_unit_weight_kg_per_m;

-- 4) Systems
insert into facade.systems
  (code, name, category, panel_width_mm, panel_height_mm, panel_area_sqm,
   apply_powder_coating, labour_per_sqm, freight_per_sqm,
   wastage_pct, design_pct, misc_pct, pmc_pct, oh_profit_pct, is_active) values
${Object.entries(SYS).map(([code, s]) =>
  `  (${q(code)}, ${q(s.name)}, ${q(s.category)}, ${q(s.w)}, ${q(s.h)}, ${s.area}, ${b(s.coat)}, ${s.labour}, ${s.freight}, 10, 2.5, 2.5, 5, ${s.ohp}, true)`).join(",\n")}
on conflict (code) do update set
  name = excluded.name, category = excluded.category,
  panel_width_mm = excluded.panel_width_mm, panel_height_mm = excluded.panel_height_mm,
  panel_area_sqm = excluded.panel_area_sqm, apply_powder_coating = excluded.apply_powder_coating,
  labour_per_sqm = excluded.labour_per_sqm, freight_per_sqm = excluded.freight_per_sqm,
  wastage_pct = excluded.wastage_pct, design_pct = excluded.design_pct,
  misc_pct = excluded.misc_pct, pmc_pct = excluded.pmc_pct,
  oh_profit_pct = excluded.oh_profit_pct, is_active = true;

-- 5) Re-seed members + materials for the 6 systems (idempotent)
delete from facade.system_members  where system_id in (select id from facade.systems where code in ('SG','CG','LV','ACP','FD','RL'));
delete from facade.system_materials where system_id in (select id from facade.systems where code in ('SG','CG','LV','ACP','FD','RL'));

-- 6) System members (aluminium take-off, parsed from the sheet)
insert into facade.system_members (system_id, section_id, member_name, cutlength_m, number, qty, unit_weight_kg_per_m, sort_order)
select s.id, sec.id, v.member_name, v.cutlength_m, v.number, v.qty, v.unit_weight_kg_per_m, v.sort_order
from (values
${memberRows.map((r) => `  (${q(r.code)}, ${q(r.member_name)}, ${q(r.section_no)}, ${q(r.section_name)}, ${r.cut}, ${r.number}, ${r.qty}, ${r.unit_wt}, ${r.sort})`).join(",\n")}
) as v(code, member_name, section_no, section_name, cutlength_m, number, qty, unit_weight_kg_per_m, sort_order)
join facade.systems s on s.code = v.code
left join facade.sections sec on sec.section_no = v.section_no and sec.name = v.section_name;

-- 7) System materials (consumables + infill; rate_override where sheet differs from catalog)
insert into facade.system_materials (system_id, material_id, qty, rate_override, is_infill, wastage_applies, sort_order)
select s.id, m.id, v.qty, v.rate_override, v.is_infill, v.wastage_applies, v.sort_order
from (values
${matRows.map((r) => `  (${q(r.code)}, ${q(r.mat_name)}, ${r.qty}, ${r.rate_override == null ? "null::numeric" : r.rate_override}, ${b(r.is_infill)}, ${b(r.wastage_applies)}, ${r.sort})`).join(",\n")}
) as v(code, mat_name, qty, rate_override, is_infill, wastage_applies, sort_order)
join facade.systems s on s.code = v.code
join facade.materials m on m.name = v.mat_name;
`;

fs.writeFileSync(path.resolve(__dirname, "..", "supabase", "migrations", "facade_002_seed.sql"), sql);
console.log(`Wrote facade_002_seed.sql  (${CATALOG.length} materials, ${sections.size} sections, ${memberRows.length} members, ${matRows.length} system_materials)`);
