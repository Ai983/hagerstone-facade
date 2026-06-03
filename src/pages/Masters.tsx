import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Save, Plus, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchMaterials, fetchSections, fetchActiveRateCard, fetchRateCards,
  upsertMaterial, upsertSection, createRateCard,
} from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";
import type { Material, Section } from "@/types/facade";

export default function Masters() {
  const qc = useQueryClient();
  const { user, canManageRates } = useAuth();
  const ro = !canManageRates;

  const matQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const secQ = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const rcQ = useQuery({ queryKey: ["activeRateCard"], queryFn: fetchActiveRateCard });
  const rcAllQ = useQuery({ queryKey: ["rateCards"], queryFn: fetchRateCards });

  const [mats, setMats] = useState<Material[]>([]);
  const [secs, setSecs] = useState<Section[]>([]);
  useEffect(() => { if (matQ.data) setMats(matQ.data); }, [matQ.data]);
  useEffect(() => { if (secQ.data) setSecs(secQ.data); }, [secQ.data]);

  // new rate card form
  const [nc, setNc] = useState({ name: "", aluminium_per_kg: "", conversion_per_kg: "", powder_coating_per_kg: "" });
  const [busy, setBusy] = useState(false);

  const saveMaterial = async (m: Material) => {
    try {
      await upsertMaterial({ id: m.id, name: m.name, category: m.category, unit: m.unit, default_rate: Number(m.default_rate), is_infill: m.is_infill, is_active: m.is_active });
      await logAudit("material", m.id, "update", user?.id ?? null, { name: m.name });
      toast.success(`Saved ${m.name}`);
      qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (e: any) { toast.error(e.message); }
  };
  const saveSection = async (s: Section) => {
    try {
      await upsertSection({ id: s.id, section_no: s.section_no, name: s.name, default_unit_weight_kg_per_m: s.default_unit_weight_kg_per_m == null ? null : Number(s.default_unit_weight_kg_per_m) });
      toast.success(`Saved ${s.section_no}`);
      qc.invalidateQueries({ queryKey: ["sections"] });
    } catch (e: any) { toast.error(e.message); }
  };
  const submitRateCard = async () => {
    if (!nc.name || !nc.aluminium_per_kg) { toast.error("Name + aluminium rate required"); return; }
    setBusy(true);
    try {
      const rc = await createRateCard({
        name: nc.name, aluminium_per_kg: Number(nc.aluminium_per_kg),
        conversion_per_kg: Number(nc.conversion_per_kg || 0), powder_coating_per_kg: Number(nc.powder_coating_per_kg || 0),
        created_by: user?.id ?? null,
      });
      await logAudit("rate_card", rc.id, "create", user?.id ?? null, { name: rc.name });
      toast.success("New active rate card created");
      setNc({ name: "", aluminium_per_kg: "", conversion_per_kg: "", powder_coating_per_kg: "" });
      qc.invalidateQueries({ queryKey: ["activeRateCard"] });
      qc.invalidateQueries({ queryKey: ["rateCards"] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Masters</h1>
          <p className="text-muted-foreground text-sm mt-1">Rate card, materials and aluminium sections. {ro && "Editing is admin-only."}</p>
        </div>

        {/* Rate card */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Active rate card</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {rcQ.data ? (
              <div className="flex flex-wrap gap-6 text-sm">
                <div><span className="text-muted-foreground">Name </span><b>{rcQ.data.name}</b></div>
                <div><span className="text-muted-foreground">Aluminium </span><b>₹{rcQ.data.aluminium_per_kg}/kg</b></div>
                <div><span className="text-muted-foreground">Conversion </span><b>₹{rcQ.data.conversion_per_kg}/kg</b></div>
                <div><span className="text-muted-foreground">Powder coating </span><b>₹{rcQ.data.powder_coating_per_kg}/kg</b></div>
                <div><span className="text-muted-foreground">From </span><b>{rcQ.data.effective_from}</b></div>
              </div>
            ) : <p className="text-sm text-destructive">No active rate card.</p>}

            {!ro && (
              <div className="border-t pt-4">
                <p className="text-xs font-medium mb-2 flex items-center gap-1"><Plus className="h-3.5 w-3.5" />New rate card (activates it, deactivates the old)</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <div className="space-y-1"><Label className="text-xs">Name</Label><Input className="h-8" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Alu /kg</Label><Input className="h-8" type="number" value={nc.aluminium_per_kg} onChange={(e) => setNc({ ...nc, aluminium_per_kg: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Conv /kg</Label><Input className="h-8" type="number" value={nc.conversion_per_kg} onChange={(e) => setNc({ ...nc, conversion_per_kg: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Coat /kg</Label><Input className="h-8" type="number" value={nc.powder_coating_per_kg} onChange={(e) => setNc({ ...nc, powder_coating_per_kg: e.target.value })} /></div>
                  <Button className="h-8" onClick={submitRateCard} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}</Button>
                </div>
                {rcAllQ.data && rcAllQ.data.length > 1 && (
                  <p className="text-[11px] text-muted-foreground mt-2">{rcAllQ.data.length} rate cards on record.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Materials */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Materials ({mats.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-[1fr_90px_70px_90px_60px_32px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
              <span>Name</span><span>Category</span><span>Unit</span><span>Default rate</span><span>Infill</span><span /></div>
            {mats.map((m, i) => (
              <div key={m.id} className="grid grid-cols-[1fr_90px_70px_90px_60px_32px] gap-2 items-center">
                <Input className="h-8" disabled={ro} value={m.name} onChange={(e) => setMats((a) => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <Input className="h-8" disabled={ro} value={m.category} onChange={(e) => setMats((a) => a.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} />
                <Input className="h-8" disabled={ro} value={m.unit} onChange={(e) => setMats((a) => a.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                <Input className="h-8" type="number" step="any" disabled={ro} value={String(m.default_rate)} onChange={(e) => setMats((a) => a.map((x, j) => j === i ? { ...x, default_rate: e.target.value as any } : x))} />
                <div className="flex items-center h-8"><Switch disabled={ro} checked={m.is_infill} onCheckedChange={(v) => setMats((a) => a.map((x, j) => j === i ? { ...x, is_infill: v } : x))} /></div>
                {!ro && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveMaterial(mats[i])}><Save className="h-3.5 w-3.5" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Sections */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Aluminium sections ({secs.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-[90px_1fr_110px_32px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
              <span>Section no.</span><span>Name</span><span>Unit wt (kg/m)</span><span /></div>
            {secs.map((s, i) => (
              <div key={s.id} className="grid grid-cols-[90px_1fr_110px_32px] gap-2 items-center">
                <Input className="h-8 font-mono" disabled={ro} value={s.section_no} onChange={(e) => setSecs((a) => a.map((x, j) => j === i ? { ...x, section_no: e.target.value } : x))} />
                <Input className="h-8" disabled={ro} value={s.name} onChange={(e) => setSecs((a) => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <Input className="h-8" type="number" step="any" disabled={ro} value={s.default_unit_weight_kg_per_m == null ? "" : String(s.default_unit_weight_kg_per_m)} onChange={(e) => setSecs((a) => a.map((x, j) => j === i ? { ...x, default_unit_weight_kg_per_m: e.target.value as any } : x))} />
                {!ro && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveSection(secs[i])}><Save className="h-3.5 w-3.5" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
