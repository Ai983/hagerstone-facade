// Exercises the SHIPPED TypeScript rate engine (src/lib/rateEngine.ts) against
// the verified parsed sheet inputs. Run: node --experimental-strip-types
import { computeRate } from "../src/lib/rateEngine.ts";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "parsed.json"), "utf8"));
const RATE_CARD = { aluminium_per_kg: 297, conversion_per_kg: 55, powder_coating_per_kg: 70 };

let allPass = true;
console.log("Shipped rateEngine.ts vs Excel:");
for (const s of data) {
  const members = s.members.map((m) => ({
    cutlength_m: m.cutlength_m, number: m.number, qty: m.qty, unit_weight_kg_per_m: m.unit_weight_kg_per_m,
  }));
  const materials = s.materials.filter((m) => !m.is_wastage_row).map((m) => ({
    qty: m.qty, rate: m.rate, is_infill: m.is_infill,
  }));
  const b = computeRate(
    {
      panel_area_sqm: s.area, apply_powder_coating: s.cfg.coating, labour_per_sqm: s.cfg.labour,
      freight_per_sqm: s.cfg.freight, wastage_pct: s.cfg.wastage, design_pct: s.cfg.design,
      misc_pct: s.cfg.misc, pmc_pct: s.cfg.pmc, oh_profit_pct: s.cfg.ohp,
    },
    members, materials, RATE_CARD
  );
  const d = Math.abs(b.rate_per_sqm - s.sheetRate);
  if (d >= 1) allPass = false;
  console.log(`  ${s.cfg.code.padEnd(4)} engine=${b.rate_per_sqm.toFixed(2).padStart(10)} sheet=${s.sheetRate.toFixed(2).padStart(10)} Δ=${d.toFixed(3)} ${d < 1 ? "✓" : "✗"}`);
}
console.log(allPass ? "ALL PASS (shipped TS engine within ₹1)" : "*** FAIL ***");
process.exit(allPass ? 0 : 1);
