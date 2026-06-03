import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchActuals, createActual, fetchActualAverages, fetchSystems, updateSystemParams,
} from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";
import { formatINR } from "@/lib/rateEngine";
import type { Estimate } from "@/types/facade";

const numOrNull = (s: string) => (s === "" ? null : Number(s));

export function ActualsPanel({ projectId, estimate }: { projectId: string; estimate: Estimate | null }) {
  const qc = useQueryClient();
  const { user, canCreate, canManageRates } = useAuth();

  const actualsQ = useQuery({ queryKey: ["actuals", projectId], queryFn: () => fetchActuals(projectId), enabled: !!projectId });
  const avgQ = useQuery({ queryKey: ["actualAvg"], queryFn: fetchActualAverages });
  const sysQ = useQuery({ queryKey: ["systems"], queryFn: fetchSystems });

  const [f, setF] = useState({ alu: "", wastage: "", labour: "", freight: "", material: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [applySys, setApplySys] = useState("");

  const save = async () => {
    setBusy(true);
    try {
      await createActual({
        project_id: projectId, estimate_id: estimate?.id ?? null,
        total_alu_kg_actual: numOrNull(f.alu), wastage_pct_actual: numOrNull(f.wastage),
        labour_cost_actual: numOrNull(f.labour), freight_cost_actual: numOrNull(f.freight),
        material_cost_actual: numOrNull(f.material), notes: f.notes || null, recorded_by: user?.id ?? null,
      });
      await logAudit("actual", projectId, "create", user?.id ?? null, { estimate: estimate?.code });
      toast.success("Asli kharcha likh liya");
      setF({ alu: "", wastage: "", labour: "", freight: "", material: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["actuals", projectId] });
      qc.invalidateQueries({ queryKey: ["actualAvg"] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const applyAvgWastage = async () => {
    if (!applySys || avgQ.data?.wastage_pct == null) return;
    const sys = sysQ.data?.find((s) => s.id === applySys);
    if (!sys) return;
    const val = Number(avgQ.data.wastage_pct.toFixed(2));
    if (!confirm(`${sys.code} ka default wastage ${val}% set karein? (${avgQ.data.count} job ka average)`)) return;
    try {
      await updateSystemParams(applySys, { wastage_pct: val });
      await logAudit("system", applySys, "update_wastage_from_actuals", user?.id ?? null, { wastage_pct: val, samples: avgQ.data.count });
      toast.success(`${sys.code} wastage default set to ${val}%`);
      qc.invalidateQueries({ queryKey: ["systems"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const estTotal = estimate?.total_amount ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Estimate vs asli kharcha</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {canCreate && (
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
            <div className="space-y-1"><Label className="text-xs">Alu kg</Label><Input className="h-8" type="number" step="any" value={f.alu} onChange={(e) => setF({ ...f, alu: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Wastage %</Label><Input className="h-8" type="number" step="any" value={f.wastage} onChange={(e) => setF({ ...f, wastage: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Labour ₹</Label><Input className="h-8" type="number" step="any" value={f.labour} onChange={(e) => setF({ ...f, labour: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Freight ₹</Label><Input className="h-8" type="number" step="any" value={f.freight} onChange={(e) => setF({ ...f, freight: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Material ₹</Label><Input className="h-8" type="number" step="any" value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} /></div>
            <Button className="h-8" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="h-3.5 w-3.5 mr-1" />Likhein</>}</Button>
          </div>
        )}

        {actualsQ.data && actualsQ.data.length > 0 ? (
          <div className="space-y-2">
            {actualsQ.data.map((a) => {
              const cost = (a.material_cost_actual ?? 0) + (a.labour_cost_actual ?? 0) + (a.freight_cost_actual ?? 0);
              const margin = estTotal > 0 ? ((estTotal - cost) / estTotal) * 100 : null;
              return (
                <div key={a.id} className="text-xs border border-border rounded-md px-3 py-2 flex flex-wrap gap-x-5 gap-y-1">
                  <span className="text-muted-foreground">{new Date(a.recorded_at).toLocaleDateString("en-IN")}</span>
                  {a.total_alu_kg_actual != null && <span>alu <b>{a.total_alu_kg_actual} kg</b></span>}
                  {a.wastage_pct_actual != null && <span>wastage <b>{a.wastage_pct_actual}%</b></span>}
                  <span>asli kharcha <b>{formatINR(cost)}</b></span>
                  <span>quote rate <b>{formatINR(estTotal)}</b></span>
                  {margin != null && <span className={margin < 10 ? "text-destructive" : "text-emerald-600"}>asli margin <b>{margin.toFixed(1)}%</b></span>}
                  {a.notes && <span className="text-muted-foreground">· {a.notes}</span>}
                </div>
              );
            })}
          </div>
        ) : <p className="text-xs text-muted-foreground">Abhi koi asli kharcha nahi likha.</p>}

        {/* Suggested defaults from rolling actuals */}
        {avgQ.data?.wastage_pct != null && (
          <div className="border-t pt-3 text-xs">
            <p className="text-muted-foreground mb-1">
              Sujhaav · pichhle {avgQ.data.count} job ka average wastage <b>{avgQ.data.wastage_pct.toFixed(2)}%</b>.
              <span className="italic"> Live bid me bharosa karne se pehle jaanch lein.</span>
            </p>
            {canManageRates && (
              <div className="flex items-center gap-2">
                <select className="h-8 rounded-md border border-input bg-background px-2" value={applySys} onChange={(e) => setApplySys(e.target.value)}>
                  <option value="">Kis system me lagayein…</option>
                  {(sysQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={applyAvgWastage} disabled={!applySys}>Wastage default set karein</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
