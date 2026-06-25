import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Wallet, Plus, Trash2, Save, Loader2, FileSpreadsheet, FileText, ArrowLeft, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchProject, fetchEstimates, fetchBudgets, fetchBudget, fetchBudgetHeads, fetchBudgetPmLines,
  fetchBudgetMaterialLines, createBudgetFromEstimate, updateBudget, replaceBudgetHeads,
  replaceBudgetPmLines, replaceBudgetMaterialLines,
} from "@/lib/facadeApi";
import { computeBudget, computeCashflow, formatINR0, type BudgetHeadInput } from "@/lib/budgetEngine";
import { exportBudgetExcel, exportBudgetPdf } from "@/lib/budgetSheetExport";
import { fetchCalcConfig } from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";

const n = (v: any) => (v === "" || v == null ? "" : String(v));
const num = (v: any) => (v === "" || v == null ? 0 : Number(v));
const MISC_DEFAULT = 10;

export default function BudgetSheet() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canCreate, canViewMargin } = useAuth();
  const ro = !canCreate;

  const projQ = useQuery({ queryKey: ["project", projectId], queryFn: () => fetchProject(projectId!), enabled: !!projectId });
  const estQ = useQuery({ queryKey: ["estimates", projectId], queryFn: () => fetchEstimates(projectId!), enabled: !!projectId });
  const budgetsQ = useQuery({ queryKey: ["budgets", projectId], queryFn: () => fetchBudgets(projectId!), enabled: !!projectId });
  const cfgQ = useQuery({ queryKey: ["calcConfig"], queryFn: fetchCalcConfig });

  const [sel, setSel] = useState<string | null>(null);
  const [b, setB] = useState<any>(null);
  const [heads, setHeads] = useState<any[]>([]);
  const [pmLines, setPmLines] = useState<any[]>([]);
  const [matLines, setMatLines] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (budgetsQ.data && budgetsQ.data.length && !sel) setSel(budgetsQ.data[0].id); }, [budgetsQ.data, sel]);

  const detQ = useQuery({ queryKey: ["budget", sel], queryFn: () => fetchBudget(sel!), enabled: !!sel });
  const headQ = useQuery({ queryKey: ["budgetHeads", sel], queryFn: () => fetchBudgetHeads(sel!), enabled: !!sel });
  const pmQ = useQuery({ queryKey: ["budgetPm", sel], queryFn: () => fetchBudgetPmLines(sel!), enabled: !!sel });
  const matQ = useQuery({ queryKey: ["budgetMat", sel], queryFn: () => fetchBudgetMaterialLines(sel!), enabled: !!sel });

  useEffect(() => { if (detQ.data) setB({ ...detQ.data }); }, [detQ.data]);
  useEffect(() => { if (headQ.data) setHeads(headQ.data.map((h) => ({ ...h }))); }, [headQ.data]);
  useEffect(() => { if (pmQ.data) setPmLines(pmQ.data.map((p) => ({ ...p }))); }, [pmQ.data]);
  useEffect(() => { if (matQ.data) setMatLines(matQ.data.map((m) => ({ ...m }))); }, [matQ.data]);

  const miscPct = useMemo(() => Number((cfgQ.data as any)?.budget_material_misc_pct) || MISC_DEFAULT, [cfgQ.data]);

  // ---- live computation ----
  const result = useMemo(() => {
    if (!b) return null;
    const headInputs: BudgetHeadInput[] = heads.map((h) => ({
      head_name: h.head_name, sort_order: h.sort_order, calc_type: h.calc_type,
      value: num(h.value), pct_value: h.pct_value == null || h.pct_value === "" ? null : num(h.pct_value),
      pct_basis: h.pct_basis, payment_delay_days: num(h.payment_delay_days),
      deliver_from_month: h.deliver_from_month, deliver_from_year: h.deliver_from_year,
      deliver_to_month: h.deliver_to_month, deliver_to_year: h.deliver_to_year,
    }));
    return computeBudget(
      headInputs,
      pmLines.map((p) => ({ qty: num(p.qty), salary: num(p.salary), duration_months: num(p.duration_months) })),
      matLines.map((m) => ({ qty: num(m.qty), rate: num(m.rate) })),
      { markup_pct: num(b.markup_pct), material_misc_pct: miscPct }
    );
  }, [b, heads, pmLines, matLines, miscPct]);

  const cashflow = useMemo(() => {
    if (!b || !result) return null;
    const parse = (d: string | null | undefined) => {
      if (!d) return null;
      const dt = new Date(d); return { m: dt.getMonth() + 1, y: dt.getFullYear() };
    };
    const s = parse(b.start_date) ?? parse(b.reference_date);
    const e = parse(b.completion_date) ?? s;
    if (!s || !e) return null;
    return computeCashflow(result, {
      start_month: s.m, start_year: s.y, end_month: e.m, end_year: e.y,
      advance_pct: num(b.advance_pct), retention_pct: num(b.retention_pct),
      creditor_interest_pct: num(b.creditor_interest_pct),
    });
  }, [b, result]);

  // resolved per-head values keyed by name (for display in the editable grid)
  const resolvedByName = useMemo(() => Object.fromEntries((result?.heads ?? []).map((h) => [h.head_name, h])), [result]);

  const makeBudget = async () => {
    if (!projQ.data) return;
    setBusy(true);
    try {
      const est = estQ.data?.[0] ?? null;
      const created = await createBudgetFromEstimate(projQ.data, est?.id ?? null, user?.id ?? null);
      await logAudit("budget", created.id, "create", user?.id ?? null, { code: created.code });
      toast.success("Budget ban gaya: " + created.code);
      qc.invalidateQueries({ queryKey: ["budgets", projectId] });
      setSel(created.id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!sel || !b || !result) return;
    setBusy(true);
    try {
      await updateBudget(sel, {
        name: b.name, status: b.status, reference_date: b.reference_date || null,
        start_date: b.start_date || null, on_site_date: b.on_site_date || null, completion_date: b.completion_date || null,
        markup_pct: num(b.markup_pct), creditor_interest_pct: num(b.creditor_interest_pct),
        advance_pct: num(b.advance_pct), retention_pct: num(b.retention_pct),
        total_costs: result.total_costs, markup_amount: result.markup_amount, contract_value: result.contract_value,
        cashflow_snapshot: cashflow ? (cashflow.rows as any) : null,
      });
      await replaceBudgetHeads(sel, heads.map((h, i) => ({
        head_name: h.head_name, sort_order: i, calc_type: h.calc_type,
        value: (resolvedByName[h.head_name]?.value) ?? num(h.value),
        pct_value: h.pct_value == null || h.pct_value === "" ? null : num(h.pct_value), pct_basis: h.pct_basis,
        payment_delay_days: num(h.payment_delay_days),
        deliver_from_month: h.deliver_from_month ?? null, deliver_from_year: h.deliver_from_year ?? null,
        deliver_to_month: h.deliver_to_month ?? null, deliver_to_year: h.deliver_to_year ?? null, notes: h.notes ?? null,
      })));
      await replaceBudgetPmLines(sel, pmLines.map((p) => ({ description: p.description ?? "", uom: p.uom ?? "Nos", qty: num(p.qty), salary: num(p.salary), duration_months: num(p.duration_months) })));
      await replaceBudgetMaterialLines(sel, matLines.map((m) => ({ description: m.description ?? "", qty: num(m.qty), uom: m.uom ?? "", rate: num(m.rate), source: m.source ?? "manual" })));
      await logAudit("budget", sel, "update", user?.id ?? null, { code: b.code, contract_value: result.contract_value });
      toast.success("Budget save ho gaya");
      qc.invalidateQueries({ queryKey: ["budget", sel] });
      qc.invalidateQueries({ queryKey: ["budgetHeads", sel] });
      qc.invalidateQueries({ queryKey: ["budgetPm", sel] });
      qc.invalidateQueries({ queryKey: ["budgetMat", sel] });
      qc.invalidateQueries({ queryKey: ["budgets", projectId] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const doExport = (kind: "xlsx" | "pdf") => {
    if (!result || !b || !projQ.data) return;
    const data = {
      projectName: projQ.data.project_name, clientName: projQ.data.client_name, budgetCode: b.code,
      referenceDate: b.reference_date, budget: result, cashflow: cashflow ?? { rows: [], total_cash_out: 0, total_cash_in: 0, total_interest: 0, peak_negative: 0 },
      pmLines: pmLines.map((p) => ({ description: p.description, uom: p.uom, qty: num(p.qty), salary: num(p.salary), duration_months: num(p.duration_months), amount: num(p.qty) * num(p.salary) * num(p.duration_months) })),
      materialLines: matLines.map((m) => ({ description: m.description, qty: num(m.qty), uom: m.uom, rate: num(m.rate), amount: num(m.qty) * num(m.rate) })),
      showMargin: canViewMargin,
    };
    if (kind === "xlsx") exportBudgetExcel(data); else exportBudgetPdf(data);
    logAudit("budget", sel!, kind === "xlsx" ? "export_xlsx" : "export_pdf", user?.id ?? null, { code: b.code });
  };

  const isMaterialHead = (name: string) => /material/i.test(name);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <button onClick={() => navigate(`/projects/${projectId}`)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"><ArrowLeft className="h-3 w-3" /> Project par wapas</button>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Budget Sheet</h1>
            <p className="text-muted-foreground text-sm mt-1">{projQ.data ? `${projQ.data.project_name} · ${projQ.data.client_name}` : ""} — Cost heads + markup + mahina-wise cash flow. Excel manual kaam ki jagah.</p>
          </div>
          {canCreate && <Button onClick={makeBudget} disabled={busy}><Plus className="h-4 w-4 mr-2" />Naya Budget {estQ.data?.[0] ? "(estimate se)" : ""}</Button>}
        </div>

        {/* budget version selector */}
        {!!budgetsQ.data?.length && (
          <div className="flex gap-2 flex-wrap">
            {budgetsQ.data.map((x) => (
              <button key={x.id} onClick={() => setSel(x.id)} className={`px-3 py-1.5 rounded-md border text-sm ${sel === x.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}>
                <Badge variant="secondary" className="font-mono text-[10px] mr-1">{x.code}</Badge>v{x.version}
              </button>
            ))}
          </div>
        )}

        {!b ? (
          <p className="text-sm text-muted-foreground">{budgetsQ.data?.length === 0 ? "Abhi koi budget nahi. “Naya Budget” dabayein — estimate se material apne aap bhar jaayega." : "Budget chunein."}</p>
        ) : (
          <div className="space-y-4">
            {/* header / params */}
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-sm">Budget settings</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => doExport("xlsx")}><FileSpreadsheet className="h-3.5 w-3.5 mr-1" />Excel nikalo</Button>
                  <Button size="sm" variant="outline" onClick={() => doExport("pdf")}><FileText className="h-3.5 w-3.5 mr-1" />PDF nikalo</Button>
                  {!ro && <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save karein</Button>}
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">Name</Label><Input className="h-8" disabled={ro} value={b.name ?? ""} onChange={(e) => setB({ ...b, name: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Start date</Label><Input className="h-8" type="date" disabled={ro} value={b.start_date ?? ""} onChange={(e) => setB({ ...b, start_date: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Completion date</Label><Input className="h-8" type="date" disabled={ro} value={b.completion_date ?? ""} onChange={(e) => setB({ ...b, completion_date: e.target.value })} /></div>
                {[["markup_pct", "Markup %"], ["advance_pct", "Advance %"], ["retention_pct", "Retention %"], ["creditor_interest_pct", "Interest % (yr)"]].map(([k, lbl]) => (
                  <div key={k} className="space-y-1"><Label className="text-xs">{lbl}</Label><Input className="h-8" type="number" step="any" disabled={ro} value={n(b[k])} onChange={(e) => setB({ ...b, [k]: e.target.value })} /></div>
                ))}
              </CardContent>
            </Card>

            {/* cost heads */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Cost heads</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1.4fr_90px_110px_90px_70px_80px_80px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
                  <span>Head</span><span>Type</span><span>Value / %</span><span>Resolved</span><span>Delay d</span><span>From M/Y</span><span>To M/Y</span>
                </div>
                {heads.map((h, i) => {
                  const r = resolvedByName[h.head_name];
                  const isPct = h.calc_type === "pct_of";
                  const isAuto = h.calc_type === "staffing" || (h.calc_type === "from_estimate" && isMaterialHead(h.head_name));
                  return (
                    <div key={i} className="grid grid-cols-[1.4fr_90px_110px_90px_70px_80px_80px] gap-2 items-center">
                      <span className="text-sm truncate" title={h.head_name}>{h.head_name}</span>
                      <span className="text-[11px] text-muted-foreground">{h.calc_type === "pct_of" ? "%" : h.calc_type === "staffing" ? "staffing" : h.calc_type === "from_estimate" ? "estimate" : "manual"}</span>
                      {isPct ? (
                        <Input className="h-8" type="number" step="any" disabled={ro} value={n(h.pct_value)} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, pct_value: e.target.value } : y))} placeholder="%" />
                      ) : (
                        <Input className="h-8" type="number" step="any" disabled={ro || isAuto} value={isAuto ? "" : n(h.value)} placeholder={isAuto ? "auto" : ""} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, value: e.target.value } : y))} />
                      )}
                      <span className="text-sm font-medium text-right tabular-nums">{r ? formatINR0(r.value) : "—"}</span>
                      <Input className="h-8" type="number" step="any" disabled={ro} value={n(h.payment_delay_days)} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, payment_delay_days: e.target.value } : y))} />
                      <div className="flex gap-1">
                        <Input className="h-8 px-1" type="number" placeholder="M" disabled={ro} value={n(h.deliver_from_month)} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, deliver_from_month: e.target.value === "" ? null : Number(e.target.value) } : y))} />
                        <Input className="h-8 px-1" type="number" placeholder="Y" disabled={ro} value={n(h.deliver_from_year)} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, deliver_from_year: e.target.value === "" ? null : Number(e.target.value) } : y))} />
                      </div>
                      <div className="flex gap-1">
                        <Input className="h-8 px-1" type="number" placeholder="M" disabled={ro} value={n(h.deliver_to_month)} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, deliver_to_month: e.target.value === "" ? null : Number(e.target.value) } : y))} />
                        <Input className="h-8 px-1" type="number" placeholder="Y" disabled={ro} value={n(h.deliver_to_year)} onChange={(e) => setHeads((x) => x.map((y, j) => j === i ? { ...y, deliver_to_year: e.target.value === "" ? null : Number(e.target.value) } : y))} />
                      </div>
                    </div>
                  );
                })}
                {/* totals */}
                {result && (
                  <div className="mt-3 pt-3 border-t space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Cost</span><span className="font-medium tabular-nums">{formatINR0(result.total_costs)}</span></div>
                    {canViewMargin && <div className="flex justify-between"><span className="text-muted-foreground">Markup ({result.markup_pct}%)</span><span className="font-medium tabular-nums">{formatINR0(result.markup_amount)}</span></div>}
                    {canViewMargin && <div className="flex justify-between text-base"><span className="font-semibold">Contract Value (ex-Tax)</span><span className="font-bold text-primary tabular-nums">{formatINR0(result.contract_value)}</span></div>}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Material build-up */}
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-sm">Material build-up <span className="text-[11px] text-muted-foreground font-normal">(+{miscPct}% misc → Material head)</span></CardTitle>
                {!ro && <Button size="sm" variant="outline" onClick={() => setMatLines((x) => [...x, { description: "", qty: 0, uom: "", rate: 0, source: "manual" }])}><Plus className="h-3.5 w-3.5 mr-1" />Jodein</Button>}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1fr_80px_70px_90px_90px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1"><span>Description</span><span>Qty</span><span>UOM</span><span>Rate</span><span>Amount</span><span /></div>
                {matLines.map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_70px_90px_90px_28px] gap-2 items-center">
                    <Input className="h-8" disabled={ro} value={m.description ?? ""} onChange={(e) => setMatLines((x) => x.map((y, j) => j === i ? { ...y, description: e.target.value } : y))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={n(m.qty)} onChange={(e) => setMatLines((x) => x.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} />
                    <Input className="h-8" disabled={ro} value={m.uom ?? ""} onChange={(e) => setMatLines((x) => x.map((y, j) => j === i ? { ...y, uom: e.target.value } : y))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={n(m.rate)} onChange={(e) => setMatLines((x) => x.map((y, j) => j === i ? { ...y, rate: e.target.value } : y))} />
                    <span className="text-sm text-right tabular-nums">{formatINR0(num(m.qty) * num(m.rate))}</span>
                    {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setMatLines((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                  </div>
                ))}
                {result && <div className="flex justify-between text-sm pt-2 border-t"><span className="text-muted-foreground">Build-up total</span><span className="tabular-nums">{formatINR0(result.material_buildup)}</span></div>}
              </CardContent>
            </Card>

            {/* PM staffing */}
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-sm">Project Management — staffing</CardTitle>
                {!ro && <Button size="sm" variant="outline" onClick={() => setPmLines((x) => [...x, { description: "", uom: "Nos", qty: 1, salary: 0, duration_months: 1 }])}><Plus className="h-3.5 w-3.5 mr-1" />Jodein</Button>}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1fr_60px_90px_70px_90px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1"><span>Role</span><span>Qty</span><span>Salary</span><span>Months</span><span>Amount</span><span /></div>
                {pmLines.map((p, i) => (
                  <div key={i} className="grid grid-cols-[1fr_60px_90px_70px_90px_28px] gap-2 items-center">
                    <Input className="h-8" disabled={ro} value={p.description ?? ""} onChange={(e) => setPmLines((x) => x.map((y, j) => j === i ? { ...y, description: e.target.value } : y))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={n(p.qty)} onChange={(e) => setPmLines((x) => x.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={n(p.salary)} onChange={(e) => setPmLines((x) => x.map((y, j) => j === i ? { ...y, salary: e.target.value } : y))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={n(p.duration_months)} onChange={(e) => setPmLines((x) => x.map((y, j) => j === i ? { ...y, duration_months: e.target.value } : y))} />
                    <span className="text-sm text-right tabular-nums">{formatINR0(num(p.qty) * num(p.salary) * num(p.duration_months))}</span>
                    {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setPmLines((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                  </div>
                ))}
                {result && <div className="flex justify-between text-sm pt-2 border-t"><span className="text-muted-foreground">PM total</span><span className="tabular-nums">{formatINR0(result.pm_total)}</span></div>}
              </CardContent>
            </Card>

            {/* cash flow */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Cash flow (mahina-wise)</CardTitle></CardHeader>
              <CardContent>
                {!cashflow || !cashflow.rows.length ? (
                  <p className="text-xs text-muted-foreground">Start date + completion date bharein, cost heads ki delivery month/year set karein — cash flow apne aap ban jaayega.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase text-muted-foreground border-b">
                          <th className="text-left py-1 pr-3">Month</th><th className="text-right px-2">Cash Out</th><th className="text-right px-2">Cash In</th><th className="text-right px-2">Net</th><th className="text-right px-2">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashflow.rows.map((c, i) => (
                          <tr key={i} className="border-b border-border/40">
                            <td className="py-1 pr-3">{c.label}</td>
                            <td className="text-right px-2 tabular-nums">{c.cash_out ? formatINR0(c.cash_out) : "—"}</td>
                            <td className="text-right px-2 tabular-nums">{c.cash_in ? formatINR0(c.cash_in) : "—"}</td>
                            <td className={`text-right px-2 tabular-nums ${c.net < 0 ? "text-destructive" : ""}`}>{formatINR0(c.net)}</td>
                            <td className={`text-right px-2 tabular-nums font-medium ${c.balance < 0 ? "text-destructive" : "text-emerald-600"}`}>{formatINR0(c.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex gap-6 mt-3 text-xs text-muted-foreground">
                      <span>Total out: <b className="text-foreground">{formatINR0(cashflow.total_cash_out)}</b></span>
                      <span>Total in: <b className="text-foreground">{formatINR0(cashflow.total_cash_in)}</b></span>
                      <span>Peak financing need: <b className="text-destructive">{formatINR0(cashflow.peak_negative)}</b></span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
