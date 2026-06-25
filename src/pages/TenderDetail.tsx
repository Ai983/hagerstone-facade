import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileInput, Save, Loader2, ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTender, updateTender, convertTenderToProject, fetchSystems, type EstimateLineDraft } from "@/lib/facadeApi";
import { TenderScopePanel } from "@/components/TenderScopePanel";
import { DrawingTakeoffPanel } from "@/components/DrawingTakeoffPanel";
import { formatINR } from "@/lib/rateEngine";
import { logAudit } from "@/lib/audit";

const TENDER_STATUSES = ["received", "scoping", "qualified", "converted", "declined"];

export default function TenderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();

  const tQ = useQuery({ queryKey: ["tender", id], queryFn: () => fetchTender(id!), enabled: !!id });
  const sysQ = useQuery({ queryKey: ["systems"], queryFn: fetchSystems });

  const [t, setT] = useState<any>(null);
  const [scope, setScope] = useState<EstimateLineDraft[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (tQ.data) setT({ ...tQ.data }); }, [tQ.data]);

  const sysById = Object.fromEntries((sysQ.data ?? []).map((s) => [s.id, s]));
  const addLines = (lines: EstimateLineDraft[]) => setScope((prev) => [...prev, ...lines]);
  const scopeTotal = scope.reduce((s, l) => s + (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0), 0);
  const converted = t?.status === "converted";

  const save = async () => {
    if (!id || !t) return;
    setBusy(true);
    try {
      await updateTender(id, { client_name: t.client_name, tender_name: t.tender_name, location: t.location, site_address: t.site_address, due_date: t.due_date || null, status: t.status, notes: t.notes });
      await logAudit("tender", id, "update", user?.id ?? null, { code: t.code });
      toast.success("Tender save ho gaya");
      qc.invalidateQueries({ queryKey: ["tender", id] });
      qc.invalidateQueries({ queryKey: ["tenders"] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const convert = async () => {
    if (!id || !tQ.data) return;
    setBusy(true);
    try {
      const { project } = await convertTenderToProject(tQ.data, scope, user?.id ?? null);
      await logAudit("tender", id, "convert", user?.id ?? null, { code: tQ.data.code, project_id: project.id, lines: scope.length });
      toast.success("Project ban gaya: " + project.code);
      qc.invalidateQueries({ queryKey: ["tenders"] });
      navigate(`/projects/${project.id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!t) return <Layout><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <button onClick={() => navigate("/tenders")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"><ArrowLeft className="h-3 w-3" /> Tenders</button>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileInput className="h-6 w-6 text-primary" /> {t.tender_name} <Badge variant="outline" className="font-mono text-xs">{t.code}</Badge></h1>
        </div>

        {/* tender header */}
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-sm">Tender details</CardTitle>
            {canCreate && <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save</Button>}
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">Client</Label><Input className="h-8" disabled={!canCreate} value={t.client_name} onChange={(e) => setT({ ...t, client_name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Tender name</Label><Input className="h-8" disabled={!canCreate} value={t.tender_name} onChange={(e) => setT({ ...t, tender_name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Status</Label>
              <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" disabled={!canCreate} value={t.status} onChange={(e) => setT({ ...t, status: e.target.value })}>
                {TENDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Location</Label><Input className="h-8" disabled={!canCreate} value={t.location ?? ""} onChange={(e) => setT({ ...t, location: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Site address</Label><Input className="h-8" disabled={!canCreate} value={t.site_address ?? ""} onChange={(e) => setT({ ...t, site_address: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Due date</Label><Input className="h-8" type="date" disabled={!canCreate} value={t.due_date ?? ""} onChange={(e) => setT({ ...t, due_date: e.target.value })} /></div>
          </CardContent>
        </Card>

        {converted ? (
          <Card><CardContent className="py-4 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Ye tender project me convert ho chuka hai.</span>
            {t.converted_project_id && <Button size="sm" variant="outline" onClick={() => navigate(`/projects/${t.converted_project_id}`)}>Project kholein <ArrowRight className="h-3.5 w-3.5 ml-1" /></Button>}
          </CardContent></Card>
        ) : (
          <>
            {/* Step 2: scope (text AI) + drawings (PDF AI) */}
            <div className="grid lg:grid-cols-2 gap-4">
              <TenderScopePanel projectId={id!} onAddLines={addLines} />
              <DrawingTakeoffPanel refId={id!} onAddLines={addLines} />
            </div>

            {/* accumulated scope */}
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-sm">Chuna hua scope ({scope.length} lines)</CardTitle>
                {scope.length > 0 && <Button size="sm" variant="ghost" onClick={() => setScope([])}><Trash2 className="h-3.5 w-3.5 mr-1 text-destructive" />Clear</Button>}
              </CardHeader>
              <CardContent className="space-y-2">
                {scope.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Upar se tender/drawing ka scope nikaal kar yahan jodein, phir “Project banayein”.</p>
                ) : (
                  <>
                    {scope.map((l, i) => (
                      <div key={i} className="grid grid-cols-[1fr_80px_90px_90px_28px] gap-2 items-center text-xs border-b border-border/40 pb-1">
                        <span>{l.system_id ? sysById[l.system_id]?.name ?? "System" : (l.notes ?? "Item")}{l.elevation_ref ? ` (${l.elevation_ref})` : ""}</span>
                        <span className="text-right tabular-nums">{Number(l.area_sqm).toFixed(2)} sqm</span>
                        <span className="text-right tabular-nums">{formatINR(Number(l.rate_per_sqm) || 0)}</span>
                        <span className="text-right tabular-nums font-medium">{formatINR((Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0))}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setScope((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm pt-1"><span className="text-muted-foreground">Approx total</span><span className="font-bold text-primary">{formatINR(scopeTotal)}</span></div>
                  </>
                )}
                {canCreate && (
                  <div className="pt-2">
                    <Button onClick={convert} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}Project banayein {scope.length ? `(${scope.length} lines ke saath)` : ""}</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
