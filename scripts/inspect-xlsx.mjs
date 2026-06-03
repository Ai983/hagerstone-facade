import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "Consumption (1).xlsx");

const buf = fs.readFileSync(file);
const wb = XLSX.read(buf, { type: "buffer" });
console.log("SHEETS:", JSON.stringify(wb.SheetNames));
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"] || "(empty)";
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  const rows = range ? range.e.r - range.s.r + 1 : 0;
  const cols = range ? range.e.c - range.s.c + 1 : 0;
  console.log(`\n=== SHEET "${name}"  ref=${ref}  rows=${rows} cols=${cols} ===`);
}
