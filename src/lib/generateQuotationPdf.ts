import jsPDF from "jspdf";

// Company config — Hagerstone International Pvt. Ltd (Brawn-Globus letter format)
export const company = {
  name: "Hagerstone International Pvt. Ltd",
  tagline: "Interior Design & Build",
  gst: "09AAECH3768B1ZM",
  email: "world@hagerstone.com",
  web: "www.hagerstone.com",
  footerAddr: "91 Springboard D-107, Noida Sector-2, Uttar Pradesh - 201301",
};

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
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
  priceValidUntil?: string | null;
  escalationClause?: string | null;
  lines: Array<{ description: string; area_sqm: number | null; rate_per_sqm: number | null; amount: number | null }>;
  total: number;
  // Brawn-Globus letter fields
  greetingName?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  pricePerSqft?: number | null;
  paymentTermsA?: string | null;
  paymentTermsB?: string | null;
  paymentTermsC?: string | null;
  paymentTermsD?: string | null;
}

export const DEFAULT_LETTER = {
  subject: "Providing and fixing facade work as per the architect's specifications.",
  body: "Reference being made to our discussion and BOQ/drawings shared by you, we are pleased to offer our best rate as below:",
  termA: "Desired Payment Terms: 30% mobilisation advance, 60% against supply, 5% against installation & 5% upon handing over.",
  termB: "Electricity by Client & space for safe storage & office to be provided by client free of cost. Scaffolding will be in your scope.",
  termC: "Offer Validity: 30 Days.",
  termD: "Completion Period - As per agreed terms.",
};

/**
 * Render the client quotation as a single-page business letter matching the
 * company's Brawn-Globus format (To / Subject / Dear / body / one Rs./sqft price /
 * Terms a-d / signature / footer).
 */
export function generateQuotationPdf(d: QuotationPdfData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  const maxW = W - 2 * M;
  let y = 56;

  // ── Letterhead
  doc.setFont("helvetica", "bolditalic").setFontSize(16).setTextColor(20);
  doc.text(company.name, M, y);
  // tan banner on the right
  doc.setFillColor(176, 156, 110);
  doc.rect(W - M - 200, y - 14, 200, 20, "F");
  doc.setFont("helvetica", "bolditalic").setFontSize(11).setTextColor(255);
  doc.text(company.tagline, W - M - 100, y, { align: "center" });
  y += 26;
  doc.setDrawColor(210).line(M, y, W - M, y);
  y += 26;

  // ── Date + ref code
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(30);
  doc.text(`Dated: ${fmtDate(d.date)}`, M, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  doc.text(d.code, W - M, y, { align: "right" });
  y += 26;

  // ── To / address
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(30);
  doc.text("To", M, y); y += 14;
  doc.text(d.clientName, M, y); y += 14;
  doc.setFont("helvetica", "normal").setTextColor(50);
  const addr = (d.siteAddress || d.location || "").trim();
  if (addr) {
    const wrapped = doc.splitTextToSize(addr, maxW * 0.6);
    doc.text(wrapped, M, y); y += wrapped.length * 13;
  }
  y += 12;

  // ── Subject
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20);
  const subject = `Subject: ${d.subject || DEFAULT_LETTER.subject}`;
  const subjWrapped = doc.splitTextToSize(subject, maxW);
  doc.text(subjWrapped, M, y); y += subjWrapped.length * 14 + 8;

  // ── Greeting + body
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(30);
  doc.text(`Dear ${d.greetingName || "Sir/Madam"},`, M, y); y += 18;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(50);
  const body = doc.splitTextToSize(d.bodyText || DEFAULT_LETTER.body, maxW);
  doc.text(body, M, y); y += body.length * 14 + 12;

  // ── Price (single per-sqft line)
  const price = d.pricePerSqft != null && !isNaN(d.pricePerSqft)
    ? `Price: Rs. ${Number(d.pricePerSqft).toLocaleString("en-IN")} / sqft + GST Extra`
    : `Price: Rs. ${Number(d.total).toLocaleString("en-IN")} + GST Extra`;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
  doc.text(price, M, y); y += 22;

  // ── Terms & conditions a-d
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20);
  doc.text("Terms & Conditions:", M, y); y += 16;
  doc.setFontSize(9.5);
  const terms = [
    ["a.", d.paymentTermsA || DEFAULT_LETTER.termA],
    ["b.", d.paymentTermsB || DEFAULT_LETTER.termB],
    ["c.", d.paymentTermsC || DEFAULT_LETTER.termC],
    ["d.", d.paymentTermsD || DEFAULT_LETTER.termD],
  ];
  for (const [tag, text] of terms) {
    doc.setFont("helvetica", "bolditalic").setTextColor(40);
    doc.text(tag, M, y);
    doc.setFont("helvetica", "normal").setTextColor(60);
    const wrapped = doc.splitTextToSize(text, maxW - 18);
    doc.text(wrapped, M + 18, y);
    y += wrapped.length * 12 + 6;
  }
  y += 10;

  // ── Sign-off
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(50);
  doc.text("We earnestly believe our offer is as per your requirement, and look forward to", M, y); y += 13;
  doc.text("hearing from you soon. Assuring you of our best services always.", M, y); y += 22;
  doc.setFont("helvetica", "bold").setTextColor(30);
  doc.text("Warm Regards", M, y); y += 16;
  doc.text("Hagerstone International Pvt Ltd", M, y);

  // ── Footer (centered: web / GST / email + address bar)
  const fy = H - 64;
  doc.setDrawColor(220).line(M, fy - 12, W - M, fy - 12);
  doc.setFont("helvetica", "bolditalic").setFontSize(8.5).setTextColor(150);
  doc.text("Website:", W * 0.22, fy, { align: "center" });
  doc.text("GST:", W * 0.5, fy, { align: "center" });
  doc.text("Email:", W * 0.78, fy, { align: "center" });
  doc.setFont("helvetica", "bold").setTextColor(60);
  doc.text(company.web, W * 0.22, fy + 12, { align: "center" });
  doc.text(company.gst, W * 0.5, fy + 12, { align: "center" });
  doc.text(company.email, W * 0.78, fy + 12, { align: "center" });
  // address bar
  doc.setFillColor(20, 20, 20).rect(0, H - 30, W, 30, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(255);
  doc.text(company.footerAddr, W / 2, H - 11, { align: "center" });

  doc.save(`${d.code}.pdf`);
}
