import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Boxes, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchAssemblies, fetchAssembly, fetchAssemblyMembers, fetchAssemblyMaterials,
  createAssembly, updateAssembly, replaceAssemblyMembers, replaceAssemblyMaterials,
  fetchMaterials, fetchSections, fetchActiveRateCard,
} from "@/lib/facadeApi";
import { computeAssemblyRate, formatINR } from "@/lib/rateEngine";
import { logAudit } from "@/lib/audit";

const n = (v: any) => (v === "" || v == null ? "" : String(v));
const num = (v: any) => (v === "" || v == null ? 0 : Number(v));

export default function Assemblies() {
  const qc = useQueryClient();
  const { user, canManageRates } = useAuth();
  const ro = !canManageRates;

  const listQ = useQuery({ queryKey: ["assemblies"], queryFn: fetchAssemblies });
  const matQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const secQ = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const rcQ = useQuery({ queryKey: ["activeRateCard"], queryFn: fetchActiveRateCard });

  const [sel, setSel] = useState<string | null>(null);
  const [a, setA] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [preview, setPreview] = useState({ w: "", h: "", count: "1" });
  const [busy, setBusy] = useState(false);

  const detQ = useQuery({ queryKey: ["assembly", sel], queryFn: () => fetchAssembly(sel!), enabled: !!sel });
  const memQ = useQuery({ queryKey: ["asmMembers", sel], queryFn: () => fetchAssemblyMembers(sel!), enabled: !!sel });
  const amatQ = useQuery({ queryKey: ["asmMaterials", sel], queryFn: () => fetchAssemblyMaterials(sel!), enabled: !!sel });

  useEffect(() => { if (detQ.data) { setA({ ...detQ.data }); setPreview((p) => ({ ...p, w: String(detQ.data.base_width_mm), h: String(detQ.data.base_height_mm) })); } }, [detQ.data]);
  useEffect(() => { if (memQ.data) setMembers(memQ.data.map((m) => ({ ...m }))); }, [memQ.data]);
  useEffect(() => { if (amatQ.data) setMaterials(amatQ.data.map((m) => ({ ...m }))); }, [amatQ.data]);

  const matById = useMemo(() => Object.fromEntries((matQ.data ?? []).map((m) => [m.id, m])), [matQ.data]);
  const secById = useMemo(() => Object.fromEntries((secQ.data ?? []).map((s) => [s.id, s])), [secQ.data]);

  const preview_bd = useMemo(() => {
    if (!a || !rcQ.data) return null;
    const W = num(preview.w), H = num(preview.h), N = Math.max(1, Math.round(num(preview.count)));
    if (W <= 0 || H <= 0) return null;
    return computeAssemblyRate(
      { apply_powder_coating: !!a.apply_powder_coating, labour_per_sqm: num(a.labour_per_sqm), freight_per_sqm: num(a.freight_per_sqm), wastage_pct: num(a.wastage_pct), design_pct: num(a.design_pct), misc_pct: num(a.misc_pct), pmc_pct: num(a.pmc_pct), oh_profit_pct: num(a.oh_profit_pct) },
      members.map((m) => ({ orientation: m.orientation, base_cutlength_m: num(m.base_cutlength_m), number: Math.round(num(m.number)), qty: num(m.qty), unit_weight_kg_per_m: m.unit_weight_kg_per_m != null && m.unit_weight_kg_per_m !== "" ? num(m.unit_weight_kg_per_m) : num(m.section_id ? secById[m.section_id]?.default_unit_weight_kg_per_m : 0), section_key: m.section_id ?? m.member_name, member_name: m.member_name })),
      materials.map((m) => ({ qty_per_unit: num(m.qty_per_unit), rate: m.material_id ? num(matById[m.material_id]?.default_rate) : 0, is_infill: !!m.is_infill })),
      rcQ.data, W, H, N
    );
  }, [a, members, materials, preview, rcQ.data, matById, secById]);

  const newAssembly = async () => {
    setBusy(true);
    try {
      const code = "ASM-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      const created = await createAssembly({ code, name: "New assembly", base_width_mm: 1000, base_height_mm: 1000, category: "bay" });
      await logAudit("assembly", created.id, "create", user?.id ?? null, { code });
      qc.invalidateQueries({ queryKey: ["assemblies"] });
      setSel(created.id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!sel || !a) return;
    setBusy(true);
    try {
      await updateAssembly(sel, {
        code: a.code, name: a.name, category: a.category, base_width_mm: num(a.base_width_mm), base_height_mm: num(a.base_height_mm),
        apply_powder_coating: !!a.apply_powder_coating, labour_per_sqm: num(a.labour_per_sqm), freight_per_sqm: num(a.freight_per_sqm),
        wastage_pct: num(a.wastage_pct), design_pct: num(a.design_pct), misc_pct: num(a.misc_pct), pmc_pct: num(a.pmc_pct), oh_profit_pct: num(a.oh_profit_pct),
      });
      await replaceAssemblyMembers(sel, members.map((m) => ({ section_id: m.section_id ?? null, member_name: m.member_name || "Member", orientation: m.orientation || "fixed", base_cutlength_m: num(m.base_cutlength_m), number: Math.round(num(m.number)), qty: num(m.qty), unit_weight_kg_per_m: m.unit_weight_kg_per_m === "" || m.unit_weight_kg_per_m == null ? null : num(m.unit_weight_kg_per_m), sort_order: 0 })));
      await replaceAssemblyMaterials(sel, materials.map((m) => ({ material_id: m.material_id ?? null, qty_per_unit: num(m.qty_per_unit), is_infill: !!m.is_infill, wastage_applies: !!m.is_infill, sort_order: 0 })));
      await logAudit("assembly", sel, "update", user?.id ?? null, { code: a.code });
      toast.success("Set save ho gaya");
      qc.invalidateQueries({ queryKey: ["assemblies"] }); qc.invalidateQueries({ queryKey: ["asmMembers", sel] }); qc.invalidateQueries({ queryKey: ["asmMaterials", sel] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="h-6 w-6 text-primary" /> Ready Sets (Assemblies)</h1>
            <p className="text-muted-foreground text-sm mt-1">Baar-baar use hone wale set (ek bay = mullion + transom + glass). Estimate me daalein aur W×H×count se badhayein. Ye anumaan hai — asli lambai drawing se aati hai.</p>
          </div>
          {canManageRates && <Button onClick={newAssembly} disabled={busy}><Plus className="h-4 w-4 mr-2" />Naya Set</Button>}
        </div>

        <div className="grid lg:grid-cols-[220px_1fr] gap-6">
          <div className="space-y-1">
            {listQ.data?.map((x) => (
              <button key={x.id} onClick={() => setSel(x.id)} className={`w-full text-left px-3 py-2 rounded-md border text-sm ${sel === x.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}>
                <Badge variant="secondary" className="font-mono text-[10px] mr-1">{x.code}</Badge>{x.name}
              </button>
            ))}
            {listQ.data && listQ.data.length === 0 && <p className="text-xs text-muted-foreground">Abhi koi set nahi.</p>}
          </div>

          {a ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Set ki settings</CardTitle>
                  {!ro && <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save karein</Button>}
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1 col-span-2"><Label className="text-xs">Name</Label><Input className="h-8" disabled={ro} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Code</Label><Input className="h-8 font-mono" disabled={ro} value={a.code} onChange={(e) => setA({ ...a, code: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Category</Label><Input className="h-8" disabled={ro} value={a.category ?? ""} onChange={(e) => setA({ ...a, category: e.target.value })} /></div>
                  {[["base_width_mm", "Base W (mm)"], ["base_height_mm", "Base H (mm)"], ["labour_per_sqm", "Labour/sqm"], ["freight_per_sqm", "Freight/sqm"], ["wastage_pct", "Wastage %"], ["design_pct", "Design %"], ["misc_pct", "Misc %"], ["pmc_pct", "PMC %"], ["oh_profit_pct", "OH&P %"]].map(([k, lbl]) => (
                    <div key={k} className="space-y-1"><Label className="text-xs">{lbl}</Label><Input className="h-8" type="number" step="any" disabled={ro} value={n(a[k])} onChange={(e) => setA({ ...a, [k]: e.target.value })} /></div>
                  ))}
                  <div className="space-y-1 flex flex-col justify-end"><Label className="text-xs">Powder coating</Label><div className="h-8 flex items-center"><Switch checked={!!a.apply_powder_coating} disabled={ro} onCheckedChange={(v) => setA({ ...a, apply_powder_coating: v })} /></div></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Members (patti)</CardTitle>
                  {!ro && <Button size="sm" variant="outline" onClick={() => setMembers((x) => [...x, { member_name: "", orientation: "horizontal", base_cutlength_m: 0, number: 1, qty: 1, unit_weight_kg_per_m: "", section_id: null }])}><Plus className="h-3.5 w-3.5 mr-1" />Jodein</Button>}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-[1fr_90px_70px_50px_50px_70px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1"><span>Member</span><span>Orient.</span><span>Fixed m</span><span>No.</span><span>Qty</span><span>Unit wt</span><span /></div>
                  {members.map((m, i) => (
                    <div key={i} className="grid grid-cols-[1fr_90px_70px_50px_50px_70px_28px] gap-2 items-center">
                      <Input className="h-8" disabled={ro} value={m.member_name} placeholder="name" onChange={(e) => setMembers((x) => x.map((y, j) => j === i ? { ...y, member_name: e.target.value } : y))} />
                      <select className="h-8 rounded-md border border-input bg-background px-1 text-xs" disabled={ro} value={m.orientation} onChange={(e) => setMembers((x) => x.map((y, j) => j === i ? { ...y, orientation: e.target.value } : y))}>
                        <option value="horizontal">horiz (W)</option><option value="vertical">vert (H)</option><option value="fixed">fixed</option>
                      </select>
                      <Input className="h-8" type="number" step="any" disabled={ro || m.orientation !== "fixed"} value={n(m.base_cutlength_m)} onChange={(e) => setMembers((x) => x.map((y, j) => j === i ? { ...y, base_cutlength_m: e.target.value } : y))} />
                      <Input className="h-8" type="number" step="any" disabled={ro} value={n(m.number)} onChange={(e) => setMembers((x) => x.map((y, j) => j === i ? { ...y, number: e.target.value } : y))} />
                      <Input className="h-8" type="number" step="any" disabled={ro} value={n(m.qty)} onChange={(e) => setMembers((x) => x.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} />
                      <Input className="h-8" type="number" step="any" disabled={ro} value={n(m.unit_weight_kg_per_m)} onChange={(e) => setMembers((x) => x.map((y, j) => j === i ? { ...y, unit_weight_kg_per_m: e.target.value } : y))} />
                      {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setMembers((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Materials</CardTitle>
                  {!ro && <Button size="sm" variant="outline" onClick={() => setMaterials((x) => [...x, { material_id: matQ.data?.[0]?.id ?? null, qty_per_unit: 0, is_infill: matQ.data?.[0]?.is_infill ?? false }])} disabled={!matQ.data?.length}><Plus className="h-3.5 w-3.5 mr-1" />Jodein</Button>}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-[1fr_90px_70px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1"><span>Material</span><span>Qty/set</span><span>Glass?</span><span /></div>
                  {materials.map((m, i) => (
                    <div key={i} className="grid grid-cols-[1fr_90px_70px_28px] gap-2 items-center">
                      <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" disabled={ro} value={m.material_id ?? ""} onChange={(e) => { const mat = matById[e.target.value]; setMaterials((x) => x.map((y, j) => j === i ? { ...y, material_id: e.target.value, is_infill: mat?.is_infill ?? y.is_infill } : y)); }}>
                        {(matQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <Input className="h-8" type="number" step="any" disabled={ro || m.is_infill} placeholder={m.is_infill ? "= area" : ""} value={m.is_infill ? "" : n(m.qty_per_unit)} onChange={(e) => setMaterials((x) => x.map((y, j) => j === i ? { ...y, qty_per_unit: e.target.value } : y))} />
                      <div className="flex items-center h-8"><Switch checked={!!m.is_infill} disabled={ro} onCheckedChange={(v) => setMaterials((x) => x.map((y, j) => j === i ? { ...y, is_infill: v } : y))} /></div>
                      {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setMaterials((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Size daal kar dekho (preview)</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1"><Label className="text-xs">W (mm)</Label><Input className="h-8 w-24" type="number" value={preview.w} onChange={(e) => setPreview({ ...preview, w: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">H (mm)</Label><Input className="h-8 w-24" type="number" value={preview.h} onChange={(e) => setPreview({ ...preview, h: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Count</Label><Input className="h-8 w-20" type="number" value={preview.count} onChange={(e) => setPreview({ ...preview, count: e.target.value })} /></div>
                  {preview_bd && (
                    <div className="ml-auto text-right">
                      <p className="text-[10px] uppercase text-muted-foreground">Rate /sqm · area {preview_bd.area.toFixed(2)} sqm</p>
                      <p className="text-xl font-bold text-primary">{formatINR(preview_bd.rate_per_sqm)} · {formatINR(preview_bd.final)}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : <p className="text-sm text-muted-foreground">Koi set chunein ya naya banayein.</p>}
        </div>
      </div>
    </Layout>
  );
}
