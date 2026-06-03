import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "Consumption (1).xlsx");
const buf = fs.readFileSync(file);
const wb = XLSX.read(buf, { type: "buffer" });

const only = process.argv[2]; // optional sheet name filter

for (const name of wb.SheetNames) {
  if (only && name !== only) continue;
  const ws = wb.Sheets[name];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  console.log(`\n========== SHEET "${name}" ==========`);
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell == null) continue;
      let v = cell.v;
      // round numbers for readability but keep precision marker
      if (typeof v === "number") v = Math.round(v * 10000) / 10000;
      const col = XLSX.utils.encode_col(c);
      cells.push(`${col}=${JSON.stringify(v)}`);
    }
    if (cells.length) console.log(`r${r + 1}: ${cells.join("  ")}`);
  }
}
