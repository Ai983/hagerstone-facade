// Finance statement PDF — receivables (client) + payables (vendor) for a project.
// Export-only; mirrors nothing in the finance schema.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Payment } from "@/types/facade";

const COMPANY = "Hagerstone International Pvt. Ltd";
const inr = (n: number | null | undefined) => "Rs. " + (Number(n) || 0).toLocaleString("en-IN");

export interface FinancePdfData {
  projectName: string;
  projectCode: string;
  clientName: string;
  payments: Payment[];
}

export function generateFinancePdf(d: FinancePdfData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 40;
  doc.setFont("helvetica", "bold").setFontSize(15).text(COMPANY, M, 48);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(90);
  doc.text(`Finance Statement — ${d.projectCode}`, M, 66);
  doc.text(`${d.projectName} · ${d.clientName}`, M, 80);

  const recv = d.payments.filter((p) => p.direction === "receivable");
  const pay = d.payments.filter((p) => p.direction !== "receivable");
  const sum = (arr: Payment[], k: "amount" | "paid_amount") => arr.reduce((s, p) => s + (Number(p[k]) || 0), 0);

  const section = (title: string, rows: Payment[], startY: number) => {
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20).text(title, M, startY);
    autoTable(doc, {
      startY: startY + 6,
      head: [["Code", "Party", "Amount", "Paid", "Balance", "Due", "Status"]],
      body: rows.map((p) => [
        p.code, p.party_name ?? "—", inr(p.amount), inr(p.paid_amount),
        inr((Number(p.amount) || 0) - (Number(p.paid_amount) || 0)), p.due_date ?? "—", p.status,
      ]),
      foot: [["", "Total", inr(sum(rows, "amount")), inr(sum(rows, "paid_amount")), inr(sum(rows, "amount") - sum(rows, "paid_amount")), "", ""]],
      theme: "grid", headStyles: { fillColor: [40, 70, 120] }, footStyles: { fillColor: [240, 244, 255], textColor: 20, fontStyle: "bold" },
      styles: { fontSize: 8 }, columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } }, margin: { left: M, right: M },
    });
    // @ts-expect-error plugin adds lastAutoTable at runtime
    return (doc.lastAutoTable?.finalY ?? startY) + 28;
  };

  let y = section("Receivables (client invoices)", recv, 104);
  section("Payables (vendor bills)", pay, y);
  doc.save(`${d.projectCode}-finance.pdf`);
}
