import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Company config — same entity as cps PO header (Hagerstone International Pvt. Ltd)
export const company = {
  name: "Hagerstone International Pvt. Ltd",
  gst: "GST NO: 09AAECH3768B1ZM",
  addr: "D-107, 91 Springboard Hub, Red FM Road, Sector-2, Noida, (U.P)",
  tel: "Tel: +91 9811596660",
  email: "Email: projects@hagerstone.com",
};

const INR = (n: number | null | undefined): string =>
  n == null || isNaN(n) ? "—" : "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export interface QuotationPdfData {
  code: string;
  date?: string | null;
  validUntil?: string | null;
  status?: string | null;
  clientName: string;
  projectName: string;
  location?: string | null;
  siteAddress?: string | null;
  terms?: string | null;
  priceValidUntil?: string | null;   // v1.1
  escalationClause?: string | null;  // v1.1
  lines: Array<{ description: string; area_sqm: number | null; rate_per_sqm: number | null; amount: number | null }>;
  total: number;
}

export function generateQuotationPdf(d: QuotationPdfData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 46;

  // ── Company header
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(20);
  doc.text(company.name, M, y);
  y += 16;
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90);
  doc.text(company.addr, M, y); y += 11;
  doc.text(`${company.gst}   ${company.tel}   ${company.email}`, M, y); y += 8;

  doc.setDrawColor(200).line(M, y, W - M, y); y += 22;

  // ── Title
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(20);
  doc.text("QUOTATION", M, y);
  doc.setFontSize(10).setTextColor(80);
  doc.text(d.code, W - M, y, { align: "right" });
  y += 18;

  // ── Meta (client + dates)
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60);
  const leftLines = [
    `Client: ${d.clientName}`,
    `Project: ${d.projectName}`,
    d.location ? `Location: ${d.location}` : null,
    d.siteAddress ? `Site: ${d.siteAddress}` : null,
  ].filter(Boolean) as string[];
  const rightLines = [
    `Date: ${fmtDate(d.date)}`,
    `Quote valid until: ${fmtDate(d.validUntil)}`,
    d.priceValidUntil ? `Price valid until: ${fmtDate(d.priceValidUntil)}` : null,
    d.status ? `Status: ${d.status.toUpperCase()}` : null,
  ].filter(Boolean) as string[];
  const startY = y;
  leftLines.forEach((t, i) => doc.text(t, M, startY + i * 13));
  rightLines.forEach((t, i) => doc.text(t, W - M, startY + i * 13, { align: "right" }));
  y = startY + Math.max(leftLines.length, rightLines.length) * 13 + 10;

  // ── Lines table
  autoTable(doc, {
    startY: y,
    head: [["#", "Description", "Area (sqm)", "Rate / sqm", "Amount"]],
    body: d.lines.map((l, i) => [
      String(i + 1),
      l.description,
      l.area_sqm != null ? l.area_sqm.toLocaleString("en-IN") : "—",
      INR(l.rate_per_sqm),
      INR(l.amount),
    ]),
    foot: [["", "", "", "Total", INR(d.total)]],
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold", fontSize: 9 },
    footStyles: { fillColor: [240, 244, 255], textColor: 20, fontStyle: "bold", fontSize: 10 },
    bodyStyles: { fontSize: 9, textColor: 40 },
    columnStyles: {
      0: { cellWidth: 28, halign: "center" },
      2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" },
    },
    margin: { left: M, right: M },
  });

  // ── Escalation clause (v1.1) + Terms
  // @ts-expect-error lastAutoTable is added by the plugin at runtime
  let ty = (doc.lastAutoTable?.finalY ?? y) + 24;
  if (d.escalationClause) {
    doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(20);
    doc.text("Price Escalation", M, ty); ty += 14;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(70);
    const wrapped = doc.splitTextToSize(d.escalationClause, W - 2 * M);
    doc.text(wrapped, M, ty);
    ty += wrapped.length * 11 + 12;
  }
  if (d.terms) {
    doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(20);
    doc.text("Terms & Conditions", M, ty); ty += 14;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(70);
    const wrapped = doc.splitTextToSize(d.terms, W - 2 * M);
    doc.text(wrapped, M, ty);
    ty += wrapped.length * 11 + 10;
  }

  // ── Footer
  const fy = doc.internal.pageSize.getHeight() - 40;
  doc.setDrawColor(220).line(M, fy - 10, W - M, fy - 10);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
  doc.text("This is a system-generated quotation from the Hagerstone Facade System.", M, fy);
  doc.text("For Hagerstone International Pvt. Ltd", W - M, fy, { align: "right" });

  doc.save(`${d.code}.pdf`);
}
