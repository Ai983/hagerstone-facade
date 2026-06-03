// Prove cut-optimization: OFF reproduces baseline; ON yields bars/offcut/real %.
import { computeRate } from "../src/lib/rateEngine.ts";
import { DEFAULT_BAR_PARAMS } from "../src/lib/cutOptimize.ts";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "parsed.json"), "utf8"));
const RATE_CARD = { aluminium_per_kg: 297, conversion_per_kg: 55, powder_coating_per_kg: 70 };
const lv = data.find((s) => s.cfg.code === "LV");

const sys = {
  panel_area_sqm: lv.area, apply_powder_coating: lv.cfg.coating, labour_per_sqm: lv.cfg.labour,
  freight_per_sqm: lv.cfg.freight, wastage_pct: lv.cfg.wastage, design_pct: lv.cfg.design,
  misc_pct: lv.cfg.misc, pmc_pct: lv.cfg.pmc, oh_profit_pct: lv.cfg.ohp,
};
const members = lv.members.map((m) => ({
  cutlength_m: m.cutlength_m, number: m.number, qty: m.qty,
  unit_weight_kg_per_m: m.unit_weight_kg_per_m, section_key: m.group_header,
}));
const materials = lv.materials.filter((m) => !m.is_wastage_row).map((m) => ({ qty: m.qty, rate: m.rate, is_infill: m.is_infill }));

const off = computeRate(sys, members, materials, RATE_CARD);
const on = computeRate(sys, members, materials, RATE_CARD, {
  enabled: true, applyScrapCredit: false, bar: DEFAULT_BAR_PARAMS, scrap_recovery_pct: 70,
});
const onScrap = computeRate(sys, members, materials, RATE_CARD, {
  enabled: true, applyScrapCredit: true, bar: DEFAULT_BAR_PARAMS, scrap_recovery_pct: 70,
});

console.log(`OFF  rate/sqm = ${off.rate_per_sqm.toFixed(2)}  (baseline ${lv.sheetRate.toFixed(2)}, Δ ${Math.abs(off.rate_per_sqm - lv.sheetRate).toFixed(3)})`);
console.log(`ON   rate/sqm = ${on.rate_per_sqm.toFixed(2)}  used ${on.total_alu_kg.toFixed(2)}kg  purchased ${on.purchased_alu_kg.toFixed(2)}kg  offcut ${on.offcut_kg.toFixed(2)}kg  realWastage ${on.optimized_wastage_pct.toFixed(1)}%`);
console.log(`ON+scrap rate/sqm = ${onScrap.rate_per_sqm.toFixed(2)}  scrapCredit ${onScrap.scrap_credit_amount.toFixed(2)}`);

const ok = Math.abs(off.rate_per_sqm - lv.sheetRate) < 1
  && on.purchased_alu_kg > on.total_alu_kg
  && on.offcut_kg > 0
  && on.rate_per_sqm > off.rate_per_sqm
  && onScrap.rate_per_sqm < on.rate_per_sqm;
console.log(ok ? "CUT-OPT OK (OFF=baseline; ON adds offcut & raises rate; scrap credit lowers it)" : "CUT-OPT FAIL");
process.exit(ok ? 0 : 1);
