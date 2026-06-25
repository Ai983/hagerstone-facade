import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Banknote, Plus, Loader2, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchPayments, createReceivable, updatePayment, fetchQuotations, fetchBudgets,
} from "@/lib/facadeApi";
import { downloadJson, downloadCsv } from "@/lib/exporters";
import { generateFinancePdf } from "@/lib/financePdf";
import { formatINR } from "@/lib/rateEngine";
import { logAudit } from "@/lib/audit";
import type { Project, Payment } from "@/types/facade";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-600", partly_paid: "bg-amber-500/15 text-amber-600",
  paid: "bg-emerald-500/15 text-emerald-600", overdue: "bg-destructive/15 text-destructive",
};

export function FinancePanel({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();
  const payQ = useQuery({ queryKey: ["payments", project.id], queryFn: () => fetchPayments(project.id) });
  const quoteQ = useQuery({ queryKey: ["quotations", project.id], queryFn: () => fetchQuotations(project.id) });
  const budQ = useQuery({ queryKey: ["budgets", project.id], queryFn: () => fetchBudgets(project.id) });
  const [busy, setBusy] = useState(false);

  if (!canCreate) return null;

  const recv = (payQ.data ?? []).filter((p) => p.direction === "receivable");
  const pay = (payQ.data ?? []).filter((p) => p.direction !== "receivable");

  const addReceivable = async () => {
    const fromBudget = budQ.data?.[0]?.contract_value;
    const fromQuote = quoteQ.data?.[0]?.total_amount;
    const amount = Number(fromBudget) || Number(fromQuote) || 0;
    if (!amount) { toast.error("Pehle budget/quotation banayein (amount ke liye)"); return; }
    setBusy(true);
    try {
      const p = await createReceivable({ project_id: project.id, party_name: project.client_name, amount });
      await logAudit("payment", p.id, "create_receivable", user?.id ?? null, { code: p.code, amount });
      toast.success(`Client invoice ban gaya: ${p.code}`);
      qc.invalidateQueries({ queryKey: ["payments", project.id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const setPaid = async (p: Payment, paid: string) => {
    try {
      await updatePayment(p.id, { paid_amount: Number(paid) || 0 });
      qc.invalidateQueries({ queryKey: ["payments", project.id] });
    } catch (e: any) { toast.error(e.message); }
  };

  const exportJson = () => { downloadJson({ project: project.code, payments: payQ.data }, `${project.code}-finance.json`); logAudit("payment", project.id, "export_json", user?.id ?? null, {}); };
  const exportCsv = () => { downloadCsv((payQ.data ?? []).map((p) => ({ code: p.code, direction: p.direction, party: p.party_name, amount: p.amount, paid: p.paid_amount, status: p.status, due: p.due_date })), `${project.code}-finance.csv`); };
  const exportPdf = () => { generateFinancePdf({ projectName: project.project_name, projectCode: project.code, clientName: project.client_name, payments: payQ.data ?? [] }); };

  const Section = ({ title, rows }: { title: string; rows: Payment[] }) => (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase text-muted-foreground">{title}</p>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Abhi kuch nahi.</p>}
      {rows.map((p) => (
        <div key={p.id} className="grid grid-cols-[auto_1fr_90px_90px_90px] gap-2 items-center text-xs border rounded-md px-2 py-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">{p.code}</Badge>
          <span className="truncate">{p.party_name ?? "—"}</span>
          <span className="text-right tabular-nums">{formatINR(p.amount)}</span>
          <Input className="h-7 text-xs" type="number" step="any" defaultValue={p.paid_amount || ""} placeholder="paid" onBlur={(e) => setPaid(p, e.target.value)} />
          <span className={`text-[10px] px-2 py-0.5 rounded-full text-center ${STATUS_COLOR[p.status] ?? "bg-muted"}`}>{p.status}</span>
        </div>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><Banknote className="h-4 w-4" /> Finance — paisa in & out</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportJson}><FileJson className="h-3.5 w-3.5 mr-1" />JSON</Button>
          <Button size="sm" variant="outline" onClick={exportCsv}><FileSpreadsheet className="h-3.5 w-3.5 mr-1" />CSV</Button>
          <Button size="sm" variant="outline" onClick={exportPdf}><FileText className="h-3.5 w-3.5 mr-1" />PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">Client se aane wala (receivable) aur vendor ko dene wala (payable, MRN se). Paid amount bharein — status apne aap update hoga. Export accounts ke liye.</p>
          <Button size="sm" onClick={addReceivable} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}Client invoice</Button>
        </div>
        <Section title="Receivables (client se aana hai)" rows={recv} />
        <Section title="Payables (vendor ko dena hai — MRN se)" rows={pay} />
      </CardContent>
    </Card>
  );
}
