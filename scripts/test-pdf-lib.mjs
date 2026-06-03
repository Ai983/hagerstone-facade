// Confirm jspdf + jspdf-autotable render a valid PDF with table rows/totals in this env.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const doc = new jsPDF({ unit: "pt", format: "a4" });
doc.setFontSize(16).text("Hagerstone International Pvt. Ltd", 40, 46);
doc.setFontSize(12).text("QUOTATION  FAC-QT-2026-TEST", 40, 70);
autoTable(doc, {
  startY: 90,
  head: [["#", "Description", "Area", "Rate/sqm", "Amount"]],
  body: [
    ["1", "Straight Glazing (E1)", "120", "Rs. 9,584.40", "Rs. 11,50,128.00"],
    ["2", "Alu. Louvres (E2)", "40", "Rs. 9,231.45", "Rs. 3,69,258.00"],
  ],
  foot: [["", "", "", "Total", "Rs. 15,19,386.00"]],
  theme: "grid",
});
const ab = doc.output("arraybuffer");
const buf = Buffer.from(ab);
const header = buf.subarray(0, 5).toString("latin1");
console.log(`PDF ${buf.length} bytes, header="${header}"`);
console.log(header === "%PDF-" && buf.length > 1500 ? "PDF LIB OK — table + totals render" : "FAIL");
process.exit(header === "%PDF-" ? 0 : 1);
