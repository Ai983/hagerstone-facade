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
  upsertMaterial, upsertSection, createRateCard, updateRateCard,
  fetchCalcConfigRows, updateCalcConfig,
} from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";
import type { Material, Section, CalcConfigRow } from "@/types/facade";

export default function Masters() {
  const qc = useQueryClient();
  const { user, canManageRates } = useAuth();
  const ro = !canManageRates;

  const matQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const secQ = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const rcQ = useQuery({ queryKey: ["activeRateCard"], queryFn: fetchActiveRateCard });
  const rcAllQ = useQuery({ queryKey: ["rateCards"], queryFn: fetchRateCards });
  const cfgQ = useQuery({ queryKey: ["calcConfigRows"], queryFn: fetchCalcConfigRows });

  const [mats, setMats] = useState<Material[]>([]);
  const [secs, setSecs] = useState<Section[]>([]);
  const [cfg, setCfg] = useState<CalcConfigRow[]>([]);
  useEffect(() => { if (matQ.data) setMats(matQ.data); }, [matQ.data]);
  useEffect(() => { if (secQ.data) setSecs(secQ.data); }, [secQ.data]);
  useEffect(() => { if (cfgQ.data) setCfg(cfgQ.data); }, [cfgQ.data]);

  // v1.1/v1.2 active rate-card settings (validity / escalation / landed base / cut-opt bars)
  const [rcSettings, setRcSettings] = useState({
    valid_until: "", escalation_note: "", aluminium_basis: "landed", freight_handling_pct: "0",
    stock_bar_length_m: "6", kerf_mm: "4", bar_trim_mm: "15", min_usable_offcut_mm: "500", scrap_recovery_pct: "70",
  });
  useEffect(() => {
    if (rcQ.data) setRcSettings({
      valid_until: rcQ.data.valid_until ?? "",
      escalation_note: rcQ.data.escalation_note ?? "",
      aluminium_basis: rcQ.data.aluminium_basis ?? "landed",
      freight_handling_pct: String(rcQ.data.freight_handling_pct ?? 0),
      stock_bar_length_m: String(rcQ.data.stock_bar_length_m ?? 6),
      kerf_mm: String(rcQ.data.kerf_mm ?? 4),
      bar_trim_mm: String(rcQ.data.bar_trim_mm ?? 15),
      min_usable_offcut_mm: String(rcQ.data.min_usable_offcut_mm ?? 500),
      scrap_recovery_pct: String(rcQ.data.scrap_recovery_pct ?? 70),
    });
  }, [rcQ.data]);

  // new rate card form
  const [nc, setNc] = useState({ name: "", aluminium_per_kg: "", conversion_per_kg: "", powder_coating_per_kg: "" });
  const [busy, setBusy] = useState(false);

  const saveRcSettings = async () => {
    if (!rcQ.data) return;
    try {
      await updateRateCard(rcQ.data.id, {
        valid_until: rcSettings.valid_until || null,
        escalation_note: rcSettings.escalation_note || null,
        aluminium_basis: rcSettings.aluminium_basis,
        freight_handling_pct: Number(rcSettings.freight_handling_pct) || 0,
        stock_bar_length_m: Number(rcSettings.stock_bar_length_m) || 6,
        kerf_mm: Number(rcSettings.kerf_mm) || 0,
        bar_trim_mm: Number(rcSettings.bar_trim_mm) || 0,
        min_usable_offcut_mm: Number(rcSettings.min_usable_offcut_mm) || 0,
        scrap_recovery_pct: Number(rcSettings.scrap_recovery_pct) || 0,
      });
      await logAudit("rate_card", rcQ.data.id, "update_settings", user?.id ?? null, rcSettings);
      toast.success("Rate card settings saved");
      qc.invalidateQueries({ queryKey: ["activeRateCard"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const saveCfg = async (row: CalcConfigRow) => {
    try {
      await updateCalcConfig(row.key, Number(row.num_value), user?.id ?? null);
      await logAudit("calc_config", row.id, "update", user?.id ?? null, { key: row.key, value: row.num_value });
      toast.success(`Saved ${row.key}`);
      qc.invalidateQueries({ queryKey: ["calcConfigRows"] });
      qc.invalidateQueries({ queryKey: ["calcConfig"] });
    } catch (e: any) { toast.error(e.message); }
  };

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

            {/* v1.1 settings on the active card */}
            {rcQ.data && !ro && (
              <div className="border-t pt-4">
                <p className="text-xs font-medium mb-2">Price validity &amp; landed-cost base (v1.1 — defaults preserve the baseline)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="space-y-1"><Label className="text-xs">Valid until</Label>
                    <Input className="h-8" type="date" value={rcSettings.valid_until} onChange={(e) => setRcSettings({ ...rcSettings, valid_until: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Aluminium basis</Label>
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={rcSettings.aluminium_basis} onChange={(e) => setRcSettings({ ...rcSettings, aluminium_basis: e.target.value })}>
                      <option value="landed">landed (rate as-is)</option>
                      <option value="stockist">stockist (+ uplift)</option>
                    </select></div>
                  <div className="space-y-1"><Label className="text-xs">Freight/handling % {rcSettings.aluminium_basis === "landed" && "(ignored)"}</Label>
                    <Input className="h-8" type="number" step="any" value={rcSettings.freight_handling_pct} onChange={(e) => setRcSettings({ ...rcSettings, freight_handling_pct: e.target.value })} /></div>
                  <Button className="h-8" onClick={saveRcSettings}><Save className="h-3.5 w-3.5 mr-1" />Save settings</Button>
                </div>
                <div className="space-y-1 mt-2"><Label className="text-xs">Escalation note (copied onto quotations)</Label>
                  <Input className="h-8" value={rcSettings.escalation_note} placeholder="Prices firm until valid-until date; thereafter subject to aluminium (LME) movement." onChange={(e) => setRcSettings({ ...rcSettings, escalation_note: e.target.value })} /></div>
                <p className="text-[10px] text-muted-foreground mt-1">Basis "landed" + 0% uplift = no change to the verified rates. Switch to "stockist" only with a real freight/handling %.</p>

                <p className="text-xs font-medium mt-3 mb-1">Cut-optimization bar parameters (used only by systems with cut-optimization ON)</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <div className="space-y-1"><Label className="text-xs">Stock bar (m)</Label><Input className="h-8" type="number" step="any" value={rcSettings.stock_bar_length_m} onChange={(e) => setRcSettings({ ...rcSettings, stock_bar_length_m: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Kerf (mm)</Label><Input className="h-8" type="number" step="any" value={rcSettings.kerf_mm} onChange={(e) => setRcSettings({ ...rcSettings, kerf_mm: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Bar trim (mm)</Label><Input className="h-8" type="number" step="any" value={rcSettings.bar_trim_mm} onChange={(e) => setRcSettings({ ...rcSettings, bar_trim_mm: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Min offcut (mm)</Label><Input className="h-8" type="number" step="any" value={rcSettings.min_usable_offcut_mm} onChange={(e) => setRcSettings({ ...rcSettings, min_usable_offcut_mm: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Scrap recovery %</Label><Input className="h-8" type="number" step="any" value={rcSettings.scrap_recovery_pct} onChange={(e) => setRcSettings({ ...rcSettings, scrap_recovery_pct: e.target.value })} /></div>
                </div>
              </div>
            )}

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

        {/* Calculator thresholds (v1.1 guardrails) */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Calculator thresholds</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-muted-foreground">Editable warning thresholds — rules of thumb from research, calibrate against real jobs.</p>
            {cfg.map((row, i) => (
              <div key={row.id} className="grid grid-cols-[180px_100px_1fr_32px] gap-2 items-center">
                <span className="text-xs font-mono">{row.key}</span>
                <Input className="h-8" type="number" step="any" disabled={ro} value={row.num_value == null ? "" : String(row.num_value)}
                  onChange={(e) => setCfg((a) => a.map((x, j) => j === i ? { ...x, num_value: e.target.value as any } : x))} />
                <span className="text-[11px] text-muted-foreground">{row.description}</span>
                {!ro && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveCfg(cfg[i])}><Save className="h-3.5 w-3.5" /></Button>}
              </div>
            ))}
            {cfg.length === 0 && <p className="text-xs text-muted-foreground">No config rows (run the v1.1 migration).</p>}
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
