import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Save, Copy, FileText, FileSignature, Loader2, ListChecks, Play, CheckCircle2, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchProject, fetchEstimates, fetchEstimateLines, fetchSystems, createEstimate, reviseEstimate,
  saveEstimateLines, updateProjectStatus, computeSystemCurrentRate,
  fetchQuotations, createQuotationFromEstimate,
  fetchProjectStages, updateStage, fetchEmployees, nextRef,
  buildProcurementBom, createProcurementExport, createPaymentExport, type EstimateLineDraft,
} from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";
import { formatINR } from "@/lib/rateEngine";
import { agingHours, agingLevel, AGING_CLASS, AGING_LABEL, fmtHours } from "@/lib/aging";
import {
  buildCpsProcurementPayload, buildFinancePaymentPayload, downloadJson, downloadCsv,
} from "@/lib/exporters";
import { runElevationTakeoff, fileToBase64, CONFIDENCE_THRESHOLD } from "@/lib/elevationTakeoff";
import { Download, Sparkles } from "lucide-react";

const PROJECT_STATUSES = ["enquiry", "estimating", "quoted", "approved", "in_execution", "completed", "lost"];

export default function ProjectDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();

  const projQ = useQuery({ queryKey: ["project", id], queryFn: () => fetchProject(id), enabled: !!id });
  const estQ = useQuery({ queryKey: ["estimates", id], queryFn: () => fetchEstimates(id), enabled: !!id });
  const sysQ = useQuery({ queryKey: ["systems"], queryFn: fetchSystems });

  const [selEst, setSelEst] = useState<string | null>(null);
  useEffect(() => {
    if (estQ.data && estQ.data.length && !selEst) setSelEst(estQ.data[0].id);
  }, [estQ.data, selEst]);

  const linesQ = useQuery({
    queryKey: ["estimateLines", selEst], queryFn: () => fetchEstimateLines(selEst!), enabled: !!selEst,
  });
  const quotesQ = useQuery({ queryKey: ["quotations", id], queryFn: () => fetchQuotations(id), enabled: !!id });
  const stagesQ = useQuery({ queryKey: ["stages", id], queryFn: () => fetchProjectStages(id), enabled: !!id });
  const empQ = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

  const [lines, setLines] = useState<EstimateLineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (linesQ.data) setLines(linesQ.data.map((l) => ({
      system_id: l.system_id, elevation_ref: l.elevation_ref, area_sqm: l.area_sqm,
      rate_per_sqm: l.rate_per_sqm, notes: l.notes,
      area_source: l.area_source, ai_confidence: l.ai_confidence, ai_confidence_reason: l.ai_confidence_reason,
    })));
  }, [linesQ.data]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const selectedEstimate = estQ.data?.find((e) => e.id === selEst) ?? null;
  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0), 0), [lines]);

  const sysById = useMemo(() => Object.fromEntries((sysQ.data ?? []).map((s) => [s.id, s])), [sysQ.data]);

  const handleNewEstimate = async () => {
    setBusy(true);
    try {
      const est = await createEstimate(id, user?.id ?? null);
      await logAudit("estimate", est.id, "create", user?.id ?? null, { code: est.code, version: est.version });
      if (projQ.data?.status === "enquiry") await updateProjectStatus(id, "estimating");
      toast.success(`Created ${est.code} (v${est.version})`);
      await qc.invalidateQueries({ queryKey: ["estimates", id] });
      await qc.invalidateQueries({ queryKey: ["project", id] });
      setSelEst(est.id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handleRevise = async () => {
    if (!selEst) return;
    setBusy(true);
    try {
      const est = await reviseEstimate(id, selEst, user?.id ?? null);
      await logAudit("estimate", est.id, "revise", user?.id ?? null, { code: est.code, version: est.version, from: selectedEstimate?.code });
      toast.success(`Revised → ${est.code} (v${est.version})`);
      await qc.invalidateQueries({ queryKey: ["estimates", id] });
      setSelEst(est.id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handleSaveLines = async () => {
    if (!selEst) return;
    setBusy(true);
    try {
      const t = await saveEstimateLines(selEst, lines.map((l) => ({
        system_id: l.system_id, elevation_ref: l.elevation_ref || null,
        area_sqm: Number(l.area_sqm) || 0, rate_per_sqm: Number(l.rate_per_sqm) || 0, notes: l.notes || null,
      })));
      await logAudit("estimate", selEst, "update_lines", user?.id ?? null, { lines: lines.length, total: t });
      toast.success(`Saved · total ${formatINR(t)}`);
      await qc.invalidateQueries({ queryKey: ["estimateLines", selEst] });
      await qc.invalidateQueries({ queryKey: ["estimates", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const pickSystem = async (idx: number, systemId: string) => {
    setLines((a) => a.map((x, j) => j === idx ? { ...x, system_id: systemId } : x));
    // snapshot the system's current rate
    try {
      const r = await computeSystemCurrentRate(systemId);
      if (r) setLines((a) => a.map((x, j) => j === idx ? { ...x, rate_per_sqm: Number(r.rate_per_sqm.toFixed(4)) } : x));
    } catch { /* leave rate as-is */ }
  };

  const addLine = () => setLines((a) => [...a, { system_id: sysQ.data?.[0]?.id ?? null, elevation_ref: "", area_sqm: 0, rate_per_sqm: 0, notes: "", area_source: "manual" }]);

  const handleAiTakeoff = async (file: File) => {
    if (!sysQ.data?.length) return;
    setAiBusy(true);
    try {
      toast.info("Analysing elevation… this can take ~20s");
      const b64 = await fileToBase64(file);
      const result = await runElevationTakeoff(b64, sysQ.data.map((s) => ({ code: s.code, name: s.name, category: s.category })));
      const sysByCode = Object.fromEntries(sysQ.data.map((s) => [s.code, s]));
      let auto = 0, manual = 0;
      const newLines: EstimateLineDraft[] = [];
      for (const tl of result.lines) {
        const sys = sysByCode[tl.system_code];
        if (!sys) continue;
        let rate = 0;
        try { const r = await computeSystemCurrentRate(sys.id); if (r) rate = Number(r.rate_per_sqm.toFixed(4)); } catch { /* keep 0 */ }
        const isAuto = tl.confidence >= CONFIDENCE_THRESHOLD;
        if (isAuto) auto++; else manual++;
        newLines.push({
          system_id: sys.id, elevation_ref: tl.elevation_ref, area_sqm: tl.area_sqm, rate_per_sqm: rate,
          notes: null, area_source: isAuto ? "ai" : "manual",
          ai_confidence: tl.confidence, ai_confidence_reason: tl.confidence_reason,
        });
      }
      if (!newLines.length) { toast.error("No systems recognised in the drawing"); return; }
      setLines((a) => [...a, ...newLines]);
      if (manual > 0) toast.warning(`${auto} auto-filled, ${manual} low-confidence — review highlighted lines, then Save`);
      else toast.success(`${auto} lines auto-filled from elevation. Review & Save.`);
    } catch (e: any) {
      toast.error(`AI take-off failed: ${e.message ?? e}`);
    } finally { setAiBusy(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleGenerateQuote = async () => {
    if (!selEst) return;
    setBusy(true);
    try {
      const q = await createQuotationFromEstimate(id, selEst, user?.id ?? null);
      await logAudit("quotation", q.id, "create", user?.id ?? null, { code: q.code, from_estimate: selectedEstimate?.code });
      if (["enquiry", "estimating"].includes(projQ.data?.status ?? "")) await updateProjectStatus(id, "quoted");
      toast.success(`Generated ${q.code}`);
      await qc.invalidateQueries({ queryKey: ["quotations", id] });
      await qc.invalidateQueries({ queryKey: ["project", id] });
      navigate(`/quotations/${q.id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const empById = useMemo(() => Object.fromEntries((empQ.data ?? []).map((e) => [e.id, e.name])), [empQ.data]);

  const changeStage = async (stageId: string, patch: any, action: string) => {
    try {
      await updateStage(stageId, patch);
      await logAudit("project_stage", stageId, action, user?.id ?? null, { project: id, ...patch });
      qc.invalidateQueries({ queryKey: ["stages", id] });
      if (action === "start" && projQ.data?.status === "approved") {
        await updateProjectStatus(id, "in_execution");
        qc.invalidateQueries({ queryKey: ["project", id] });
      }
    } catch (e: any) { toast.error(e.message); }
  };
  const startStage = (s: any) => changeStage(s.id, { status: "in_progress", started_at: new Date().toISOString() }, "start");
  const completeStage = (s: any) => changeStage(s.id, { status: "completed", completed_at: new Date().toISOString() }, "complete");
  const reopenStage = (s: any) => changeStage(s.id, { status: "in_progress", completed_at: null }, "reopen");

  const exportToCps = async () => {
    if (!selEst || !selectedEstimate || !projQ.data) { toast.error("Select an estimate first"); return; }
    setBusy(true);
    try {
      const bom = await buildProcurementBom(selEst);
      if (!bom.length) { toast.error("No materials to procure (estimate has no system lines)"); return; }
      const code = await nextRef("PR");
      const payload = buildCpsProcurementPayload(code, projQ.data, selectedEstimate, bom);
      const req = await createProcurementExport(code, projQ.data, bom, payload);
      downloadJson(payload, `${req.code}.json`);
      downloadCsv(payload.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, gst_percent: l.gst_percent })), `${req.code}-lines.csv`);
      await logAudit("procurement_request", req.id, "export_cps", user?.id ?? null, { code: req.code, lines: bom.length });
      toast.success(`Exported ${req.code} (CPS) — ${bom.length} lines · cps schema untouched`);
      qc.invalidateQueries({ queryKey: ["procurement", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const exportToFinance = async () => {
    if (!projQ.data) return;
    const latestQuote = quotesQ.data?.[0];
    const amount = latestQuote?.total_amount ?? selectedEstimate?.total_amount ?? 0;
    if (!amount) { toast.error("Need a quotation or estimate total to invoice"); return; }
    setBusy(true);
    try {
      const code = await nextRef("PAY");
      const payload = buildFinancePaymentPayload(code, projQ.data, {
        party_name: projQ.data.client_name, amount, payment_type: "client_invoice",
        line_label: `Facade works — ${projQ.data.project_name}`,
      });
      const pay = await createPaymentExport(code, projQ.data.id,
        { payment_type: "client_invoice", party_name: projQ.data.client_name, amount }, payload);
      downloadJson(payload, `${pay.code}.json`);
      downloadCsv([{ cps_po_ref: payload.cps_po_ref, supplier_name: payload.supplier_name, project_name: payload.project_name, total_amount: payload.total_amount, status: payload.status }], `${pay.code}.csv`);
      await logAudit("payment", pay.id, "export_finance", user?.id ?? null, { code: pay.code, amount });
      toast.success(`Exported ${pay.code} (Finance) · finance schema untouched`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (projQ.isLoading || !projQ.data) {
    return <Layout><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></Layout>;
  }
  const p = projQ.data;
  const ro = !canCreate;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/projects")}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{p.code}</Badge>
              <h1 className="text-xl font-bold">{p.project_name}</h1>
            </div>
            <p className="text-xs text-muted-foreground">{p.client_name}{p.location ? ` · ${p.location}` : ""}</p>
          </div>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={ro}
            value={p.status}
            onChange={async (e) => { await updateProjectStatus(id, e.target.value); await logAudit("project", id, "status", user?.id ?? null, { status: e.target.value }); qc.invalidateQueries({ queryKey: ["project", id] }); }}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Estimates / versions */}
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Estimates</CardTitle>
            {canCreate && (
              <div className="flex gap-2">
                {selEst && <Button size="sm" variant="outline" onClick={handleRevise} disabled={busy}><Copy className="h-3.5 w-3.5 mr-1" />Revise (new version)</Button>}
                <Button size="sm" onClick={handleNewEstimate} disabled={busy}><Plus className="h-3.5 w-3.5 mr-1" />New estimate</Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {estQ.data && estQ.data.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {estQ.data.map((e) => (
                  <button key={e.id} onClick={() => setSelEst(e.id)}
                    className={`px-3 py-1.5 rounded-md border text-xs ${selEst === e.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                    <span className="font-mono">{e.code}</span> · v{e.version} · {formatINR(e.total_amount)}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No estimates yet. {canCreate && "Create one to start."}</p>}
          </CardContent>
        </Card>

        {/* Line editor */}
        {selectedEstimate && (
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-sm">
                <span className="font-mono">{selectedEstimate.code}</span> · v{selectedEstimate.version}
                <Badge variant="secondary" className="ml-2">{selectedEstimate.status}</Badge>
              </CardTitle>
              {!ro && (
                <div className="flex gap-2">
                  <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAiTakeoff(f); }} />
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={aiBusy}
                    title="Upload an elevation PDF — AI prefills per-system areas">
                    {aiBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}AI take-off
                  </Button>
                  <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>
                  <Button size="sm" variant="outline" onClick={handleSaveLines} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save</Button>
                  <Button size="sm" onClick={handleGenerateQuote} disabled={busy || lines.length === 0}><FileSignature className="h-3.5 w-3.5 mr-1" />Generate quotation</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-[1.4fr_90px_80px_110px_120px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
                <span>System</span><span>Elevation</span><span>Area (sqm)</span><span>Rate/sqm</span><span>Amount</span><span /></div>
              {lines.map((l, i) => {
                const amount = (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0);
                return (
                  <div key={i} className="grid grid-cols-[1.4fr_90px_80px_110px_120px_28px] gap-2 items-center">
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" disabled={ro}
                      value={l.system_id ?? ""} onChange={(e) => pickSystem(i, e.target.value)}>
                      <option value="" disabled>Pick system…</option>
                      {(sysQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                    </select>
                    <Input className="h-8" disabled={ro} value={l.elevation_ref ?? ""} placeholder="E1"
                      onChange={(e) => setLines((a) => a.map((x, j) => j === i ? { ...x, elevation_ref: e.target.value } : x))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={l.area_sqm === 0 ? "" : String(l.area_sqm)}
                      onChange={(e) => setLines((a) => a.map((x, j) => j === i ? { ...x, area_sqm: Number(e.target.value) } : x))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={l.rate_per_sqm === 0 ? "" : String(l.rate_per_sqm)}
                      title={l.system_id ? `Snapshotted from ${sysById[l.system_id]?.code ?? ""}` : ""}
                      onChange={(e) => setLines((a) => a.map((x, j) => j === i ? { ...x, rate_per_sqm: Number(e.target.value) } : x))} />
                    <div className="h-8 flex items-center justify-end text-sm font-medium tabular-nums">{formatINR(amount)}</div>
                    {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setLines((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                    {l.ai_confidence != null && (
                      <div className="col-span-full -mt-1 flex items-center gap-1.5 pl-1">
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span className={`text-[10px] ${l.area_source === "ai" ? "text-muted-foreground" : "text-amber-600"}`}>
                          AI {l.ai_confidence}% · {l.area_source === "ai" ? "auto-filled" : "low confidence — verify"}
                          {l.ai_confidence_reason ? ` · ${l.ai_confidence_reason}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {lines.length === 0 && <p className="text-xs text-muted-foreground px-1">No lines. Add a system to estimate.</p>}
              <Separator className="my-2" />
              <div className="flex justify-end items-center gap-4">
                <span className="text-sm text-muted-foreground">Estimate total</span>
                <span className="text-xl font-bold text-primary tabular-nums">{formatINR(total)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quotations */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileSignature className="h-4 w-4" /> Quotations</CardTitle></CardHeader>
          <CardContent>
            {quotesQ.data && quotesQ.data.length > 0 ? (
              <div className="space-y-2">
                {quotesQ.data.map((q) => (
                  <button key={q.id} onClick={() => navigate(`/quotations/${q.id}`)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-border hover:border-primary/50 hover:bg-accent text-left">
                    <span className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono">{q.code}</Badge>
                      <Badge variant="secondary">{q.status}</Badge>
                      {q.valid_until && <span className="text-xs text-muted-foreground">valid until {q.valid_until}</span>}
                    </span>
                    <span className="font-medium tabular-nums">{formatINR(q.total_amount)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No quotations yet. {canCreate && "Generate one from an estimate above."}</p>}
          </CardContent>
        </Card>

        {/* Execution board (F4) */}
        {stagesQ.data && stagesQ.data.length > 0 && (
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><ListChecks className="h-4 w-4" /> Execution stages</CardTitle>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                {(["fresh", "warn", "amber", "stale"] as const).map((lvl) => (
                  <span key={lvl} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${AGING_CLASS[lvl]}`} />{AGING_LABEL[lvl]}</span>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {stagesQ.data.map((s) => {
                const hrs = s.status === "in_progress" ? agingHours(s.started_at) : null;
                const lvl = agingLevel(hrs);
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${s.status === "completed" ? "bg-emerald-500" : s.status === "in_progress" ? AGING_CLASS[lvl] : "bg-muted-foreground/30"}`}
                      title={s.status === "in_progress" ? `Running ${fmtHours(hrs)}` : s.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.stage}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.status}
                        {s.started_at && ` · started ${new Date(s.started_at).toLocaleDateString("en-IN")}`}
                        {s.status === "in_progress" && hrs != null && ` · running ${fmtHours(hrs)}`}
                        {s.completed_at && ` · done ${new Date(s.completed_at).toLocaleDateString("en-IN")}`}
                      </p>
                    </div>
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs max-w-[140px]" disabled={ro}
                      value={s.owner_id ?? ""}
                      onChange={(e) => changeStage(s.id, { owner_id: e.target.value || null }, "assign")}>
                      <option value="">Unassigned</option>
                      {s.owner_id && !empById[s.owner_id] && <option value={s.owner_id}>{empById[s.owner_id] ?? "Assigned"}</option>}
                      {(empQ.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    {!ro && (
                      <div className="flex gap-1 shrink-0">
                        {s.status === "pending" && <Button size="icon" variant="ghost" className="h-8 w-8" title="Start" onClick={() => startStage(s)}><Play className="h-3.5 w-3.5 text-blue-600" /></Button>}
                        {s.status === "in_progress" && <Button size="icon" variant="ghost" className="h-8 w-8" title="Complete" onClick={() => completeStage(s)}><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /></Button>}
                        {s.status === "completed" && <Button size="icon" variant="ghost" className="h-8 w-8" title="Reopen" onClick={() => reopenStage(s)}><RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /></Button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Exports (F5 — dormant: downloads only, no cps/finance writes) */}
        {canCreate && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4" /> Exports <Badge variant="outline" className="ml-1 text-[10px]">dormant · downloads only</Badge></CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={exportToCps} disabled={busy || !selEst}>
                <Download className="h-3.5 w-3.5 mr-1.5" />Export to CPS (procurement BOM)
              </Button>
              <Button variant="outline" size="sm" onClick={exportToFinance} disabled={busy}>
                <Download className="h-3.5 w-3.5 mr-1.5" />Export to Finance (client invoice)
              </Button>
              <p className="text-[11px] text-muted-foreground w-full">
                Produces JSON + CSV mirroring cps / finance column shapes and records a facade export row. It does not write to the cps or finance schemas.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
