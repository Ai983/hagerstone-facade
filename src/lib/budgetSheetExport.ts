// ============================================================================
// Budget sheet export — one-click Excel + PDF that mirror the manual
// "Cash_Flow Hager Stone.xls": Cost Summary, Material, PM, and Cash Flow sheets.
// Margin columns (markup) are omitted unless showMargin is true.
// ============================================================================
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { BudgetResult, CashflowResult } from "@/lib/budgetEngine";

const COMPANY = "Hagerstone International Pvt. Ltd";

export interface BudgetExportData {
  projectName: string;
  clientName: string;
  budgetCode: string;
  referenceDate?: string | null;
  budget: BudgetResult;
  cashflow: CashflowResult;
  pmLines: Array<{ description: string | null; uom: string | null; qty: number; salary: number; duration_months: number; amount: number }>;
  materialLines: Array<{ description: string | null; qty: number; uom: string | null; rate: number; amount: number }>;
  showMargin: boolean;
}

const r0 = (n: number) => Math.round(Number(n) || 0);

function costSummaryAoa(d: BudgetExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    [COMPANY],
    [`Budget Sheet — ${d.budgetCode}`],
    [`Project: ${d.projectName}`, `Client: ${d.clientName}`],
    [],
    ["#", "Cost Head", "Value (INR)", "% of cost"],
  ];
  d.budget.heads.forEach((h, i) =>
    rows.push([i + 1, h.head_name, r0(h.value), (h.pct_on_costs * 100).toFixed(1) + "%"])
  );
  rows.push([]);
  rows.push(["", "Total Costs", r0(d.budget.total_costs), "100%"]);
  if (d.showMargin) {
    rows.push(["", `Markup (${d.budget.markup_pct}%)`, r0(d.budget.markup_amount), ""]);
    rows.push(["", "Contract Value (ex-Tax)", r0(d.budget.contract_value), ""]);
  }
  return rows;
}

function materialAoa(d: BudgetExportData): (string | number)[][] {
  const rows: (string | number)[][] = [["Material build-up"], [], ["Description", "Qty", "UOM", "Rate", "Amount"]];
  d.materialLines.forEach((m) => rows.push([m.description ?? "", m.qty, m.uom ?? "", m.rate, r0(m.amount)]));
  rows.push([]);
  rows.push(["Build-up total", "", "", "", r0(d.budget.material_buildup)]);
  return rows;
}

function pmAoa(d: BudgetExportData): (string | number)[][] {
  const rows: (string | number)[][] = [["Project Management — staffing"], [], ["Description", "UOM", "Qty", "Salary", "Months", "Amount"]];
  d.pmLines.forEach((p) => rows.push([p.description ?? "", p.uom ?? "", p.qty, p.salary, p.duration_months, r0(p.amount)]));
  rows.push([]);
  rows.push(["Total", "", "", "", "", r0(d.budget.pm_total)]);
  return rows;
}

function cashflowAoa(d: BudgetExportData): (string | number)[][] {
  const rows: (string | number)[][] = [["Cash Flow projection"], []];
  rows.push(["Month", "Cash Out", "Cash In", "Net", "Balance", "Interest"]);
  d.cashflow.rows.forEach((c) =>
    rows.push([c.label, r0(c.cash_out), r0(c.cash_in), r0(c.net), r0(c.balance), r0(c.interest)])
  );
  rows.push([]);
  rows.push(["Totals", r0(d.cashflow.total_cash_out), r0(d.cashflow.total_cash_in), "", "", r0(d.cashflow.total_interest)]);
  rows.push(["Peak financing need", r0(d.cashflow.peak_negative)]);
  return rows;
}

/** Download the budget as a multi-sheet .xlsx mirroring the manual workbook. */
export function exportBudgetExcel(d: BudgetExportData) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(costSummaryAoa(d)), "Cost Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(materialAoa(d)), "Material");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pmAoa(d)), "PM");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cashflowAoa(d)), "Cash Flow");
  XLSX.writeFile(wb, `${d.budgetCode}-budget.xlsx`);
}

/** Download the budget as a landscape PDF (cost summary + cash flow). */
export function exportBudgetPdf(d: BudgetExportData) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(COMPANY, 14, 14);
  doc.setFontSize(11);
  doc.text(`Budget Sheet — ${d.budgetCode}`, 14, 21);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Project: ${d.projectName}    Client: ${d.clientName}`, 14, 27);

  const summaryBody = d.budget.heads.map((h, i) => [String(i + 1), h.head_name, r0(h.value).toLocaleString("en-IN"), (h.pct_on_costs * 100).toFixed(1) + "%"]);
  summaryBody.push(["", "Total Costs", r0(d.budget.total_costs).toLocaleString("en-IN"), "100%"]);
  if (d.showMargin) {
    summaryBody.push(["", `Markup (${d.budget.markup_pct}%)`, r0(d.budget.markup_amount).toLocaleString("en-IN"), ""]);
    summaryBody.push(["", "Contract Value (ex-Tax)", r0(d.budget.contract_value).toLocaleString("en-IN"), ""]);
  }
  autoTable(doc, {
    startY: 32, head: [["#", "Cost Head", "Value (INR)", "% of cost"]], body: summaryBody,
    theme: "grid", headStyles: { fillColor: [40, 70, 120] }, styles: { fontSize: 8 },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } }, margin: { left: 14, right: 150 },
  });

  const cfBody = d.cashflow.rows.map((c) => [c.label, r0(c.cash_out).toLocaleString("en-IN"), r0(c.cash_in).toLocaleString("en-IN"), r0(c.net).toLocaleString("en-IN"), r0(c.balance).toLocaleString("en-IN")]);
  autoTable(doc, {
    startY: 32, head: [["Month", "Cash Out", "Cash In", "Net", "Balance"]], body: cfBody,
    theme: "grid", headStyles: { fillColor: [40, 70, 120] }, styles: { fontSize: 7 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: 150, right: 14 },
  });

  doc.save(`${d.budgetCode}-budget.pdf`);
}
