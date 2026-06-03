import { nestSheets } from "../src/lib/sheetNest.ts";

// ACP sheet 1220 x 2440, 10mm edge trim. Ten 1000x2000 panels.
const sheet = { sheet_width_mm: 1220, sheet_height_mm: 2440, sheet_edge_trim_mm: 10 };
const r1 = nestSheets([{ width_mm: 1000, height_mm: 2000, count: 10, allow_rotation: true }], sheet);
console.log("Case1 (10x 1000x2000):", JSON.stringify(r1));

// Smaller panels that pack two-per-shelf: 600x1000, 12 of them
const r2 = nestSheets([{ width_mm: 600, height_mm: 1000, count: 12, allow_rotation: true }], sheet);
console.log("Case2 (12x 600x1000):", JSON.stringify(r2));

// oversized piece
const r3 = nestSheets([{ width_mm: 1340, height_mm: 7450, count: 1 }], sheet);
console.log("Case3 (oversized):", JSON.stringify(r3));

const ok = r1.sheets_used > 0 && r1.sheet_wastage_pct > 0 && r1.used_area_sqm === 20
  && r2.sheets_used > 0 && r3.oversized === true;
console.log(ok ? "SHEETNEST OK" : "SHEETNEST FAIL");
process.exit(ok ? 0 : 1);
