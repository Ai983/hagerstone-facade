import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PackageCheck, Plus, Trash2, Loader2, Save, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchMaterials, fetchMrns, fetchProcurementRequests, fetchProcurementLines, createMrn, createPayableFromMrn,
} from "@/lib/facadeApi";
import { formatINR } from "@/lib/rateEngine";
import { logAudit } from "@/lib/audit";
import type { Project } from "@/types/facade";

interface Row { material_id: string | null; procurement_line_id: string | null; description: string; ordered_qty: string; received_qty: string; unit: string; rate: string; }

export function MrnPanel({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();
  const matQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const mrnQ = useQuery({ queryKey: ["mrns", project.id], queryFn: () => fetchMrns(project.id) });
  const prQ = useQuery({ queryKey: ["procReqs", project.id], queryFn: () => fetchProcurementRequests(project.id) });

  const [header, setHeader] = useState({ procurement_request_id: "", vendor_name: "", vendor_gstin: "", invoice_ref: "", received_date: new Date().toISOString().slice(0, 10) });
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  if (!canCreate) return null;

  const total = rows.reduce((s, r) => s + (Number(r.received_qty) || 0) * (Number(r.rate) || 0), 0);

  const prefillFromPr = async (requestId: string) => {
    setHeader((h) => ({ ...h, procurement_request_id: requestId }));
    if (!requestId) { setRows([]); return; }
    const lines = await fetchProcurementLines(requestId);
    setRows(lines.map((l) => ({
      material_id: l.material_id, procurement_line_id: l.id, description: l.description ?? "",
      ordered_qty: String(l.qty ?? 0), received_qty: String(l.qty ?? 0), unit: l.unit ?? "", rate: "",
    })));
  };

  const addRow = () => {
    const m = matQ.data?.[0];
    setRows((a) => [...a, { material_id: m?.id ?? null, procurement_line_id: null, description: m?.name ?? "", ordered_qty: "", received_qty: "", unit: m?.unit ?? "", rate: "" }]);
  };

  const save = async () => {
    if (!rows.length) { toast.error("Kam se kam ek line jodein"); return; }
    setBusy(true);
    try {
      const mrn = await createMrn(
        { project_id: project.id, procurement_request_id: header.procurement_request_id || null, vendor_name: header.vendor_name, vendor_gstin: header.vendor_gstin, invoice_ref: header.invoice_ref, received_date: header.received_date, created_by: user?.id ?? null },
        rows.map((r) => ({ procurement_line_id: r.procurement_line_id, material_id: r.material_id, description: r.description, ordered_qty: Number(r.ordered_qty) || 0, received_qty: Number(r.received_qty) || 0, unit: r.unit, rate: Number(r.rate) || 0 }))
      );
      await logAudit("mrn", mrn.id, "create", user?.id ?? null, { code: mrn.code, total: mrn.total_value });
      toast.success(`MRN ban gaya: ${mrn.code}`);
      setRows([]); setHeader({ procurement_request_id: "", vendor_name: "", vendor_gstin: "", invoice_ref: "", received_date: new Date().toISOString().slice(0, 10) });
      qc.invalidateQueries({ queryKey: ["mrns", project.id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const makePayable = async (mrnId: string) => {
    const mrn = mrnQ.data?.find((m) => m.id === mrnId);
    if (!mrn) return;
    try {
      const pay = await createPayableFromMrn(mrn, user?.id ?? null);
      await logAudit("payment", pay.id, "create_payable", user?.id ?? null, { code: pay.code, mrn: mrn.code, amount: pay.amount });
      toast.success(`Vendor bill ban gaya: ${pay.code}`);
      qc.invalidateQueries({ queryKey: ["payments", project.id] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Material Receiving Note (MRN)</CardTitle>
        <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-3.5 w-3.5 mr-1" />Line jodein</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">Maal aane par yahan record karein — kitna order tha vs kitna aaya. Phir "Vendor bill banayein" se finance me payable chala jaata hai.</p>

        {/* header */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs col-span-2" value={header.procurement_request_id} onChange={(e) => prefillFromPr(e.target.value)}>
            <option value="">— PR se prefill (optional) —</option>
            {(prQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}{p.cps_pr_number ? ` (${p.cps_pr_number})` : ""}</option>)}
          </select>
          <Input className="h-8" placeholder="Vendor" value={header.vendor_name} onChange={(e) => setHeader({ ...header, vendor_name: e.target.value })} />
          <Input className="h-8" type="date" value={header.received_date} onChange={(e) => setHeader({ ...header, received_date: e.target.value })} />
          <Input className="h-8" placeholder="Invoice ref" value={header.invoice_ref} onChange={(e) => setHeader({ ...header, invoice_ref: e.target.value })} />
          <Input className="h-8" placeholder="Vendor GSTIN" value={header.vendor_gstin} onChange={(e) => setHeader({ ...header, vendor_gstin: e.target.value })} />
        </div>

        {rows.length > 0 && (
          <>
            <div className="grid grid-cols-[1.4fr_70px_70px_55px_80px_80px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1"><span>Material</span><span>Ordered</span><span>Received</span><span>Unit</span><span>Rate</span><span>Amount</span><span /></div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_70px_70px_55px_80px_80px_28px] gap-2 items-center">
                <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={r.material_id ?? ""} onChange={(e) => { const m = matQ.data?.find((x) => x.id === e.target.value); setRows((a) => a.map((y, j) => j === i ? { ...y, material_id: e.target.value, description: m?.name ?? y.description, unit: m?.unit ?? y.unit } : y)); }}>
                  <option value="">(custom)</option>
                  {(matQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <Input className="h-8" type="number" step="any" value={r.ordered_qty} onChange={(e) => setRows((a) => a.map((y, j) => j === i ? { ...y, ordered_qty: e.target.value } : y))} />
                <Input className="h-8" type="number" step="any" value={r.received_qty} onChange={(e) => setRows((a) => a.map((y, j) => j === i ? { ...y, received_qty: e.target.value } : y))} />
                <Input className="h-8" value={r.unit} onChange={(e) => setRows((a) => a.map((y, j) => j === i ? { ...y, unit: e.target.value } : y))} />
                <Input className="h-8" type="number" step="any" value={r.rate} onChange={(e) => setRows((a) => a.map((y, j) => j === i ? { ...y, rate: e.target.value } : y))} />
                <span className="text-xs text-right tabular-nums">{formatINR((Number(r.received_qty) || 0) * (Number(r.rate) || 0))}</span>
                <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setRows((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm">Total: <b>{formatINR(total)}</b></span>
              <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}MRN save karein</Button>
            </div>
          </>
        )}

        {/* existing MRNs */}
        {!!mrnQ.data?.length && (
          <div className="border-t pt-3 space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground">Pichle MRN</p>
            {mrnQ.data.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-xs border rounded-md px-2 py-1.5">
                <span className="flex items-center gap-2"><Badge variant="outline" className="font-mono text-[10px]">{m.code}</Badge>{m.vendor_name ?? "—"} · {m.received_date}</span>
                <span className="flex items-center gap-3">
                  <b className="tabular-nums">{formatINR(m.total_value)}</b>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => makePayable(m.id)}><Wallet className="h-3.5 w-3.5 mr-1" />Vendor bill banayein</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
