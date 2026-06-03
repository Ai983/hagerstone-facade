// F5 export payload builders + browser download helpers.
// DORMANT: these produce downloadable files only. Payload shapes mirror the
// real cps.cps_purchase_requisitions / cps_po_line_items and finance.po_payments
// columns (inspected read-only at build time) so a future importer can map 1:1.
// Nothing here writes to the cps or finance schemas.
import type { Project, Estimate, BomLine } from "@/types/facade";

// ---- CPS procurement payload (mirrors cps_purchase_requisitions + cps_po_line_items) ----
export interface CpsProcurementPayload {
  _target: "cps.cps_purchase_requisitions";
  _generated_by: "facade";
  pr_number: string;          // facade FAC-PR code
  project_code: string;       // facade project code
  project_site: string | null;
  status: "draft";
  priority: "normal";
  required_by: string | null;
  notes: string;
  line_items: Array<{         // mirrors cps_po_line_items
    description: string;
    quantity: number;
    unit: string;
    rate: number | null;
    gst_percent: number;
    total_value: number | null;
    hsn_code: string | null;
    sort_order: number;
  }>;
}

export function buildCpsProcurementPayload(
  prCode: string, project: Project, estimate: Estimate, bom: BomLine[]
): CpsProcurementPayload {
  return {
    _target: "cps.cps_purchase_requisitions",
    _generated_by: "facade",
    pr_number: prCode,
    project_code: project.code,
    project_site: project.location ?? project.site_address ?? null,
    status: "draft",
    priority: "normal",
    required_by: null,
    notes: `Auto-generated facade procurement from estimate ${estimate.code} (v${estimate.version}).`,
    line_items: bom.map((b, i) => ({
      description: b.description,
      quantity: b.qty,
      unit: b.unit,
      rate: null,
      gst_percent: 18,
      total_value: null,
      hsn_code: null,
      sort_order: i,
    })),
  };
}

// ---- Finance payment payload (mirrors finance.po_payments) ----
export interface FinancePaymentpayload {
  _target: "finance.po_payments";
  _generated_by: "facade";
  cps_po_ref: string;          // facade FAC-PAY code
  supplier_name: string | null;
  supplier_gstin: string | null;
  project_name: string;
  site: string | null;
  total_amount: number;
  paid_amount: number;
  payment_due_date: string | null;
  status: "pending";
  line_items: Array<{ description: string; amount: number }>;
}

export function buildFinancePaymentPayload(
  payCode: string, project: Project, opts: {
    party_name: string; amount: number; payment_type: string;
    due_date?: string | null; line_label?: string;
  }
): FinancePaymentpayload {
  return {
    _target: "finance.po_payments",
    _generated_by: "facade",
    cps_po_ref: payCode,
    supplier_name: opts.party_name || project.client_name,
    supplier_gstin: null,
    project_name: project.project_name,
    site: project.location ?? project.site_address ?? null,
    total_amount: opts.amount,
    paid_amount: 0,
    payment_due_date: opts.due_date ?? null,
    status: "pending",
    line_items: [{ description: opts.line_label ?? `${opts.payment_type} — ${project.code}`, amount: opts.amount }],
  };
}

// ---- Download helpers (browser) ----

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(obj: unknown, filename: string) {
  triggerDownload(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename);
}

/** Flatten an array of flat objects to CSV. */
export function downloadCsv(rows: Array<Record<string, unknown>>, filename: string) {
  if (!rows.length) {
    triggerDownload(new Blob([""], { type: "text/csv" }), filename);
    return;
  }
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv" }), filename);
}
