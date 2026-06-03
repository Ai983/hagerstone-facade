import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Save, Camera, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchSystem, fetchSystemMembers, fetchSystemMaterials, fetchMaterials, fetchSections,
  fetchActiveRateCard, updateSystemParams, replaceMembers, replaceSystemMaterials, saveSnapshot,
  type MemberDraft, type MaterialDraft,
} from "@/lib/facadeApi";
import { computeRate, resolveMember, resolveMaterial, formatINR } from "@/lib/rateEngine";
import { logAudit } from "@/lib/audit";

const numField = (v: number | null | undefined) => (v == null ? "" : String(v));
const toNum = (v: string) => (v === "" || v == null ? 0 : Number(v));

export default function SystemDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canManageRates, canViewMargin } = useAuth();

  const sysQ = useQuery({ queryKey: ["system", id], queryFn: () => fetchSystem(id), enabled: !!id });
  const memQ = useQuery({ queryKey: ["members", id], queryFn: () => fetchSystemMembers(id), enabled: !!id });
  const matQ = useQuery({ queryKey: ["sysmat", id], queryFn: () => fetchSystemMaterials(id), enabled: !!id });
  const catQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const secQ = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const rcQ = useQuery({ queryKey: ["activeRateCard"], queryFn: fetchActiveRateCard });

  // editable local state
  const [params, setParams] = useState<any>(null);
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [snapping, setSnapping] = useState(false);

  useEffect(() => { if (sysQ.data) setParams({ ...sysQ.data }); }, [sysQ.data]);
  useEffect(() => {
    if (memQ.data) setMembers(memQ.data.map((m) => ({
      section_id: m.section_id, member_name: m.member_name, cutlength_m: m.cutlength_m,
      number: m.number, qty: m.qty, unit_weight_kg_per_m: m.unit_weight_kg_per_m, sort_order: m.sort_order,
    })));
  }, [memQ.data]);
  useEffect(() => {
    if (matQ.data) setMaterials(matQ.data.map((m) => ({
      material_id: m.material_id, qty: m.qty, rate_override: m.rate_override,
      is_infill: m.is_infill, wastage_applies: m.wastage_applies, sort_order: m.sort_order,
    })));
  }, [matQ.data]);

  const sectionById = useMemo(
    () => Object.fromEntries((secQ.data ?? []).map((s) => [s.id, s])), [secQ.data]);
  const materialById = useMemo(
    () => Object.fromEntries((catQ.data ?? []).map((m) => [m.id, m])), [catQ.data]);

  // live breakdown
  const breakdown = useMemo(() => {
    if (!params || !rcQ.data) return null;
    const memberInputs = members.map((m) =>
      resolveMember(m as any, m.section_id ? sectionById[m.section_id]?.default_unit_weight_kg_per_m : null));
    const materialInputs = materials.map((m) =>
      resolveMaterial(m as any, m.material_id ? materialById[m.material_id]?.default_rate : null));
    return computeRate(
      {
        panel_area_sqm: toNum(params.panel_area_sqm),
        apply_powder_coating: !!params.apply_powder_coating,
        labour_per_sqm: toNum(params.labour_per_sqm),
        freight_per_sqm: toNum(params.freight_per_sqm),
        wastage_pct: toNum(params.wastage_pct),
        design_pct: toNum(params.design_pct),
        misc_pct: toNum(params.misc_pct),
        pmc_pct: toNum(params.pmc_pct),
        oh_profit_pct: toNum(params.oh_profit_pct),
      },
      memberInputs, materialInputs, rcQ.data
    );
  }, [params, members, materials, rcQ.data, sectionById, materialById]);

  if (sysQ.isLoading || !params) {
    return <Layout><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></Layout>;
  }

  const setP = (k: string, v: any) => setParams((p: any) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!canManageRates) return;
    setSaving(true);
    try {
      await updateSystemParams(id, {
        name: params.name, category: params.category,
        panel_width_mm: params.panel_width_mm === "" ? null : Number(params.panel_width_mm),
        panel_height_mm: params.panel_height_mm === "" ? null : Number(params.panel_height_mm),
        panel_area_sqm: toNum(params.panel_area_sqm),
        apply_powder_coating: !!params.apply_powder_coating,
        labour_per_sqm: toNum(params.labour_per_sqm), freight_per_sqm: toNum(params.freight_per_sqm),
        wastage_pct: toNum(params.wastage_pct), design_pct: toNum(params.design_pct),
        misc_pct: toNum(params.misc_pct), pmc_pct: toNum(params.pmc_pct),
        oh_profit_pct: toNum(params.oh_profit_pct),
      });
      await replaceMembers(id, members.map((m) => ({
        section_id: m.section_id ?? null, member_name: m.member_name || "Member",
        cutlength_m: toNum(m.cutlength_m as any), number: Math.round(toNum(m.number as any)),
        qty: toNum(m.qty as any),
        unit_weight_kg_per_m: m.unit_weight_kg_per_m == null || (m.unit_weight_kg_per_m as any) === "" ? null : Number(m.unit_weight_kg_per_m),
        sort_order: 0,
      })));
      await replaceSystemMaterials(id, materials.map((m) => ({
        material_id: m.material_id ?? null, qty: toNum(m.qty as any),
        rate_override: m.rate_override == null || (m.rate_override as any) === "" ? null : Number(m.rate_override),
        is_infill: !!m.is_infill, wastage_applies: !!m.wastage_applies, sort_order: 0,
      })));
      await logAudit("system", id, "update", user?.id ?? null, { code: params.code });
      await qc.invalidateQueries({ queryKey: ["members", id] });
      await qc.invalidateQueries({ queryKey: ["sysmat", id] });
      await qc.invalidateQueries({ queryKey: ["system", id] });
      toast.success("System saved");
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  const handleSnapshot = async () => {
    if (!breakdown || !rcQ.data) return;
    setSnapping(true);
    try {
      await saveSnapshot({
        system_id: id, rate_card_id: rcQ.data.id,
        rate_per_sqm: breakdown.rate_per_sqm, breakdown, computed_by: user?.id ?? null,
      });
      await logAudit("system_rate", id, "snapshot", user?.id ?? null,
        { rate_per_sqm: breakdown.rate_per_sqm, rate_card_id: rcQ.data.id });
      toast.success(`Snapshot saved · ${formatINR(breakdown.rate_per_sqm)}/sqm`);
    } catch (e: any) {
      toast.error(e.message ?? "Snapshot failed");
    } finally { setSnapping(false); }
  };

  const addMember = () => setMembers((a) => [...a, { section_id: null, member_name: "", cutlength_m: 0, number: 0, qty: 1, unit_weight_kg_per_m: null, sort_order: a.length }]);
  const addMaterial = () => setMaterials((a) => [...a, { material_id: catQ.data?.[0]?.id ?? null, qty: 0, rate_override: null, is_infill: catQ.data?.[0]?.is_infill ?? false, wastage_applies: catQ.data?.[0]?.is_infill ?? false, sort_order: a.length }]);

  const ro = !canManageRates; // read-only

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/calculator")}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">{params.code}</Badge>
                <h1 className="text-xl font-bold">{params.name}</h1>
              </div>
              <p className="text-xs text-muted-foreground">{ro ? "Read-only (rate editing is admin-only)" : "Editing · changes recalc live"}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {!ro && <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
            </Button>}
            <Button onClick={handleSnapshot} disabled={snapping || !breakdown}>
              {snapping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}Save snapshot
            </Button>
          </div>
        </div>

        {!rcQ.data && <p className="text-sm text-destructive">No active rate card — set one in Masters.</p>}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: editor */}
          <div className="lg:col-span-2 space-y-6">
            {/* Parameters */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Parameters</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ["panel_width_mm", "Width (mm)"], ["panel_height_mm", "Height (mm)"], ["panel_area_sqm", "Area (sqm)"],
                  ["labour_per_sqm", "Labour /sqm"], ["freight_per_sqm", "Freight /sqm"], ["wastage_pct", "Wastage %"],
                  ["design_pct", "Design %"], ["misc_pct", "Misc %"], ["pmc_pct", "PMC %"], ["oh_profit_pct", "OH & profit %"],
                ].map(([k, lbl]) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{lbl}</Label>
                    <Input type="number" step="any" disabled={ro} value={numField(params[k])}
                      onChange={(e) => setP(k, e.target.value)} />
                  </div>
                ))}
                <div className="space-y-1 flex flex-col justify-end">
                  <Label className="text-xs">Powder coating</Label>
                  <div className="h-9 flex items-center">
                    <Switch checked={!!params.apply_powder_coating} disabled={ro}
                      onCheckedChange={(v) => setP("apply_powder_coating", v)} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Members */}
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-sm">Aluminium members</CardTitle>
                {!ro && <Button size="sm" variant="outline" onClick={addMember}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1fr_70px_60px_50px_80px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
                  <span>Member</span><span>Cut (m)</span><span>No.</span><span>Qty</span><span>Unit wt</span><span />
                </div>
                {members.map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_60px_50px_80px_28px] gap-2 items-center">
                    <Input className="h-8" disabled={ro} value={m.member_name} placeholder="name"
                      onChange={(e) => setMembers((a) => a.map((x, j) => j === i ? { ...x, member_name: e.target.value } : x))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={numField(m.cutlength_m)}
                      onChange={(e) => setMembers((a) => a.map((x, j) => j === i ? { ...x, cutlength_m: e.target.value as any } : x))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={numField(m.number)}
                      onChange={(e) => setMembers((a) => a.map((x, j) => j === i ? { ...x, number: e.target.value as any } : x))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={numField(m.qty)}
                      onChange={(e) => setMembers((a) => a.map((x, j) => j === i ? { ...x, qty: e.target.value as any } : x))} />
                    <Input className="h-8" type="number" step="any" disabled={ro} value={numField(m.unit_weight_kg_per_m)}
                      onChange={(e) => setMembers((a) => a.map((x, j) => j === i ? { ...x, unit_weight_kg_per_m: e.target.value as any } : x))} />
                    {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setMembers((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                  </div>
                ))}
                {members.length === 0 && <p className="text-xs text-muted-foreground px-1">No members (e.g. frameless doors).</p>}
              </CardContent>
            </Card>

            {/* Materials */}
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-sm">Materials (consumables &amp; infill)</CardTitle>
                {!ro && <Button size="sm" variant="outline" onClick={addMaterial} disabled={!catQ.data?.length}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1fr_70px_80px_60px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
                  <span>Material</span><span>Qty</span><span>Rate ovr.</span><span>Infill</span><span />
                </div>
                {materials.map((m, i) => {
                  const cat = m.material_id ? materialById[m.material_id] : null;
                  return (
                    <div key={i} className="grid grid-cols-[1fr_70px_80px_60px_28px] gap-2 items-center">
                      <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" disabled={ro}
                        value={m.material_id ?? ""}
                        onChange={(e) => {
                          const mat = materialById[e.target.value];
                          setMaterials((a) => a.map((x, j) => j === i ? { ...x, material_id: e.target.value, is_infill: mat?.is_infill ?? x.is_infill, wastage_applies: mat?.is_infill ?? x.wastage_applies } : x));
                        }}>
                        {(catQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({formatINR(c.default_rate, 2)}/{c.unit})</option>)}
                      </select>
                      <Input className="h-8" type="number" step="any" disabled={ro} value={numField(m.qty)}
                        onChange={(e) => setMaterials((a) => a.map((x, j) => j === i ? { ...x, qty: e.target.value as any } : x))} />
                      <Input className="h-8" type="number" step="any" disabled={ro} placeholder={cat ? String(cat.default_rate) : ""}
                        value={numField(m.rate_override)}
                        onChange={(e) => setMaterials((a) => a.map((x, j) => j === i ? { ...x, rate_override: e.target.value as any } : x))} />
                      <div className="flex items-center h-8"><Switch checked={!!m.is_infill} disabled={ro}
                        onCheckedChange={(v) => setMaterials((a) => a.map((x, j) => j === i ? { ...x, is_infill: v, wastage_applies: v } : x))} /></div>
                      {!ro && <Button size="icon" variant="ghost" className="h-8 w-7" onClick={() => setMaterials((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Right: live build-up */}
          <div className="space-y-4">
            <Card className="sticky top-20">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Live cost build-up</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1.5">
                {breakdown && (
                  <>
                    <Row label={`Aluminium (${breakdown.total_alu_kg.toFixed(3)} kg)`} v={breakdown.aluminium_cost} />
                    <Row label="Conversion" v={breakdown.conversion_cost} />
                    <Row label="Powder coating" v={breakdown.coating_cost} />
                    <Row label="Consumables" v={breakdown.consumable_total} />
                    <Row label="Infill" v={breakdown.infill_total} />
                    <Row label={`Wastage (${params.wastage_pct}%)`} v={breakdown.wastage_cost} />
                    <Separator className="my-1" />
                    <Row label="Material total" v={breakdown.material_total} strong />
                    <Row label="Labour" v={breakdown.labour_cost} />
                    <Row label="Freight" v={breakdown.freight_cost} />
                    <Separator className="my-1" />
                    <Row label="Basic" v={breakdown.basic} strong />
                    {canViewMargin ? (
                      <>
                        <Row label={`Design (${params.design_pct}%)`} v={breakdown.design} />
                        <Row label={`Misc (${params.misc_pct}%)`} v={breakdown.misc} />
                        <Row label={`PMC (${params.pmc_pct}%)`} v={breakdown.pmc} />
                        <Row label={`OH & profit (${params.oh_profit_pct}%)`} v={breakdown.oh_profit} />
                        <Separator className="my-1" />
                        <Row label="Final amount" v={breakdown.final} strong />
                      </>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic pt-1">Margin build-up hidden for your role.</p>
                    )}
                    <div className="mt-3 rounded-lg bg-primary/10 p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate per sqm</p>
                      <p className="text-2xl font-bold text-primary">{formatINR(breakdown.rate_per_sqm)}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Row({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={strong ? "text-foreground" : ""}>{formatINR(v)}</span>
    </div>
  );
}
