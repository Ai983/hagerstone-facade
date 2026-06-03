// Parse Consumption (1).xlsx into facade seed structures, then re-run the PRD §5
// rate formula on the parsed data and assert it matches each sheet's own
// "Rate per sqm" within ₹1. Emits parsed.json for seed generation.
import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "Consumption (1).xlsx");
const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });

// Verified global rate card (PRD §6)
const RATE_CARD = { aluminium_per_kg: 297, conversion_per_kg: 55, powder_coating_per_kg: 70 };

// Per-system parameters (PRD §6 verified table). code, category, labour, freight,
// wastage%, design%, misc%, pmc%, oh_profit%, coating
const SYSTEMS = {
  "Straight Glazing": { code: "SG", name: "Straight Glazing", category: "glazing", labour: 900, freight: 400, wastage: 10, design: 2.5, misc: 2.5, pmc: 5, ohp: 18, coating: true },
  "Curved glazing":   { code: "CG", name: "Curved Glazing",   category: "glazing", labour: 900, freight: 400, wastage: 10, design: 2.5, misc: 2.5, pmc: 5, ohp: 18, coating: true },
  "Alu. Louvres":     { code: "LV", name: "Alu. Louvres",     category: "louvre",  labour: 800, freight: 400, wastage: 10, design: 2.5, misc: 2.5, pmc: 5, ohp: 18, coating: true },
  "ACP":              { code: "ACP", name: "ACP",             category: "acp",     labour: 800, freight: 300, wastage: 10, design: 2.5, misc: 2.5, pmc: 5, ohp: 10, coating: false },
  "Frameless doors":  { code: "FD", name: "Frameless Doors",  category: "door",    labour: 900, freight: 300, wastage: 10, design: 2.5, misc: 2.5, pmc: 5, ohp: 10, coating: false },
  "Alu. Railing":     { code: "RL", name: "Alu. Railing",     category: "railing", labour: 800, freight: 300, wastage: 10, design: 2.5, misc: 2.5, pmc: 5, ohp: 10, coating: true },
};

const GROUP_COLS = ["G", "H", "I", "J"]; // aluminium member group columns
const cell = (ws, addr) => (ws[addr] ? ws[addr].v : undefined);
const num = (v) => (typeof v === "number" ? v : undefined);
const lc = (s) => String(s ?? "").toLowerCase();

function isInfillName(name) {
  const n = lc(name);
  return n.includes("glass") || n.includes("acp") || n.includes("alucobond") || n.includes("dgu");
}

// rows that are derived/aggregate, never catalog materials
const EXCLUDE_MATERIAL = [
  "grand total wt", "conversion charges", "powder coating", "total rmt",
  "unit wt", "total wt", "total material cost", "total glazing area",
  "labour", "freight", "basic amount", "design cost", "miscellenous",
  "pmc", "oh and profit", "final amount", "rate per sqm",
];

function parseSheet(sheetName) {
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const cfg = SYSTEMS[sheetName];

  // locate key rows
  let unitWtRow = null, totalMatRow = null, areaRow = null, rateRow = null;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const b = lc(cell(ws, `B${r + 1}`));
    if (b.startsWith("unit wt")) unitWtRow = r + 1;
    if (b.startsWith("total material cost")) totalMatRow = r + 1;
    if (b.startsWith("total glazing area")) areaRow = r + 1;
    if (b.startsWith("rate per sqm")) rateRow = r + 1;
  }

  // group column -> unit weight (from "Unit wt.=" row)
  const groupUnitWt = {};
  if (unitWtRow) for (const col of GROUP_COLS) groupUnitWt[col] = num(cell(ws, `${col}${unitWtRow}`));

  // group column -> header label (row 3, e.g. "Pressure plate"). headerRow is the
  // row whose B = "Item".
  let headerRow = null;
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (lc(cell(ws, `B${r + 1}`)) === "item") { headerRow = r + 1; break; }
  }
  const groupHeader = {};
  if (headerRow) for (const col of GROUP_COLS) groupHeader[col] = String(cell(ws, `${col}${headerRow}`) ?? "").trim();

  // members: rows with numeric section_no (col C) and a nonzero group value
  const members = [];
  const materials = [];
  let titleArea = null;
  const titleName = cell(ws, `B4`); // panel reference name (row 4)

  for (let r = range.s.r + 2; r <= range.e.r; r++) {
    const row1 = r + 1;
    const b = cell(ws, `B${row1}`);
    const bl = lc(b);
    if (!b && !num(cell(ws, `C${row1}`))) continue;
    if (totalMatRow && row1 >= totalMatRow) break; // members+materials are above the total
    // skip the panel-reference title row (e.g. "G1-4865X6400" whose G/H/I/J hold
    // section numbers, not material qty/rate/amount)
    if (typeof b === "string" && /^[A-Za-z]+\d+\s*-\s*\d+/.test(b.trim())) continue;

    const sectionNo = num(cell(ws, `C${row1}`));
    const cut = num(cell(ws, `D${row1}`));
    const number = num(cell(ws, `E${row1}`));
    const qty = num(cell(ws, `F${row1}`));

    // MEMBER row: has section_no + cutlength + number, and lands in a group col
    if (sectionNo != null && cut != null && number != null) {
      let groupCol = null;
      for (const col of GROUP_COLS) {
        const v = num(cell(ws, `${col}${row1}`));
        if (v && Math.abs(v) > 0) { groupCol = col; break; }
      }
      if (groupCol) {
        members.push({
          member_name: String(b),
          section_no: String(sectionNo),
          group: groupCol,
          group_header: groupHeader[groupCol] || groupCol,
          cutlength_m: cut,
          number,
          qty: qty ?? 1,
          unit_weight_kg_per_m: groupUnitWt[groupCol],
        });
        continue;
      }
    }

    // MATERIAL row: text name, has rate (I) + amount (J), not an excluded aggregate
    if (b && typeof b === "string") {
      if (EXCLUDE_MATERIAL.some((x) => bl.includes(x))) continue;
      const mqty = num(cell(ws, `G${row1}`));
      const unit = cell(ws, `H${row1}`);
      const rate = num(cell(ws, `I${row1}`));
      const amount = num(cell(ws, `J${row1}`));
      if (mqty != null && rate != null && amount != null) {
        const isWastage = bl.includes("wastage");
        materials.push({
          name: String(b),
          qty: mqty,
          unit: String(unit ?? ""),
          rate,
          amount,
          is_infill: isInfillName(b),
          is_wastage_row: isWastage,
        });
      }
    }
  }

  const area = num(cell(ws, `J${areaRow}`));
  const sheetRate = num(cell(ws, `J${rateRow}`));
  const sheetMaterialTotal = num(cell(ws, `J${totalMatRow}`));

  // parse panel dims from title like G1-4865X6400 / A1-1340x7450
  let width = null, height = null;
  if (typeof titleName === "string") {
    const m = titleName.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (m) { width = parseFloat(m[1]); height = parseFloat(m[2]); }
  }

  return { sheetName, cfg, titleName, members, materials, area, width, height, sheetRate, sheetMaterialTotal };
}

// PRD §5 calculator over parsed data
function computeRate(parsed) {
  const { cfg, members, materials, area } = parsed;
  const totalAluKg = members.reduce((s, m) => s + m.cutlength_m * m.number * m.qty * (m.unit_weight_kg_per_m || 0), 0);
  const aluminium = totalAluKg * RATE_CARD.aluminium_per_kg;
  const conversion = totalAluKg * RATE_CARD.conversion_per_kg;
  const coating = cfg.coating ? totalAluKg * RATE_CARD.powder_coating_per_kg : 0;

  // exclude the explicit wastage rows — wastage is computed from infill
  const realMats = materials.filter((m) => !m.is_wastage_row);
  const consumable = realMats.filter((m) => !m.is_infill).reduce((s, m) => s + m.qty * m.rate, 0);
  const infill = realMats.filter((m) => m.is_infill).reduce((s, m) => s + m.qty * m.rate, 0);
  const wastage = infill * (cfg.wastage / 100);

  const materialTotal = aluminium + conversion + coating + consumable + infill + wastage;
  const labour = area * cfg.labour;
  const freight = area * cfg.freight;
  const basic = materialTotal + labour + freight;
  const design = basic * (cfg.design / 100);
  const misc = basic * (cfg.misc / 100);
  const pmc = basic * (cfg.pmc / 100);
  const ohp = basic * (cfg.ohp / 100);
  const final = basic + design + misc + pmc + ohp;
  const rate = final / area;

  return { totalAluKg, aluminium, conversion, coating, consumable, infill, wastage, materialTotal, basic, final, rate };
}

const out = [];
let allPass = true;
console.log("System                | parsedRate  | sheetRate   |  Δ      | matΔ    | members | mats");
console.log("-".repeat(95));
for (const sheetName of wb.SheetNames) {
  const parsed = parseSheet(sheetName);
  const c = computeRate(parsed);
  const dRate = Math.abs(c.rate - parsed.sheetRate);
  const dMat = Math.abs(c.materialTotal - parsed.sheetMaterialTotal);
  const pass = dRate < 1;
  if (!pass) allPass = false;
  console.log(
    `${parsed.cfg.code.padEnd(4)} ${sheetName.padEnd(17)} | ${c.rate.toFixed(2).padStart(10)} | ${parsed.sheetRate.toFixed(2).padStart(10)} | ${dRate.toFixed(3).padStart(6)} | ${dMat.toFixed(2).padStart(7)} | ${String(parsed.members.length).padStart(7)} | ${parsed.materials.length} ${pass ? "✓" : "✗ FAIL"}`
  );
  out.push({ ...parsed, computed: c });
}
console.log("-".repeat(95));
console.log(allPass ? "ALL 6 SYSTEMS PASS (Δ < ₹1)" : "*** VERIFICATION FAILED ***");

fs.writeFileSync(path.resolve(__dirname, "parsed.json"), JSON.stringify(out, null, 2));
console.log("Wrote scripts/parsed.json");
process.exit(allPass ? 0 : 1);
