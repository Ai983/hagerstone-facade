import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Save, Download, Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchQuotation, fetchQuotationLines, fetchProject, updateQuotation, seedProjectStages, updateProjectStatus,
  fetchSystems, fetchActiveRateCard, fetchCalcConfig,
} from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";
import { formatINR } from "@/lib/rateEngine";
import { generateQuotationPdf } from "@/lib/generateQuotationPdf";
import { validateSystem } from "@/lib/guardrails";

const QUOTE_STATUSES = ["draft", "sent", "approved", "rejected", "expired"];

const DEFAULT_TERMS =
  "1. Prices are exclusive of GST.\n2. 50% advance along with the work order; balance against delivery.\n3. Delivery: 4-6 weeks from approval of drawings & advance.\n4. Quotation valid for 30 days.\n5. Any scope change will be charged extra.";

export default function QuotationDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canApprove, canCreate } = useAuth();

  const qQ = useQuery({ queryKey: ["quotation", id], queryFn: () => fetchQuotation(id), enabled: !!id });
  const lQ = useQuery({ queryKey: ["quotationLines", id], queryFn: () => fetchQuotationLines(id), enabled: !!id });
  const pQ = useQuery({ queryKey: ["project", qQ.data?.project_id], queryFn: () => fetchProject(qQ.data!.project_id), enabled: !!qQ.data?.project_id });
  const gQ = useQuery({
    queryKey: ["quoteGuards", id],
    queryFn: async () => {
      const [systems, rc, cfg] = await Promise.all([fetchSystems(), fetchActiveRateCard(), fetchCalcConfig()]);
      return { systems, rc, cfg };
    },
    enabled: !!id,
  });

  // Guardrail warnings for the distinct systems used in this quotation
  const guards = (() => {
    if (!gQ.data || !lQ.data) return [] as { system: string; message: string }[];
    const sysById = Object.fromEntries(gQ.data.systems.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const out: { system: string; message: string }[] = [];
    for (const l of lQ.data) {
      if (!l.system_id || seen.has(l.system_id)) continue;
      seen.add(l.system_id);
      const sys = sysById[l.system_id];
      if (!sys) continue;
      for (const g of validateSystem(sys, gQ.data.rc, gQ.data.cfg)) {
        out.push({ system: sys.code, message: g.message });
      }
    }
    return out;
  })();

  const [validUntil, setValidUntil] = useState("");
  const [priceValidUntil, setPriceValidUntil] = useState("");
  const [escalationClause, setEscalationClause] = useState("");
  const [terms, setTerms] = useState("");
  const [status, setStatus] = useState("draft");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (qQ.data) {
      setValidUntil(qQ.data.valid_until ?? "");
      setPriceValidUntil(qQ.data.price_valid_until ?? "");
      setEscalationClause(qQ.data.escalation_clause ?? "");
      setTerms(qQ.data.terms ?? DEFAULT_TERMS);
      setStatus(qQ.data.status);
    }
  }, [qQ.data]);

  const ro = !canCreate;

  const save = async (nextStatus?: string) => {
    setBusy(true);
    try {
      const newStatus = nextStatus ?? status;
      await updateQuotation(id, {
        valid_until: validUntil || null, terms, status: newStatus,
        price_valid_until: priceValidUntil || null, escalation_clause: escalationClause || null,
      });
      if (nextStatus && nextStatus !== qQ.data?.status) {
        await logAudit("quotation", id, `status:${nextStatus}`, user?.id ?? null, { from: qQ.data?.status, to: nextStatus });
      } else {
        await logAudit("quotation", id, "update", user?.id ?? null, {});
      }
      // On approval: seed standard execution stages and advance the project (F4).
      if (newStatus === "approved" && qQ.data) {
        const seeded = await seedProjectStages(qQ.data.project_id, user?.id ?? null);
        await updateProjectStatus(qQ.data.project_id, "approved");
        if (seeded) {
          await logAudit("project", qQ.data.project_id, "stages_seeded", user?.id ?? null, { quotation: qQ.data.code });
          toast.success("Execution stages created");
        }
        qc.invalidateQueries({ queryKey: ["stages", qQ.data.project_id] });
        qc.invalidateQueries({ queryKey: ["project", qQ.data.project_id] });
      }
      setStatus(newStatus);
      toast.success(nextStatus ? `Status → ${nextStatus}` : "Saved");
      qc.invalidateQueries({ queryKey: ["quotation", id] });
      qc.invalidateQueries({ queryKey: ["quotations", qQ.data?.project_id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const exportPdf = () => {
    if (!qQ.data || !pQ.data) return;
    generateQuotationPdf({
      code: qQ.data.code, date: qQ.data.created_at, validUntil: validUntil || null, status,
      clientName: pQ.data.client_name, projectName: pQ.data.project_name,
      location: pQ.data.location, siteAddress: pQ.data.site_address, terms,
      priceValidUntil: priceValidUntil || null, escalationClause: escalationClause || null,
      lines: (lQ.data ?? []).map((l) => ({ description: l.description, area_sqm: l.area_sqm, rate_per_sqm: l.rate_per_sqm, amount: l.amount })),
      total: qQ.data.total_amount,
    });
    logAudit("quotation", id, "export_pdf", user?.id ?? null, {});
  };

  if (qQ.isLoading || !qQ.data) {
    return <Layout><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></Layout>;
  }
  const q = qQ.data;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${q.project_id}`)}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{q.code}</Badge>
              <h1 className="text-xl font-bold">Quotation</h1>
              <Badge variant="secondary">{status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{pQ.data?.client_name} · {pQ.data?.project_name}</p>
          </div>
          <Button variant="outline" onClick={exportPdf}><Download className="h-4 w-4 mr-2" />Export PDF</Button>
        </div>

        {guards.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {guards.length} pricing warning{guards.length > 1 ? "s" : ""} — review before sending
            </p>
            <ul className="text-xs text-amber-700/90 dark:text-amber-400/90 list-disc pl-6">
              {guards.map((g, i) => <li key={i}><b className="font-mono">{g.system}</b> — {g.message}</li>)}
            </ul>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Lines */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Lines</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-muted-foreground border-b">
                      <th className="py-2">#</th><th className="py-2">Description</th>
                      <th className="py-2 text-right">Area</th><th className="py-2 text-right">Rate/sqm</th><th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lQ.data ?? []).map((l, i) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-2 text-muted-foreground">{i + 1}</td>
                        <td className="py-2">{l.description}</td>
                        <td className="py-2 text-right tabular-nums">{l.area_sqm ?? "—"}</td>
                        <td className="py-2 text-right tabular-nums">{formatINR(l.rate_per_sqm ?? 0)}</td>
                        <td className="py-2 text-right tabular-nums">{formatINR(l.amount ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Separator className="my-3" />
                <div className="flex justify-end items-center gap-4">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-xl font-bold text-primary tabular-nums">{formatINR(q.total_amount)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Terms */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Terms &amp; conditions</CardTitle></CardHeader>
              <CardContent>
                <Textarea rows={6} disabled={ro} value={terms} onChange={(e) => setTerms(e.target.value)} />
              </CardContent>
            </Card>
          </div>

          {/* Client fields + status */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Client terms</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Quote valid until</Label>
                  <Input type="date" disabled={ro} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price valid until</Label>
                  <Input type="date" disabled={ro} value={priceValidUntil} onChange={(e) => setPriceValidUntil(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Prefilled from the rate card.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price escalation clause</Label>
                  <Textarea rows={3} disabled={ro} value={escalationClause} placeholder="e.g. Prices firm until the date above; thereafter subject to LME aluminium movement." onChange={(e) => setEscalationClause(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    disabled={ro} value={status} onChange={(e) => setStatus(e.target.value)}>
                    {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {!ro && (
                  <Button className="w-full" onClick={() => save()} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
                  </Button>
                )}
                {canApprove && (
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" className="flex-1" onClick={() => save("approved")} disabled={busy}>Approve</Button>
                    <Button variant="outline" className="flex-1" onClick={() => save("rejected")} disabled={busy}>Reject</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
