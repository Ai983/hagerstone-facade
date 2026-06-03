import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "parsed.json")));

console.log("=== DISTINCT MATERIALS (name | unit | rate | infill | wastage) ===");
const seen = new Set();
for (const s of data) for (const m of s.materials) {
  const k = `${m.name} | ${m.unit} | ${m.rate} | infill=${m.is_infill} | wastage=${m.is_wastage_row}`;
  if (!seen.has(k)) { seen.add(k); console.log(`[${s.cfg.code}] ${k}`); }
}
console.log("\n=== DISTINCT SECTIONS (section_no | header | unit_wt) ===");
const sec = new Set();
for (const s of data) for (const mb of s.members) {
  const k = `${mb.section_no} | ${mb.group_header} | ${mb.unit_weight_kg_per_m}`;
  if (!sec.has(k)) { sec.add(k); console.log(`[${s.cfg.code}] ${k}`); }
}
console.log("\n=== PANEL DIMS ===");
for (const s of data) console.log(`${s.cfg.code}: ${s.titleName ?? "(none)"} w=${s.width} h=${s.height} area=${s.area}`);
