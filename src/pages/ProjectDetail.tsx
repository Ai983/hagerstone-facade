import { useEffect, useMemo, useState, useRef } from "react";
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
import { ArrowLeft, Plus, Trash2, Save, Copy, FileText, FileSignature, Loader2, ListChecks, Play, CheckCircle2, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchProject, fetchEstimates, fetchEstimateLines, fetchSystems, createEstimate, reviseEstimate,
  saveEstimateLines, updateProjectStatus, computeSystemCurrentRate,
  fetchQuotations, createQuotationFromEstimate,
  fetchProjectStages, updateStage, fetchEmployees, nextRef,
  buildProcurementBom, createProcurementExport, createPaymentExport,
  fetchMarkupTiers, updateEstimateMeta, fetchEstimateRevisions,
  fetchAssemblies, computeAssemblyCurrentRate, logAiRun,
  fetchAiConfig, createEstimateReview, fetchEstimateReviews, type EstimateLineDraft,
} from "@/lib/facadeApi";
import { reviewEstimate, draftFromBrief } from "@/lib/aiService";
import { ShieldCheck, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Boxes } from "lucide-react";
import { logAudit } from "@/lib/audit";
import { formatINR } from "@/lib/rateEngine";
import { agingHours, agingLevel, AGING_CLASS, AGING_LABEL, fmtHours } from "@/lib/aging";
import {
  buildCpsProcurementPayload, buildFinancePaymentPayload, downloadJson, downloadCsv,
} from "@/lib/exporters";
import { ActualsPanel } from "@/components/ActualsPanel";
import { TenderScopePanel } from "@/components/TenderScopePanel";
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
  const tiersQ = useQuery({ queryKey: ["markupTiers"], queryFn: fetchMarkupTiers });
  const asmQ = useQuery({ queryKey: ["assemblies"], queryFn: fetchAssemblies });
  const [asmDlg, setAsmDlg] = useState(false);
  const [asmForm, setAsmForm] = useState({ assembly_id: "", w: "", h: "", count: "1", elevation_ref: "" });
  const aiCfgQ = useQuery({ queryKey: ["aiConfig"], queryFn: fetchAiConfig });
  const reviewQ = useQuery({ queryKey: ["estimateReviews", selEst], queryFn: () => fetchEstimateReviews(selEst!), enabled: !!selEst });
  const [reviewing, setReviewing] = useState(false);
  const [nlDlg, setNlDlg] = useState(false);
  const [nlBrief, setNlBrief] = useState("");
  const revQ = useQuery({ queryKey: ["estimateRevisions", selEst], queryFn: () => fetchEstimateRevisions(selEst!), enabled: !!selEst });

  const [lines, setLines] = useState<EstimateLineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (linesQ.data) setLines(linesQ.data.map((l) => ({
      system_id: l.system_id, elevation_ref: l.elevation_ref, area_sqm: l.area_sqm,
      rate_per_sqm: l.rate_per_sqm, notes: l.notes,
      area_source: l.area_source, ai_confidence: l.ai_confidence, ai_confidence_reason: l.ai_confidence_reason,
      assembly_id: l.assembly_id, inst_width_mm: l.inst_width_mm, inst_height_mm: l.inst_height_mm, inst_count: l.inst_count,
    })));
  }, [linesQ.data]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const selectedEstimate = estQ.data?.find((e) => e.id === selEst) ?? null;
  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0), 0), [lines]);
  const selectedTier = tiersQ.data?.find((t) => t.id === selectedEstimate?.markup_tier_id) ?? null;
  const contingencyPct = Number(selectedEstimate?.contingency_pct) || 0;
  const contingency = total * (contingencyPct / 100);
  const grandTotal = total + contingency;

  const setTier = async (tierId: string) => {
    if (!selEst) return;
    const tier = tiersQ.data?.find((t) => t.id === tierId) ?? null;
    try {
      await updateEstimateMeta(selEst, { markup_tier_id: tierId || null, contingency_pct: tier?.contingency_pct ?? 0 });
      await logAudit("estimate", selEst, "set_markup_tier", user?.id ?? null, { tier: tier?.name, markup_pct: tier?.markup_pct });
      qc.invalidateQueries({ queryKey: ["estimates", id] });
      toast.success(tier ? `Markup tier: ${tier.name} (${tier.markup_pct}%)` : "Markup tier cleared");
    } catch (e: any) { toast.error(e.message); }
  };

  const repriceWithTier = async () => {
    if (!selEst || !selectedTier) return;
    setBusy(true);
    try {
      const repriced = await Promise.all(lines.map(async (l) => {
        if (!l.system_id) return l;
        try {
          const r = await computeSystemCurrentRate(l.system_id, { ohOverride: selectedTier.markup_pct });
          return r ? { ...l, rate_per_sqm: Number(r.rate_per_sqm.toFixed(4)) } : l;
        } catch { return l; }
      }));
      setLines(repriced);
      await saveEstimateLines(selEst,
        repriced.map((l) => ({ system_id: l.system_id, elevation_ref: l.elevation_ref || null, area_sqm: Number(l.area_sqm) || 0, rate_per_sqm: Number(l.rate_per_sqm) || 0, notes: l.notes || null, area_source: l.area_source, ai_confidence: l.ai_confidence, ai_confidence_reason: l.ai_confidence_reason })),
        user?.id ?? null, `Re-priced with tier ${selectedTier.name} (${selectedTier.markup_pct}%)`);
      await logAudit("estimate", selEst, "reprice_tier", user?.id ?? null, { tier: selectedTier.name });
      toast.success(`${selectedTier.name} markup se rate badal gaye`);
      qc.invalidateQueries({ queryKey: ["estimateLines", selEst] });
      qc.invalidateQueries({ queryKey: ["estimates", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const setScenario = async (label: string) => {
    if (!selEst) return;
    try {
      await updateEstimateMeta(selEst, { scenario_label: label || null });
      qc.invalidateQueries({ queryKey: ["estimates", id] });
    } catch (e: any) { toast.error(e.message); }
  };

  const sysById = useMemo(() => Object.fromEntries((sysQ.data ?? []).map((s) => [s.id, s])), [sysQ.data]);

  const handleNewEstimate = async () => {
    setBusy(true);
    try {
      const est = await createEstimate(id, user?.id ?? null);
      await logAudit("estimate", est.id, "create", user?.id ?? null, { code: est.code, version: est.version });
      if (projQ.data?.status === "enquiry") await updateProjectStatus(id, "estimating");
      toast.success(`${est.code} (v${est.version}) ban gaya`);
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
      toast.success(`Naya version → ${est.code} (v${est.version})`);
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
        area_source: l.area_source, ai_confidence: l.ai_confidence, ai_confidence_reason: l.ai_confidence_reason,
      })), user?.id ?? null, "Lines saved");
      await logAudit("estimate", selEst, "update_lines", user?.id ?? null, { lines: lines.length, total: t });
      toast.success(`Save ho gaya · total ${formatINR(t)}`);
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

  const addFromAssembly = async () => {
    const W = Number(asmForm.w), H = Number(asmForm.h), N = Math.max(1, Math.round(Number(asmForm.count) || 1));
    if (!asmForm.assembly_id || W <= 0 || H <= 0) { toast.error("Set chunein aur W×H daalein"); return; }
    try {
      const r = await computeAssemblyCurrentRate(asmForm.assembly_id, W, H, N);
      if (!r) { toast.error("Koi active rate card nahi"); return; }
      setLines((a) => [...a, {
        system_id: null, elevation_ref: asmForm.elevation_ref || null, area_sqm: Number(r.area.toFixed(4)),
        rate_per_sqm: Number(r.rate_per_sqm.toFixed(4)), notes: null, area_source: "manual",
        assembly_id: asmForm.assembly_id, inst_width_mm: W, inst_height_mm: H, inst_count: N,
      }]);
      setAsmDlg(false); setAsmForm({ assembly_id: "", w: "", h: "", count: "1", elevation_ref: "" });
      toast.success("Set ki line jud gayi — Save karein");
    } catch (e: any) { toast.error(e.message); }
  };
  const asmById = useMemo(() => Object.fromEntries((asmQ.data ?? []).map((x) => [x.id, x])), [asmQ.data]);

  // AI-4: second-checker (advisory; changes no number)
  const runReview = async () => {
    if (!selEst || !selectedEstimate) return;
    setReviewing(true);
    try {
      const payload = {
        code: selectedEstimate.code, version: selectedEstimate.version, subtotal: total,
        contingency_pct: contingencyPct, grand_total: grandTotal, markup_tier: selectedTier?.name ?? null,
        lines: lines.map((l) => ({ system: l.system_id ? sysById[l.system_id]?.code : (l.assembly_id ? "ASSEMBLY" : null), elevation: l.elevation_ref, area_sqm: l.area_sqm, rate_per_sqm: l.rate_per_sqm })),
      };
      const res = await reviewEstimate(payload);
      await createEstimateReview(selEst, res.findings, res.risk_summary);
      await logAiRun({ feature: "review", input_ref: selEst, output: res, confidence: 0, confidence_reason: "advisory review", accepted: false, actor_id: user?.id ?? null });
      toast.success(`Jaanch poori · ${res.findings.length} baat mili`);
      qc.invalidateQueries({ queryKey: ["estimateReviews", selEst] });
    } catch (e: any) { toast.error(`Review failed: ${e.message ?? e}`); } finally { setReviewing(false); }
  };

  // AI-5: natural-language draft → estimate lines
  const runNlDraft = async () => {
    if (!nlBrief.trim()) { toast.error("Pehle kaam likhein"); return; }
    setBusy(true);
    try {
      const codes = (sysQ.data ?? []).map((s) => s.code);
      const res = await draftFromBrief(nlBrief, codes);
      const sysByCode = Object.fromEntries((sysQ.data ?? []).map((s) => [s.code, s]));
      const newLines: EstimateLineDraft[] = [];
      for (const l of res.lines) {
        const sys = l.system_code ? sysByCode[l.system_code] : null;
        let rate = 0;
        if (sys) { try { const r = await computeSystemCurrentRate(sys.id, { ohOverride: l.oh_profit_pct ?? null }); if (r) rate = Number(r.rate_per_sqm.toFixed(4)); } catch { /* */ } }
        newLines.push({ system_id: sys?.id ?? null, elevation_ref: null, area_sqm: l.area_sqm, rate_per_sqm: rate, notes: l.notes, area_source: "ai_extracted", ai_confidence: l.confidence, ai_confidence_reason: nlBrief.slice(0, 120) });
      }
      if (!newLines.length) { toast.error("Likhe se system match nahi hua"); return; }
      setLines((a) => [...a, ...newLines]);
      await logAiRun({ feature: "nl_draft", input_ref: selEst, output: res, confidence: res.confidence, confidence_reason: res.confidence_reason, accepted: true, actor_id: user?.id ?? null });
      setNlDlg(false); setNlBrief("");
      toast.success(`${newLines.length} draft lines added — review & Save`);
    } catch (e: any) { toast.error(`Draft failed: ${e.message ?? e}`); } finally { setBusy(false); }
  };
  const aiCfg = aiCfgQ.data ?? {};

  const handleAiTakeoff = async (file: File) => {
    if (!sysQ.data?.length) return;
    setAiBusy(true);
    try {
      toast.info("Drawing padh raha hoon… ~20 second lagega");
      const b64 = await fileToBase64(file);
      const result = await runElevationTakeoff(b64, sysQ.data.map((s) => ({ code: s.code, name: s.name, category: s.category })));
      logAiRun({ feature: "takeoff", input_ref: id, output: result, confidence: result.overall_confidence, confidence_reason: "elevation take-off", accepted: false, actor_id: user?.id ?? null });
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
      if (!newLines.length) { toast.error("Drawing me koi system nahi mila"); return; }
      setLines((a) => [...a, ...newLines]);
      if (manual > 0) toast.warning(`${auto} apne aap bhare, ${manual} me bharosa kam — peeli lines dekhein, phir Save`);
      else toast.success(`${auto} lines apne aap bhar gayi. Dekh kar Save karein.`);
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
      toast.success(`${q.code} ban gaya`);
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
    if (!selEst || !selectedEstimate || !projQ.data) { toast.error("Pehle ek estimate chunein"); return; }
    setBusy(true);
    try {
      const bom = await buildProcurementBom(selEst);
      if (!bom.length) { toast.error("Koi material nahi (estimate me system lines nahi)"); return; }
      const code = await nextRef("PR");
      const payload = buildCpsProcurementPayload(code, projQ.data, selectedEstimate, bom);
      const req = await createProcurementExport(code, projQ.data, bom, payload);
      downloadJson(payload, `${req.code}.json`);
      downloadCsv(payload.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, gst_percent: l.gst_percent })), `${req.code}-lines.csv`);
      await logAudit("procurement_request", req.id, "export_cps", user?.id ?? null, { code: req.code, lines: bom.length });
      toast.success(`${req.code} CPS ko bhej diya — ${bom.length} lines · cps ko haath nahi lagaya`);
      qc.invalidateQueries({ queryKey: ["procurement", id] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const exportToFinance = async () => {
    if (!projQ.data) return;
    const latestQuote = quotesQ.data?.[0];
    const amount = latestQuote?.total_amount ?? selectedEstimate?.total_amount ?? 0;
    if (!amount) { toast.error("Invoice ke liye quotation/estimate total chahiye"); return; }
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
      toast.success(`${pay.code} Finance ko bhej diya · finance ko haath nahi lagaya`);
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
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Estimates (Hisaab)</CardTitle>
            {canCreate && (
              <div className="flex gap-2">
                {selEst && <Button size="sm" variant="outline" onClick={handleRevise} disabled={busy}><Copy className="h-3.5 w-3.5 mr-1" />Naya version</Button>}
                <Button size="sm" onClick={handleNewEstimate} disabled={busy}><Plus className="h-3.5 w-3.5 mr-1" />Naya Estimate</Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {estQ.data && estQ.data.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {estQ.data.map((e) => (
                  <button key={e.id} onClick={() => setSelEst(e.id)}
                    className={`px-3 py-1.5 rounded-md border text-xs ${selEst === e.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                    <span className="font-mono">{e.code}</span> · v{e.version}{e.scenario_label ? ` · ${e.scenario_label}` : ""} · {formatINR(e.total_amount)}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Abhi koi estimate nahi. {canCreate && "Naya Estimate banayein."}</p>}
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
                    title="Elevation PDF daalein — AI khud area bhar dega">
                    {aiBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}AI se area
                  </Button>
                  <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1" />Line jodein</Button>
                  {aiCfg.nl_draft?.enabled && (
                    <Dialog open={nlDlg} onOpenChange={setNlDlg}>
                      <DialogTrigger asChild><Button size="sm" variant="outline"><Wand2 className="h-3.5 w-3.5 mr-1" />AI se likho</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Likh kar estimate lines banayein</DialogTitle></DialogHeader>
                        <div className="space-y-2">
                          <Textarea rows={3} value={nlBrief} placeholder="jaise: 400 sqm straight glazing 6+12+6 DGU 18% margin; 40 sqm louvres" onChange={(e) => setNlBrief(e.target.value)} />
                          <p className="text-[11px] text-muted-foreground">AI aapke likhe se lines bana dega aur rate system se le lega. Save se pehle har line dekh lein — AI khud rate tay nahi karta.</p>
                        </div>
                        <DialogFooter><Button onClick={runNlDraft} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lines banayein"}</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                  <Dialog open={asmDlg} onOpenChange={setAsmDlg}>
                    <DialogTrigger asChild><Button size="sm" variant="outline" disabled={!asmQ.data?.length}><Boxes className="h-3.5 w-3.5 mr-1" />Ready Set se</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Ready Set se line jodein</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1"><Label>Ready Set</Label>
                          <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={asmForm.assembly_id} onChange={(e) => { const x = asmById[e.target.value]; setAsmForm({ ...asmForm, assembly_id: e.target.value, w: x ? String(x.base_width_mm) : asmForm.w, h: x ? String(x.base_height_mm) : asmForm.h }); }}>
                            <option value="">Chunein…</option>
                            {(asmQ.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="space-y-1"><Label>W mm</Label><Input type="number" value={asmForm.w} onChange={(e) => setAsmForm({ ...asmForm, w: e.target.value })} /></div>
                          <div className="space-y-1"><Label>H mm</Label><Input type="number" value={asmForm.h} onChange={(e) => setAsmForm({ ...asmForm, h: e.target.value })} /></div>
                          <div className="space-y-1"><Label>Count</Label><Input type="number" value={asmForm.count} onChange={(e) => setAsmForm({ ...asmForm, count: e.target.value })} /></div>
                          <div className="space-y-1"><Label>Elev.</Label><Input value={asmForm.elevation_ref} onChange={(e) => setAsmForm({ ...asmForm, elevation_ref: e.target.value })} /></div>
                        </div>
                      </div>
                      <DialogFooter><Button onClick={addFromAssembly}>Line jodein</Button></DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button size="sm" variant="outline" onClick={handleSaveLines} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save karein</Button>
                  <Button size="sm" onClick={handleGenerateQuote} disabled={busy || lines.length === 0}><FileSignature className="h-3.5 w-3.5 mr-1" />Quotation banayein</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {/* v1.3 markup tier + scenario */}
              {!ro && (
                <div className="flex flex-wrap items-end gap-3 pb-2 border-b mb-2">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase text-muted-foreground block">Markup tier (munafa)</label>
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selectedEstimate?.markup_tier_id ?? ""} onChange={(e) => setTier(e.target.value)}>
                      <option value="">System wala default (OH&amp;P)</option>
                      {(tiersQ.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.markup_pct}%{t.contingency_pct ? ` +${t.contingency_pct}% cont.` : ""}</option>)}
                    </select>
                  </div>
                  {selectedTier && <Button size="sm" variant="outline" onClick={repriceWithTier} disabled={busy}>Tier ke hisaab se rate badlein</Button>}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase text-muted-foreground block">Scenario naam</label>
                    <Input className="h-8 w-40" defaultValue={selectedEstimate?.scenario_label ?? ""} placeholder="e.g. DGU vs single"
                      onBlur={(e) => { if (e.target.value !== (selectedEstimate?.scenario_label ?? "")) setScenario(e.target.value); }} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-[1.4fr_90px_80px_110px_120px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
                <span>System</span><span>Elevation</span><span>Area (sqm)</span><span>Rate/sqm</span><span>Total</span><span /></div>
              {lines.map((l, i) => {
                const amount = (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0);
                return (
                  <div key={i} className="grid grid-cols-[1.4fr_90px_80px_110px_120px_28px] gap-2 items-center">
                    {l.assembly_id ? (
                      <div className="h-8 flex items-center gap-1.5 text-sm truncate" title="Parametric assembly line">
                        <Boxes className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">{asmById[l.assembly_id]?.name ?? "Assembly"} <span className="text-[10px] text-muted-foreground">{l.inst_width_mm}×{l.inst_height_mm}·{l.inst_count}</span></span>
                      </div>
                    ) : (
                      <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" disabled={ro}
                        value={l.system_id ?? ""} onChange={(e) => pickSystem(i, e.target.value)}>
                        <option value="" disabled>System chunein…</option>
                        {(sysQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                      </select>
                    )}
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
                          AI {l.ai_confidence}% · {l.area_source === "ai" ? "apne aap bhara" : "bharosa kam — check karein"}
                          {l.ai_confidence_reason ? ` · ${l.ai_confidence_reason}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {lines.length === 0 && <p className="text-xs text-muted-foreground px-1">Koi line nahi. Estimate me system jodein.</p>}
              <Separator className="my-2" />
              <div className="space-y-1 ml-auto w-full max-w-xs text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (jod)</span><span className="tabular-nums">{formatINR(total)}</span></div>
                {contingencyPct > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Contingency ({contingencyPct}%)</span><span className="tabular-nums">{formatINR(contingency)}</span></div>
                )}
                <div className="flex justify-between font-bold text-primary text-lg pt-1 border-t"><span>Estimate ka total</span><span className="tabular-nums">{formatINR(grandTotal)}</span></div>
              </div>

              {/* v1.3 revision history */}
              {revQ.data && revQ.data.length > 0 && (
                <div className="border-t pt-2 mt-2">
                  <p className="text-[10px] uppercase text-muted-foreground mb-1">Purane versions ({revQ.data.length})</p>
                  <div className="space-y-0.5 max-h-32 overflow-auto">
                    {revQ.data.map((r) => (
                      <div key={r.id} className="text-[11px] text-muted-foreground flex justify-between">
                        <span>{new Date(r.changed_at).toLocaleString("en-IN")} · {r.change_note ?? "saved"}</span>
                        <span className="tabular-nums">{formatINR((r.snapshot as any)?.total ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Quotations */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileSignature className="h-4 w-4" /> Quotations</CardTitle></CardHeader>
          {/* Quotations section */}
          <CardContent>
            {quotesQ.data && quotesQ.data.length > 0 ? (
              <div className="space-y-2">
                {quotesQ.data.map((q) => (
                  <button key={q.id} onClick={() => navigate(`/quotations/${q.id}`)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-border hover:border-primary/50 hover:bg-accent text-left">
                    <span className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono">{q.code}</Badge>
                      <Badge variant="secondary">{q.status}</Badge>
                      {q.valid_until && <span className="text-xs text-muted-foreground">valid {q.valid_until} tak</span>}
                    </span>
                    <span className="font-medium tabular-nums">{formatINR(q.total_amount)}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Abhi koi quotation nahi. {canCreate && "Upar estimate se banayein."}</p>}
          </CardContent>
        </Card>

        {/* Execution board (F4) */}
        {stagesQ.data && stagesQ.data.length > 0 && (
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><ListChecks className="h-4 w-4" /> Kaam ke stages</CardTitle>
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
                        {s.started_at && ` · shuru ${new Date(s.started_at).toLocaleDateString("en-IN")}`}
                        {s.status === "in_progress" && hrs != null && ` · chal raha ${fmtHours(hrs)}`}
                        {s.completed_at && ` · poora ${new Date(s.completed_at).toLocaleDateString("en-IN")}`}
                      </p>
                    </div>
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs max-w-[140px]" disabled={ro}
                      value={s.owner_id ?? ""}
                      onChange={(e) => changeStage(s.id, { owner_id: e.target.value || null }, "assign")}>
                      <option value="">Kisi ko nahi diya</option>
                      {s.owner_id && !empById[s.owner_id] && <option value={s.owner_id}>{empById[s.owner_id] ?? "Diya gaya"}</option>}
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

        {/* AI-4 estimate second-checker (advisory) */}
        {selectedEstimate && aiCfg.review?.enabled && (
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> AI dobara jaanch</CardTitle>
              {!ro && <Button size="sm" variant="outline" onClick={runReview} disabled={reviewing}>{reviewing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}Estimate jaanchein</Button>}
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-muted-foreground mb-2">AI estimate me galti/kami batata hai (sirf salah, koi number nahi badalta).</p>
              {reviewQ.data && reviewQ.data.length > 0 ? (
                <div className="space-y-2">
                  {reviewQ.data[0].risk_summary && <p className="text-sm">{reviewQ.data[0].risk_summary}</p>}
                  <ul className="text-xs space-y-1">
                    {(reviewQ.data[0].findings ?? []).map((f: any, i: number) => (
                      <li key={i} className={`flex items-start gap-1.5 ${f.severity === "high" ? "text-destructive" : f.severity === "warn" ? "text-amber-600" : "text-muted-foreground"}`}>
                        <span className="uppercase text-[9px] font-bold mt-0.5">{f.severity}</span>{f.message}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-muted-foreground">Aakhri jaanch {new Date(reviewQ.data[0].created_at).toLocaleString("en-IN")}</p>
                </div>
              ) : <p className="text-xs text-muted-foreground">Abhi jaanch nahi hui.</p>}
            </CardContent>
          </Card>
        )}

        {/* AI-2 tender scope extraction */}
        {selectedEstimate && <TenderScopePanel projectId={id} onAddLines={(newLines) => { setLines((a) => [...a, ...newLines]); toast.info("Nayi lines dekhein, phir estimate Save karein"); }} />}

        {/* Estimate vs actual (v1.2 feedback loop) */}
        <ActualsPanel projectId={id} estimate={selectedEstimate} />

        {/* Exports (F5 — dormant: downloads only, no cps/finance writes) */}
        {canCreate && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4" /> Export <Badge variant="outline" className="ml-1 text-[10px]">abhi sirf download</Badge></CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={exportToCps} disabled={busy || !selEst}>
                <Download className="h-3.5 w-3.5 mr-1.5" />CPS ko bhejein (material BOM)
              </Button>
              <Button variant="outline" size="sm" onClick={exportToFinance} disabled={busy}>
                <Download className="h-3.5 w-3.5 mr-1.5" />Finance ko bhejein (client invoice)
              </Button>
              <p className="text-[11px] text-muted-foreground w-full">
JSON + CSV file banata hai (cps / finance jaisa format) aur facade me record rakhta hai. cps ya finance me kuch nahi likhta.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
