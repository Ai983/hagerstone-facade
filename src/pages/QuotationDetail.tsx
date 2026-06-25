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
  "1. Rate me GST alag se lagega.\n2. Work order ke saath 50% advance; baaki delivery par.\n3. Delivery: drawing approval aur advance ke 4-6 hafte baad.\n4. Quotation 30 din tak valid.\n5. Kaam me badlaav par extra charge lagega.";

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
  // Brawn-Globus letter fields
  const [greetingName, setGreetingName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [pricePerSqft, setPricePerSqft] = useState("");
  const [termA, setTermA] = useState("");
  const [termB, setTermB] = useState("");
  const [termC, setTermC] = useState("");
  const [termD, setTermD] = useState("");

  useEffect(() => {
    if (qQ.data) {
      setValidUntil(qQ.data.valid_until ?? "");
      setPriceValidUntil(qQ.data.price_valid_until ?? "");
      setEscalationClause(qQ.data.escalation_clause ?? "");
      setTerms(qQ.data.terms ?? DEFAULT_TERMS);
      setStatus(qQ.data.status);
      setGreetingName(qQ.data.greeting_name ?? "");
      setSubject(qQ.data.subject ?? "");
      setBodyText(qQ.data.body_text ?? "");
      setPricePerSqft(qQ.data.price_per_sqft != null ? String(qQ.data.price_per_sqft) : "");
      setTermA(qQ.data.payment_terms_a ?? "");
      setTermB(qQ.data.payment_terms_b ?? "");
      setTermC(qQ.data.payment_terms_c ?? "");
      setTermD(qQ.data.payment_terms_d ?? "");
    }
  }, [qQ.data]);

  // Suggested ₹/sqft = total ÷ (Σ area in sqft). 1 sqm = 10.7639 sqft.
  const suggestedPerSqft = (() => {
    const areaSqm = (lQ.data ?? []).reduce((s, l) => s + (Number(l.area_sqm) || 0), 0);
    const sqft = areaSqm * 10.7639;
    if (!sqft || !qQ.data?.total_amount) return null;
    return Math.round((qQ.data.total_amount / sqft) * 100) / 100;
  })();

  const ro = !canCreate;

  const save = async (nextStatus?: string) => {
    setBusy(true);
    try {
      const newStatus = nextStatus ?? status;
      await updateQuotation(id, {
        valid_until: validUntil || null, terms, status: newStatus,
        price_valid_until: priceValidUntil || null, escalation_clause: escalationClause || null,
        greeting_name: greetingName || null, subject: subject || null, body_text: bodyText || null,
        price_per_sqft: pricePerSqft === "" ? null : Number(pricePerSqft),
        payment_terms_a: termA || null, payment_terms_b: termB || null,
        payment_terms_c: termC || null, payment_terms_d: termD || null,
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
          toast.success("Kaam ke stages ban gaye");
        }
        qc.invalidateQueries({ queryKey: ["stages", qQ.data.project_id] });
        qc.invalidateQueries({ queryKey: ["project", qQ.data.project_id] });
      }
      setStatus(newStatus);
      toast.success(nextStatus ? `Status → ${nextStatus}` : "Save ho gaya");
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
      greetingName: greetingName || null, subject: subject || null, bodyText: bodyText || null,
      pricePerSqft: pricePerSqft === "" ? null : Number(pricePerSqft),
      paymentTermsA: termA || null, paymentTermsB: termB || null, paymentTermsC: termC || null, paymentTermsD: termD || null,
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
          <Button variant="outline" onClick={exportPdf}><Download className="h-4 w-4 mr-2" />PDF nikalein</Button>
        </div>

        {guards.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {guards.length} price warning — bhejne se pehle dekhein
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
              <CardHeader className="pb-3"><CardTitle className="text-sm">Lines (items)</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-muted-foreground border-b">
                      <th className="py-2">#</th><th className="py-2">Vivaran</th>
                      <th className="py-2 text-right">Area</th><th className="py-2 text-right">Rate/sqm</th><th className="py-2 text-right">Total</th>
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
                  <span className="text-xl font-bold text-primary tabular-nums">{formatINR(q.total_amount)}{/* */}</span>
                </div>
              </CardContent>
            </Card>

            {/* Brawn-Globus letter (client PDF) */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Quotation letter (client PDF — Brawn format)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Dear (naam)</Label><Input disabled={ro} value={greetingName} placeholder="Mr. Sumit Gogia" onChange={(e) => setGreetingName(e.target.value)} /></div>
                  <div className="space-y-1">
                    <Label className="text-xs">Price ₹ / sqft</Label>
                    <Input type="number" step="any" disabled={ro} value={pricePerSqft} placeholder={suggestedPerSqft ? String(suggestedPerSqft) : "460"} onChange={(e) => setPricePerSqft(e.target.value)} />
                    {suggestedPerSqft != null && (
                      <button type="button" disabled={ro} className="text-[10px] text-primary hover:underline disabled:no-underline disabled:text-muted-foreground" onClick={() => setPricePerSqft(String(suggestedPerSqft))}>
                        Suggest: ₹{suggestedPerSqft}/sqft (total ÷ area)
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1"><Label className="text-xs">Subject</Label><Input disabled={ro} value={subject} placeholder="Providing and fixing ACP projection…" onChange={(e) => setSubject(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Body</Label><Textarea rows={2} disabled={ro} value={bodyText} placeholder="Reference being made to our discussion and BOQ/drawings shared by you…" onChange={(e) => setBodyText(e.target.value)} /></div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Term a (payment)</Label><Textarea rows={2} disabled={ro} value={termA} placeholder="30% advance, 60% supply, 5% installation, 5% handover" onChange={(e) => setTermA(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Term b (scope)</Label><Textarea rows={2} disabled={ro} value={termB} placeholder="Electricity & storage by client; scaffolding in client scope" onChange={(e) => setTermB(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Term c (validity)</Label><Input disabled={ro} value={termC} placeholder="Offer Validity: 30 Days." onChange={(e) => setTermC(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Term d (completion)</Label><Input disabled={ro} value={termD} placeholder="Completion Period - As per agreed terms." onChange={(e) => setTermD(e.target.value)} /></div>
                </div>
                <p className="text-[10px] text-muted-foreground">Khaali chhodne par standard Brawn wording aa jaayegi. "PDF nikalein" se letter banega.</p>
              </CardContent>
            </Card>

            {/* Terms (internal annexure text) */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Terms &amp; conditions (shartein — internal)</CardTitle></CardHeader>
              <CardContent>
                <Textarea rows={6} disabled={ro} value={terms} onChange={(e) => setTerms(e.target.value)} />
              </CardContent>
            </Card>
          </div>

          {/* Client fields + status */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Client ki shartein</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Quotation kab tak valid</Label>
                  <Input type="date" disabled={ro} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price kab tak valid</Label>
                  <Input type="date" disabled={ro} value={priceValidUntil} onChange={(e) => setPriceValidUntil(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Rate card se apne aap bhara.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price badhne ki shart (escalation)</Label>
                  <Textarea rows={3} disabled={ro} value={escalationClause} placeholder="jaise: Upar di date tak rate pakka; uske baad aluminium (LME) ke hisaab se badlega." onChange={(e) => setEscalationClause(e.target.value)} />
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
                    {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save karein
                  </Button>
                )}
                {canApprove && (
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" className="flex-1" onClick={() => save("approved")} disabled={busy}>Manzoor</Button>
                    <Button variant="outline" className="flex-1" onClick={() => save("rejected")} disabled={busy}>Mana</Button>
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
