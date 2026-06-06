import { supabase, hub } from "@/integrations/supabase/client";
import type {
  FacadeSystem, SystemMember, SystemMaterial, Material, Section, RateCard, SystemRate, RateBreakdown,
  Project, Estimate, EstimateLine, Quotation, QuotationLine, ProjectStage, EmployeeLite,
  ProcurementRequest, Payment, BomLine, CalcConfigRow,
  Tender, Budget, BudgetHead, BudgetPmLine, BudgetMaterialLine, BudgetTemplateHead,
  MaterialReceivingNote, MrnLineItem, ProcurementLine,
} from "@/types/facade";
import { DEFAULT_CALC_CONFIG, type CalcConfig } from "@/lib/guardrails";
import { computeRate, resolveMember, resolveMaterial, computeAssemblyRate, type CutOptInput } from "@/lib/rateEngine";
import type { Assembly, AssemblyMember, AssemblyMaterial } from "@/types/facade";

/** Build the cut-optimization input for a system, or undefined when its toggle is OFF (baseline). */
export function cutOptFor(system: FacadeSystem, rc: RateCard | null): CutOptInput | undefined {
  if (!system.use_cut_optimization || !rc) return undefined;
  return {
    enabled: true,
    applyScrapCredit: !!system.apply_scrap_credit,
    bar: {
      stock_bar_length_m: Number(rc.stock_bar_length_m) || 6,
      kerf_mm: Number(rc.kerf_mm) || 0,
      bar_trim_mm: Number(rc.bar_trim_mm) || 0,
      min_usable_offcut_mm: Number(rc.min_usable_offcut_mm) || 0,
    },
    scrap_recovery_pct: Number(rc.scrap_recovery_pct) || 0,
  };
}

// ---------------- Reads ----------------

export async function fetchSystems(): Promise<FacadeSystem[]> {
  const { data, error } = await supabase.from("systems").select("*").order("code");
  if (error) throw error;
  return data as FacadeSystem[];
}

export async function fetchSystem(id: string): Promise<FacadeSystem> {
  const { data, error } = await supabase.from("systems").select("*").eq("id", id).single();
  if (error) throw error;
  return data as FacadeSystem;
}

export async function fetchSystemMembers(systemId: string): Promise<SystemMember[]> {
  const { data, error } = await supabase
    .from("system_members").select("*").eq("system_id", systemId).order("sort_order");
  if (error) throw error;
  return data as SystemMember[];
}

export async function fetchSystemMaterials(systemId: string): Promise<SystemMaterial[]> {
  const { data, error } = await supabase
    .from("system_materials").select("*").eq("system_id", systemId).order("sort_order");
  if (error) throw error;
  return data as SystemMaterial[];
}

export async function fetchMaterials(): Promise<Material[]> {
  const { data, error } = await supabase.from("materials").select("*").order("category").order("name");
  if (error) throw error;
  return data as Material[];
}

export async function fetchSections(): Promise<Section[]> {
  const { data, error } = await supabase.from("sections").select("*").order("section_no");
  if (error) throw error;
  return data as Section[];
}

export async function fetchActiveRateCard(): Promise<RateCard | null> {
  const { data, error } = await supabase
    .from("rate_cards").select("*").eq("is_active", true)
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as RateCard | null;
}

export async function fetchRateCards(): Promise<RateCard[]> {
  const { data, error } = await supabase.from("rate_cards").select("*").order("effective_from", { ascending: false });
  if (error) throw error;
  return data as RateCard[];
}

export async function fetchLatestSnapshot(systemId: string): Promise<SystemRate | null> {
  const { data, error } = await supabase
    .from("system_rates").select("*").eq("system_id", systemId)
    .order("computed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as SystemRate | null;
}

// ---------------- Writes ----------------

export type SystemParamPatch = Partial<
  Pick<FacadeSystem,
    "name" | "category" | "description" | "panel_width_mm" | "panel_height_mm" | "panel_area_sqm" |
    "apply_powder_coating" | "labour_per_sqm" | "freight_per_sqm" | "wastage_pct" | "design_pct" |
    "misc_pct" | "pmc_pct" | "oh_profit_pct" | "is_active" |
    "use_cut_optimization" | "apply_scrap_credit" | "use_sheet_optimization">
>;

export async function updateSystemParams(id: string, patch: SystemParamPatch): Promise<void> {
  const { error } = await supabase.from("systems").update(patch).eq("id", id);
  if (error) throw error;
}

export type MemberDraft = Omit<SystemMember, "id" | "system_id">;
export type MaterialDraft = Omit<SystemMaterial, "id" | "system_id" | "is_sealant" | "perimeter_m" | "structural_bite_mm" | "glueline_mm" | "tube_volume_ml">
  & Partial<Pick<SystemMaterial, "is_sealant" | "perimeter_m" | "structural_bite_mm" | "glueline_mm" | "tube_volume_ml">>;

/** Replace all members for a system (delete + reinsert). */
export async function replaceMembers(systemId: string, members: MemberDraft[]): Promise<void> {
  const del = await supabase.from("system_members").delete().eq("system_id", systemId);
  if (del.error) throw del.error;
  if (members.length) {
    const rows = members.map((m, i) => ({ ...m, system_id: systemId, sort_order: i }));
    const ins = await supabase.from("system_members").insert(rows);
    if (ins.error) throw ins.error;
  }
}

/** Replace all material lines for a system (delete + reinsert). */
export async function replaceSystemMaterials(systemId: string, materials: MaterialDraft[]): Promise<void> {
  const del = await supabase.from("system_materials").delete().eq("system_id", systemId);
  if (del.error) throw del.error;
  if (materials.length) {
    const rows = materials.map((m, i) => ({ ...m, system_id: systemId, sort_order: i }));
    const ins = await supabase.from("system_materials").insert(rows);
    if (ins.error) throw ins.error;
  }
}

export async function saveSnapshot(params: {
  system_id: string;
  rate_card_id: string | null;
  rate_per_sqm: number;
  breakdown: RateBreakdown;
  computed_by: string | null;
}): Promise<SystemRate> {
  const { data, error } = await supabase.from("system_rates").insert({
    system_id: params.system_id,
    rate_card_id: params.rate_card_id,
    rate_per_sqm: params.rate_per_sqm,
    breakdown: params.breakdown,
    computed_by: params.computed_by,
    // v1.2 transparency columns
    optimized_wastage_pct: params.breakdown.optimized_wastage_pct ?? null,
    offcut_kg: params.breakdown.offcut_kg ?? null,
    scrap_credit_amount: params.breakdown.scrap_credit_amount ?? null,
  }).select().single();
  if (error) throw error;
  return data as SystemRate;
}

// ---- Masters CRUD ----

export async function upsertMaterial(m: Partial<Material>): Promise<Material> {
  const { data, error } = await supabase.from("materials").upsert(m).select().single();
  if (error) throw error;
  return data as Material;
}

export async function upsertSection(s: Partial<Section>): Promise<Section> {
  const { data, error } = await supabase.from("sections").upsert(s).select().single();
  if (error) throw error;
  return data as Section;
}

export async function createRateCard(rc: {
  name: string; aluminium_per_kg: number; conversion_per_kg: number;
  powder_coating_per_kg: number; created_by: string | null;
  valid_until?: string | null; escalation_note?: string | null;
  aluminium_basis?: string; freight_handling_pct?: number;
}): Promise<RateCard> {
  // deactivate existing actives, then insert the new active card
  const upd = await supabase.from("rate_cards").update({ is_active: false }).eq("is_active", true);
  if (upd.error) throw upd.error;
  const { data, error } = await supabase.from("rate_cards")
    .insert({ ...rc, is_active: true }).select().single();
  if (error) throw error;
  return data as RateCard;
}

export async function updateRateCard(
  id: string,
  patch: Partial<Pick<RateCard,
    "valid_until" | "escalation_note" | "aluminium_basis" | "freight_handling_pct" |
    "stock_bar_length_m" | "kerf_mm" | "bar_trim_mm" | "min_usable_offcut_mm" | "scrap_recovery_pct" |
    "import_duty_pct" | "price_source" | "aluminium_per_kg">>
): Promise<void> {
  const { error } = await supabase.from("rate_cards").update(patch).eq("id", id);
  if (error) throw error;
}

// ---------------- Price feed (A3, semi-live) ----------------

export async function fetchPriceFeedLog(): Promise<import("@/types/facade").PriceFeedLog[]> {
  const { data, error } = await supabase.from("price_feed_log").select("*")
    .order("fetched_at", { ascending: false }).limit(20);
  if (error) return [];
  return (data as import("@/types/facade").PriceFeedLog[]) ?? [];
}

export async function addPriceObservation(o: {
  metal: string; index_name: string; value_per_kg_inr: number; source_note: string | null;
}): Promise<void> {
  const { error } = await supabase.from("price_feed_log").insert(o);
  if (error) throw error;
}

// ---------------- Calculator config (v1.1) ----------------

export async function fetchCalcConfigRows(): Promise<CalcConfigRow[]> {
  const { data, error } = await supabase.from("calc_config").select("*").order("key");
  if (error) return [];
  return (data as CalcConfigRow[]) ?? [];
}

/** Typed config map with shipped defaults as fallback (so guardrails work pre-migration). */
export async function fetchCalcConfig(): Promise<CalcConfig> {
  const rows = await fetchCalcConfigRows();
  const map = { ...DEFAULT_CALC_CONFIG };
  for (const r of rows) {
    if (r.key in map && r.num_value != null) (map as any)[r.key] = Number(r.num_value);
  }
  return map;
}

export async function updateCalcConfig(key: string, num_value: number, updated_by: string | null): Promise<void> {
  const { error } = await supabase.from("calc_config")
    .update({ num_value, updated_by, updated_at: new Date().toISOString() }).eq("key", key);
  if (error) throw error;
}

// ---------------- Reference IDs ----------------

/** Generate the next reference id via facade.next_ref(prefix). e.g. nextRef('PRJ') -> FAC-PRJ-2026-0001 */
export async function nextRef(prefix: "PRJ" | "EST" | "QT" | "PR" | "PAY" | "TND" | "BUD" | "MRN"): Promise<string> {
  const { data, error } = await supabase.rpc("next_ref", { p_prefix: prefix });
  if (error) throw error;
  return data as string;
}

// ---------------- Current system rate (live, via the shared engine) ----------------

/** Compute a system's current rate_per_sqm + breakdown from live members/materials + active rate card. */
export async function computeSystemCurrentRate(
  systemId: string, opts?: { ohOverride?: number | null }
): Promise<{ rate_per_sqm: number; breakdown: RateBreakdown } | null> {
  const [system, members, mats, materials, sections, rc] = await Promise.all([
    fetchSystem(systemId), fetchSystemMembers(systemId), fetchSystemMaterials(systemId),
    fetchMaterials(), fetchSections(), fetchActiveRateCard(),
  ]);
  if (!rc) return null;
  const matById = Object.fromEntries(materials.map((m) => [m.id, m]));
  const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
  const breakdown = computeRate(
    {
      panel_area_sqm: Number(system.panel_area_sqm) || 0, apply_powder_coating: system.apply_powder_coating,
      labour_per_sqm: system.labour_per_sqm, freight_per_sqm: system.freight_per_sqm, wastage_pct: system.wastage_pct,
      design_pct: system.design_pct, misc_pct: system.misc_pct, pmc_pct: system.pmc_pct,
      oh_profit_pct: opts?.ohOverride != null ? opts.ohOverride : system.oh_profit_pct,
    },
    members.map((m) => resolveMember(m, m.section_id ? secById[m.section_id]?.default_unit_weight_kg_per_m : null)),
    mats.map((m) => resolveMaterial(m, m.material_id ? matById[m.material_id]?.default_rate : null)),
    rc,
    cutOptFor(system, rc)
  );
  return { rate_per_sqm: breakdown.rate_per_sqm, breakdown };
}

// ---------------- A1 Parametric assemblies ----------------

export async function fetchAssemblies(): Promise<Assembly[]> {
  const { data, error } = await supabase.from("assemblies").select("*").order("code");
  if (error) return [];
  return (data as Assembly[]) ?? [];
}
export async function fetchAssembly(id: string): Promise<Assembly> {
  const { data, error } = await supabase.from("assemblies").select("*").eq("id", id).single();
  if (error) throw error; return data as Assembly;
}
export async function fetchAssemblyMembers(assemblyId: string): Promise<AssemblyMember[]> {
  const { data, error } = await supabase.from("assembly_members").select("*").eq("assembly_id", assemblyId).order("sort_order");
  if (error) throw error; return data as AssemblyMember[];
}
export async function fetchAssemblyMaterials(assemblyId: string): Promise<AssemblyMaterial[]> {
  const { data, error } = await supabase.from("assembly_materials").select("*").eq("assembly_id", assemblyId).order("sort_order");
  if (error) throw error; return data as AssemblyMaterial[];
}
export async function createAssembly(a: Partial<Assembly>): Promise<Assembly> {
  const { data, error } = await supabase.from("assemblies").insert(a).select().single();
  if (error) throw error; return data as Assembly;
}
export async function updateAssembly(id: string, patch: Partial<Assembly>): Promise<void> {
  const { error } = await supabase.from("assemblies").update(patch).eq("id", id);
  if (error) throw error;
}
export async function replaceAssemblyMembers(assemblyId: string, rows: Omit<AssemblyMember, "id" | "assembly_id">[]): Promise<void> {
  const del = await supabase.from("assembly_members").delete().eq("assembly_id", assemblyId);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await supabase.from("assembly_members").insert(rows.map((r, i) => ({ ...r, assembly_id: assemblyId, sort_order: i })));
    if (ins.error) throw ins.error;
  }
}
export async function replaceAssemblyMaterials(assemblyId: string, rows: Omit<AssemblyMaterial, "id" | "assembly_id">[]): Promise<void> {
  const del = await supabase.from("assembly_materials").delete().eq("assembly_id", assemblyId);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await supabase.from("assembly_materials").insert(rows.map((r, i) => ({ ...r, assembly_id: assemblyId, sort_order: i })));
    if (ins.error) throw ins.error;
  }
}

/** Compute an assembly's rate/sqm + breakdown at W×H×N from live data + active rate card. */
export async function computeAssemblyCurrentRate(
  assemblyId: string, W: number, H: number, N: number
): Promise<{ rate_per_sqm: number; breakdown: RateBreakdown; area: number } | null> {
  const [asm, members, mats, materials, sections, rc] = await Promise.all([
    fetchAssembly(assemblyId), fetchAssemblyMembers(assemblyId), fetchAssemblyMaterials(assemblyId),
    fetchMaterials(), fetchSections(), fetchActiveRateCard(),
  ]);
  if (!rc) return null;
  const matById = Object.fromEntries(materials.map((m) => [m.id, m]));
  const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
  const breakdown = computeAssemblyRate(
    {
      apply_powder_coating: asm.apply_powder_coating, labour_per_sqm: asm.labour_per_sqm, freight_per_sqm: asm.freight_per_sqm,
      wastage_pct: asm.wastage_pct, design_pct: asm.design_pct, misc_pct: asm.misc_pct, pmc_pct: asm.pmc_pct, oh_profit_pct: asm.oh_profit_pct,
    },
    members.map((m) => ({
      orientation: m.orientation, base_cutlength_m: Number(m.base_cutlength_m) || 0, number: m.number, qty: Number(m.qty) || 0,
      unit_weight_kg_per_m: m.unit_weight_kg_per_m != null ? Number(m.unit_weight_kg_per_m) : Number(m.section_id ? secById[m.section_id]?.default_unit_weight_kg_per_m : 0) || 0,
      section_key: m.section_id ?? m.member_name, member_name: m.member_name,
    })),
    mats.map((m) => ({ qty_per_unit: Number(m.qty_per_unit) || 0, rate: m.material_id ? Number(matById[m.material_id]?.default_rate) || 0 : 0, is_infill: m.is_infill })),
    rc, W, H, N
  );
  return { rate_per_sqm: breakdown.rate_per_sqm, breakdown, area: (W / 1000) * (H / 1000) * Math.max(1, N) };
}

// ---------------- Projects ----------------

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export async function fetchProject(id: string): Promise<Project> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Project;
}

export async function createProject(p: {
  client_name: string; project_name: string; location?: string; site_address?: string; created_by: string | null;
}): Promise<Project> {
  const code = await nextRef("PRJ");
  const { data, error } = await supabase.from("projects").insert({
    code, client_name: p.client_name, project_name: p.project_name,
    location: p.location || null, site_address: p.site_address || null, created_by: p.created_by,
  }).select().single();
  if (error) throw error;
  return data as Project;
}

export async function updateProjectStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) throw error;
}

// ---------------- Estimates ----------------

export async function fetchEstimates(projectId: string): Promise<Estimate[]> {
  const { data, error } = await supabase.from("estimates").select("*")
    .eq("project_id", projectId).order("version", { ascending: false });
  if (error) throw error;
  return data as Estimate[];
}

export async function fetchEstimateLines(estimateId: string): Promise<EstimateLine[]> {
  const { data, error } = await supabase.from("estimate_lines").select("*")
    .eq("estimate_id", estimateId).order("sort_order");
  if (error) throw error;
  return data as EstimateLine[];
}

export async function createEstimate(projectId: string, createdBy: string | null): Promise<Estimate> {
  const existing = await fetchEstimates(projectId);
  const version = existing.length ? Math.max(...existing.map((e) => e.version)) + 1 : 1;
  const code = await nextRef("EST");
  const { data, error } = await supabase.from("estimates").insert({
    code, project_id: projectId, version, status: "draft", total_amount: 0, created_by: createdBy,
  }).select().single();
  if (error) throw error;
  return data as Estimate;
}

export type EstimateLineDraft = {
  system_id: string | null; elevation_ref: string | null;
  area_sqm: number; rate_per_sqm: number; notes: string | null;
  area_source?: string; ai_confidence?: number | null; ai_confidence_reason?: string | null;
  assembly_id?: string | null; inst_width_mm?: number | null; inst_height_mm?: number | null; inst_count?: number | null;
};

/** Replace all lines of an estimate and update its total_amount. amount is a generated column. */
export async function saveEstimateLines(
  estimateId: string, lines: EstimateLineDraft[], changedBy?: string | null, note?: string
): Promise<number> {
  const del = await supabase.from("estimate_lines").delete().eq("estimate_id", estimateId);
  if (del.error) throw del.error;
  let total = 0;
  const snapLines = lines.map((l, i) => {
    total += (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0);
    return {
      estimate_id: estimateId, system_id: l.system_id, elevation_ref: l.elevation_ref,
      area_sqm: Number(l.area_sqm) || 0, rate_per_sqm: Number(l.rate_per_sqm) || 0,
      notes: l.notes, sort_order: i,
      area_source: l.area_source ?? "manual",
      ai_confidence: l.ai_confidence ?? null,
      ai_confidence_reason: l.ai_confidence_reason ?? null,
      assembly_id: l.assembly_id ?? null,
      inst_width_mm: l.inst_width_mm ?? null,
      inst_height_mm: l.inst_height_mm ?? null,
      inst_count: l.inst_count ?? null,
    };
  });
  if (snapLines.length) {
    const ins = await supabase.from("estimate_lines").insert(snapLines);
    if (ins.error) throw ins.error;
  }
  const upd = await supabase.from("estimates").update({ total_amount: total }).eq("id", estimateId);
  if (upd.error) throw upd.error;
  // v1.3: write a revision snapshot (best-effort — never blocks the save)
  try {
    await createEstimateRevision(estimateId, { total, lines: snapLines }, changedBy ?? null, note ?? null);
  } catch (e) { console.warn("revision snapshot failed", e); }
  return total;
}

export async function updateEstimateStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("estimates").update({ status }).eq("id", id);
  if (error) throw error;
}

// ---- v1.3 markup tiers, estimate meta, revisions ----

export async function fetchMarkupTiers(): Promise<import("@/types/facade").MarkupTier[]> {
  const { data, error } = await supabase.from("markup_tiers").select("*").order("markup_pct");
  if (error) return [];
  return (data as import("@/types/facade").MarkupTier[]) ?? [];
}

export async function createMarkupTier(t: {
  name: string; risk_level: string | null; markup_pct: number; contingency_pct: number;
}): Promise<void> {
  const { error } = await supabase.from("markup_tiers").insert(t);
  if (error) throw error;
}

export async function updateEstimateMeta(
  id: string, patch: Partial<Pick<Estimate, "markup_tier_id" | "contingency_pct" | "scenario_label" | "total_amount">>
): Promise<void> {
  const { error } = await supabase.from("estimates").update(patch).eq("id", id);
  if (error) throw error;
}

export async function fetchEstimateRevisions(estimateId: string): Promise<import("@/types/facade").EstimateRevision[]> {
  const { data, error } = await supabase.from("estimate_revisions").select("*")
    .eq("estimate_id", estimateId).order("changed_at", { ascending: false });
  if (error) return [];
  return (data as import("@/types/facade").EstimateRevision[]) ?? [];
}

export async function createEstimateRevision(
  estimateId: string, snapshot: unknown, changedBy: string | null, note: string | null
): Promise<void> {
  const { error } = await supabase.from("estimate_revisions")
    .insert({ estimate_id: estimateId, snapshot, changed_by: changedBy, change_note: note });
  if (error) throw error;
}

/** Create a new estimate version that copies the lines of `sourceEstimateId`. */
export async function reviseEstimate(projectId: string, sourceEstimateId: string, createdBy: string | null): Promise<Estimate> {
  const srcLines = await fetchEstimateLines(sourceEstimateId);
  const est = await createEstimate(projectId, createdBy);
  if (srcLines.length) {
    await saveEstimateLines(est.id, srcLines.map((l) => ({
      system_id: l.system_id, elevation_ref: l.elevation_ref,
      area_sqm: l.area_sqm, rate_per_sqm: l.rate_per_sqm, notes: l.notes,
    })));
  }
  return est;
}

// ---------------- Quotations ----------------

export async function fetchQuotations(projectId: string): Promise<Quotation[]> {
  const { data, error } = await supabase.from("quotations").select("*")
    .eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data as Quotation[];
}

export async function fetchQuotation(id: string): Promise<Quotation> {
  const { data, error } = await supabase.from("quotations").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Quotation;
}

export async function fetchQuotationLines(quotationId: string): Promise<QuotationLine[]> {
  const { data, error } = await supabase.from("quotation_lines").select("*")
    .eq("quotation_id", quotationId).order("sort_order");
  if (error) throw error;
  return data as QuotationLine[];
}

/** Generate a quotation from an estimate: copies lines into client-facing descriptions. */
export async function createQuotationFromEstimate(
  projectId: string, estimateId: string, createdBy: string | null
): Promise<Quotation> {
  const [lines, systems, rc] = await Promise.all([fetchEstimateLines(estimateId), fetchSystems(), fetchActiveRateCard()]);
  const sysById = Object.fromEntries(systems.map((s) => [s.id, s]));
  const code = await nextRef("QT");
  const total = lines.reduce((s, l) => s + (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0), 0);

  const { data: q, error } = await supabase.from("quotations").insert({
    code, project_id: projectId, estimate_id: estimateId, status: "draft",
    total_amount: total, created_by: createdBy,
    // v1.1: carry price validity + escalation from the active rate card
    price_valid_until: rc?.valid_until ?? null,
    escalation_clause: rc?.escalation_note ?? null,
  }).select().single();
  if (error) throw error;

  if (lines.length) {
    const qLines = lines.map((l, i) => {
      const sys = l.system_id ? sysById[l.system_id] : null;
      const desc = [sys ? `${sys.name}` : "Item", l.elevation_ref ? `(${l.elevation_ref})` : ""].filter(Boolean).join(" ");
      return {
        quotation_id: (q as Quotation).id, description: desc, system_id: l.system_id,
        area_sqm: l.area_sqm, rate_per_sqm: l.rate_per_sqm,
        amount: (Number(l.area_sqm) || 0) * (Number(l.rate_per_sqm) || 0), sort_order: i,
      };
    });
    const ins = await supabase.from("quotation_lines").insert(qLines);
    if (ins.error) throw ins.error;
  }
  return q as Quotation;
}

export async function updateQuotation(
  id: string, patch: Partial<Pick<Quotation, "valid_until" | "terms" | "status" | "total_amount" | "price_valid_until" | "escalation_clause" |
    "greeting_name" | "subject" | "body_text" | "price_per_sqft" | "payment_terms_a" | "payment_terms_b" | "payment_terms_c" | "payment_terms_d">>
): Promise<void> {
  const { error } = await supabase.from("quotations").update(patch).eq("id", id);
  if (error) throw error;
}

// ---------------- Execution stages (F4) ----------------

/** Standard facade execution sequence, seeded on quotation approval. */
export const STANDARD_STAGES = [
  "Site Survey",
  "Design & Engineering",
  "Drawing Approval",
  "Material Procurement",
  "Fabrication",
  "Glass / Infill Procurement",
  "Installation",
  "Inspection & QA",
  "Handover",
];

export async function fetchProjectStages(projectId: string): Promise<ProjectStage[]> {
  const { data, error } = await supabase.from("project_stages").select("*")
    .eq("project_id", projectId).order("sort_order");
  if (error) throw error;
  return data as ProjectStage[];
}

/** Seed the standard stage list for a project if it has none yet. Returns true if seeded. */
export async function seedProjectStages(projectId: string, ownerId: string | null): Promise<boolean> {
  const existing = await fetchProjectStages(projectId);
  if (existing.length > 0) return false;
  const rows = STANDARD_STAGES.map((stage, i) => ({
    project_id: projectId, stage, status: "pending", owner_id: ownerId, sort_order: i,
  }));
  const { error } = await supabase.from("project_stages").insert(rows);
  if (error) throw error;
  return true;
}

export async function updateStage(
  id: string,
  patch: Partial<Pick<ProjectStage, "status" | "owner_id" | "notes" | "started_at" | "completed_at">>
): Promise<void> {
  const { error } = await supabase.from("project_stages").update(patch).eq("id", id);
  if (error) throw error;
}

// ---------------- Estimate vs actual (v1.2 #7) ----------------

export async function fetchActuals(projectId: string): Promise<import("@/types/facade").Actual[]> {
  const { data, error } = await supabase.from("actuals").select("*")
    .eq("project_id", projectId).order("recorded_at", { ascending: false });
  if (error) throw error;
  return (data as import("@/types/facade").Actual[]) ?? [];
}

export async function createActual(a: {
  project_id: string; estimate_id: string | null;
  total_alu_kg_actual: number | null; wastage_pct_actual: number | null;
  labour_cost_actual: number | null; freight_cost_actual: number | null;
  material_cost_actual: number | null; notes: string | null; recorded_by: string | null;
}): Promise<void> {
  const { error } = await supabase.from("actuals").insert(a);
  if (error) throw error;
}

/** Rolling averages across recent actuals — used for the "suggested defaults" panel. */
export async function fetchActualAverages(): Promise<{ wastage_pct: number | null; count: number }> {
  const { data, error } = await supabase.from("actuals")
    .select("wastage_pct_actual").not("wastage_pct_actual", "is", null).limit(200);
  if (error || !data?.length) return { wastage_pct: null, count: 0 };
  const vals = (data as any[]).map((r) => Number(r.wastage_pct_actual)).filter((n) => !isNaN(n));
  if (!vals.length) return { wastage_pct: null, count: 0 };
  return { wastage_pct: vals.reduce((s, v) => s + v, 0) / vals.length, count: vals.length };
}

// ---------------- A5 compatibility rules ----------------

export async function fetchCompatibilityRules(): Promise<import("@/types/facade").CompatibilityRule[]> {
  const { data, error } = await supabase.from("compatibility_rules").select("*").order("rule_type");
  if (error) return [];
  return (data as import("@/types/facade").CompatibilityRule[]) ?? [];
}
export async function upsertCompatibilityRule(r: Partial<import("@/types/facade").CompatibilityRule>): Promise<void> {
  const { error } = await supabase.from("compatibility_rules").upsert(r);
  if (error) throw error;
}
export async function deleteCompatibilityRule(id: string): Promise<void> {
  const { error } = await supabase.from("compatibility_rules").delete().eq("id", id);
  if (error) throw error;
}

// ---------------- Tier 2 AI: estimate reviews (AI-4) ----------------

export async function createEstimateReview(estimateId: string, findings: unknown, riskSummary: string): Promise<void> {
  const { error } = await supabase.from("estimate_reviews").insert({ estimate_id: estimateId, findings, risk_summary: riskSummary, created_by_ai: true });
  if (error) throw error;
}
export async function fetchEstimateReviews(estimateId: string): Promise<Array<{ id: string; findings: any; risk_summary: string | null; created_at: string }>> {
  const { data, error } = await supabase.from("estimate_reviews").select("*").eq("estimate_id", estimateId).order("created_at", { ascending: false }).limit(5);
  if (error) return [];
  return (data as any[]) ?? [];
}

// ---------------- A2 infill pieces (sheet nesting) ----------------

export async function fetchInfillPieces(systemId: string): Promise<import("@/types/facade").InfillPiece[]> {
  const { data, error } = await supabase.from("infill_pieces").select("*").eq("system_id", systemId).order("sort_order");
  if (error) return [];
  return (data as import("@/types/facade").InfillPiece[]) ?? [];
}
export async function replaceInfillPieces(
  systemId: string, rows: Array<{ material_id: string | null; width_mm: number; height_mm: number; count: number; allow_rotation: boolean }>
): Promise<void> {
  const del = await supabase.from("infill_pieces").delete().eq("system_id", systemId);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await supabase.from("infill_pieces").insert(rows.map((r, i) => ({ ...r, system_id: systemId, sort_order: i })));
    if (ins.error) throw ins.error;
  }
}

// ---------------- AI core (config, runs, proposals) ----------------

export async function fetchAiConfig(): Promise<Record<string, { enabled: boolean; threshold: number }>> {
  const { data, error } = await supabase.from("ai_config").select("feature, enabled, confidence_threshold");
  if (error) return {};
  const map: Record<string, { enabled: boolean; threshold: number }> = {};
  for (const r of (data as any[]) ?? []) map[r.feature] = { enabled: !!r.enabled, threshold: Number(r.confidence_threshold) || 70 };
  return map;
}
export async function fetchAiConfigRows(): Promise<import("@/types/facade").AiConfigRow[]> {
  const { data, error } = await supabase.from("ai_config").select("*").order("feature");
  if (error) return [];
  return (data as import("@/types/facade").AiConfigRow[]) ?? [];
}
export async function updateAiConfig(feature: string, patch: { enabled?: boolean; confidence_threshold?: number }): Promise<void> {
  const { error } = await supabase.from("ai_config").update({ ...patch, updated_at: new Date().toISOString() }).eq("feature", feature);
  if (error) throw error;
}
export async function logAiRun(r: {
  feature: string; input_ref?: string | null; output: unknown; confidence: number;
  confidence_reason: string; accepted: boolean; actor_id: string | null;
}): Promise<void> {
  try { await supabase.from("ai_runs").insert({ ...r, input_ref: r.input_ref ?? null }); }
  catch (e) { console.warn("ai_runs insert failed", e); }
}

// AI-2 tender scope
export async function insertScopeItems(projectId: string, items: Array<Omit<import("@/types/facade").TenderScopeItem, "id" | "project_id" | "created_at" | "status">>): Promise<void> {
  if (!items.length) return;
  const { error } = await supabase.from("tender_scope_items").insert(items.map((i) => ({ ...i, project_id: projectId, status: "proposed" })));
  if (error) throw error;
}
export async function fetchScopeItems(projectId: string): Promise<import("@/types/facade").TenderScopeItem[]> {
  const { data, error } = await supabase.from("tender_scope_items").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) return [];
  return (data as import("@/types/facade").TenderScopeItem[]) ?? [];
}
export async function setScopeItemStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("tender_scope_items").update({ status }).eq("id", id);
  if (error) throw error;
}

// AI-3 material price proposals
export async function insertPriceProposals(rows: Array<{ material_id: string | null; proposed_rate: number; current_rate: number | null; source_doc: string | null; confidence: number; }>): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from("material_price_proposals").insert(rows.map((r) => ({ ...r, status: "proposed" })));
  if (error) throw error;
}
export async function fetchPriceProposals(): Promise<import("@/types/facade").MaterialPriceProposal[]> {
  const { data, error } = await supabase.from("material_price_proposals").select("*").eq("status", "proposed").order("created_at", { ascending: false });
  if (error) return [];
  return (data as import("@/types/facade").MaterialPriceProposal[]) ?? [];
}
export async function acceptPriceProposal(id: string, materialId: string, rate: number, decidedBy: string | null): Promise<void> {
  const upd = await supabase.from("materials").update({ default_rate: rate }).eq("id", materialId);
  if (upd.error) throw upd.error;
  const { error } = await supabase.from("material_price_proposals").update({ status: "accepted", decided_by: decidedBy }).eq("id", id);
  if (error) throw error;
}
export async function rejectPriceProposal(id: string, decidedBy: string | null): Promise<void> {
  const { error } = await supabase.from("material_price_proposals").update({ status: "rejected", decided_by: decidedBy }).eq("id", id);
  if (error) throw error;
}

// ---------------- Employees (hub, RLS-limited) ----------------

/** Employees the current user can read (admins: all; others: own row only). For owner dropdowns. */
export async function fetchEmployees(): Promise<EmployeeLite[]> {
  const { data, error } = await hub.from("employees").select("id, name, role").order("name");
  if (error) return [];
  return (data as EmployeeLite[]) ?? [];
}

// ---------------- Export hooks (F5, dormant — downloads only) ----------------

/**
 * Explode an estimate into an aggregated procurement BOM:
 * for each estimate line (system × area), scale the system's materials by
 * area / panel_area and aggregate by material; aluminium added as a kg line.
 */
export async function buildProcurementBom(estimateId: string): Promise<BomLine[]> {
  const lines = await fetchEstimateLines(estimateId);
  const [materials, sections] = await Promise.all([fetchMaterials(), fetchSections()]);
  const matById = Object.fromEntries(materials.map((m) => [m.id, m]));
  const secById = Object.fromEntries(sections.map((s) => [s.id, s]));

  const sysIds = [...new Set(lines.map((l) => l.system_id).filter(Boolean) as string[])];
  const sysData = Object.fromEntries(await Promise.all(sysIds.map(async (sid) => {
    const [sys, members, mats] = await Promise.all([fetchSystem(sid), fetchSystemMembers(sid), fetchSystemMaterials(sid)]);
    return [sid, { sys, members, mats }] as const;
  })));

  const agg = new Map<string, BomLine>();
  let aluKg = 0;

  for (const line of lines) {
    if (!line.system_id || !sysData[line.system_id]) continue;
    const { sys, members, mats } = sysData[line.system_id];
    const panelArea = Number(sys.panel_area_sqm) || 0;
    if (panelArea <= 0) continue;
    const factor = (Number(line.area_sqm) || 0) / panelArea;

    aluKg += members.reduce((s, m) => {
      const uw = m.unit_weight_kg_per_m != null ? Number(m.unit_weight_kg_per_m)
        : Number(m.section_id ? secById[m.section_id]?.default_unit_weight_kg_per_m : 0) || 0;
      return s + m.cutlength_m * m.number * m.qty * uw;
    }, 0) * factor;

    for (const sm of mats) {
      const mat = sm.material_id ? matById[sm.material_id] : null;
      const key = sm.material_id ?? `desc:${mat?.name ?? "item"}`;
      const prev = agg.get(key);
      const addQty = (Number(sm.qty) || 0) * factor;
      if (prev) prev.qty += addQty;
      else agg.set(key, { material_id: sm.material_id, description: mat?.name ?? "Material", qty: addQty, unit: mat?.unit ?? "" });
    }
  }

  const bom: BomLine[] = [];
  if (aluKg > 0) bom.push({ material_id: null, description: "Aluminium extrusion (mill finish)", qty: Math.round(aluKg * 1000) / 1000, unit: "kg" });
  for (const l of agg.values()) bom.push({ ...l, qty: Math.round(l.qty * 1000) / 1000 });
  return bom;
}

/** Create a facade procurement_request + lines, mark exported (dormant — no cps writes). */
export async function createProcurementExport(
  code: string, project: Project, bom: BomLine[], payload: unknown
): Promise<ProcurementRequest> {
  const { data: req, error } = await supabase.from("procurement_requests").insert({
    code, project_id: project.id, status: "exported",
    exported_to_cps: true, export_payload: payload as any, exported_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  if (bom.length) {
    const rows = bom.map((b, i) => ({
      request_id: (req as ProcurementRequest).id, material_id: b.material_id,
      description: b.description, qty: b.qty, unit: b.unit, sort_order: i,
    }));
    const ins = await supabase.from("procurement_lines").insert(rows);
    if (ins.error) throw ins.error;
  }
  return req as ProcurementRequest;
}

/** Create a facade payment, mark exported to finance (dormant — no finance writes). */
export async function createPaymentExport(
  code: string, projectId: string, p: { payment_type: string; party_name: string; amount: number }, payload: unknown
): Promise<Payment> {
  const { data, error } = await supabase.from("payments").insert({
    code, project_id: projectId, payment_type: p.payment_type, party_name: p.party_name,
    amount: p.amount, status: "exported",
    exported_to_finance: true, export_payload: payload as any, exported_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return data as Payment;
}

// ============================================================================
// Step 1 — Tenders
// ============================================================================

export async function fetchTenders(): Promise<Tender[]> {
  const { data, error } = await supabase.from("tenders").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Tender[];
}

export async function fetchTender(id: string): Promise<Tender> {
  const { data, error } = await supabase.from("tenders").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Tender;
}

export async function createTender(t: {
  client_name: string; tender_name: string; location?: string; site_address?: string;
  document_ref?: string; due_date?: string | null; created_by: string | null;
}): Promise<Tender> {
  const code = await nextRef("TND");
  const { data, error } = await supabase.from("tenders").insert({
    code, client_name: t.client_name, tender_name: t.tender_name,
    location: t.location || null, site_address: t.site_address || null,
    document_ref: t.document_ref || null, due_date: t.due_date || null, created_by: t.created_by,
  }).select().single();
  if (error) throw error;
  return data as Tender;
}

export async function updateTender(
  id: string, patch: Partial<Pick<Tender, "client_name" | "tender_name" | "location" | "site_address" | "document_ref" | "due_date" | "status" | "notes" | "converted_project_id">>
): Promise<void> {
  const { error } = await supabase.from("tenders").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Convert a tender into a project: create the project (carrying client + location),
 * create its first estimate, fill in the accepted scope lines, and mark the tender
 * converted. Reuses the existing project/estimate helpers — nothing is re-typed.
 */
export async function convertTenderToProject(
  tender: Tender, acceptedScope: EstimateLineDraft[], createdBy: string | null
): Promise<{ project: Project; estimate: Estimate }> {
  const project = await createProject({
    client_name: tender.client_name, project_name: tender.tender_name,
    location: tender.location ?? undefined, site_address: tender.site_address ?? undefined, created_by: createdBy,
  });
  const estimate = await createEstimate(project.id, createdBy);
  if (acceptedScope.length) await saveEstimateLines(estimate.id, acceptedScope, createdBy, "From tender " + tender.code);
  await updateTender(tender.id, { status: "converted", converted_project_id: project.id });
  await updateProjectStatus(project.id, "estimating");
  return { project, estimate };
}

// ============================================================================
// Step 4 — Budget Sheet
// ============================================================================

export async function fetchBudgetTemplateHeads(): Promise<BudgetTemplateHead[]> {
  const { data, error } = await supabase.from("budget_template_heads").select("*").order("sort_order");
  if (error) return [];
  return (data as BudgetTemplateHead[]) ?? [];
}

export async function updateBudgetTemplateHead(
  id: string, patch: Partial<Pick<BudgetTemplateHead, "calc_type" | "pct_value" | "pct_basis" | "default_payment_delay_days" | "is_active">>
): Promise<void> {
  const { error } = await supabase.from("budget_template_heads").update(patch).eq("id", id);
  if (error) throw error;
}

export async function fetchBudgets(projectId: string): Promise<Budget[]> {
  const { data, error } = await supabase.from("budgets").select("*").eq("project_id", projectId).order("version", { ascending: false });
  if (error) throw error;
  return data as Budget[];
}

export async function fetchBudget(id: string): Promise<Budget> {
  const { data, error } = await supabase.from("budgets").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Budget;
}

export async function fetchBudgetHeads(budgetId: string): Promise<BudgetHead[]> {
  const { data, error } = await supabase.from("budget_heads").select("*").eq("budget_id", budgetId).order("sort_order");
  if (error) throw error;
  return data as BudgetHead[];
}

export async function fetchBudgetPmLines(budgetId: string): Promise<BudgetPmLine[]> {
  const { data, error } = await supabase.from("budget_pm_lines").select("*").eq("budget_id", budgetId).order("sort_order");
  if (error) throw error;
  return data as BudgetPmLine[];
}

export async function fetchBudgetMaterialLines(budgetId: string): Promise<BudgetMaterialLine[]> {
  const { data, error } = await supabase.from("budget_material_lines").select("*").eq("budget_id", budgetId).order("sort_order");
  if (error) throw error;
  return data as BudgetMaterialLine[];
}

/**
 * Create a budget for a project, seeded from an estimate:
 * - cost heads are copied from the global template;
 * - the Material head is seeded from the estimate BOM;
 * - the Material head's value is set from the BOM cost so it is non-zero on day 1.
 * Everything stays editable on the budget; the estimate is never mutated.
 */
export async function createBudgetFromEstimate(
  project: Project, estimateId: string | null, createdBy: string | null
): Promise<Budget> {
  const code = await nextRef("BUD");
  const [tmpl, cfg] = await Promise.all([fetchBudgetTemplateHeads(), fetchCalcConfig()]);
  const existing = await fetchBudgets(project.id);
  const version = existing.length ? Math.max(...existing.map((b) => b.version)) + 1 : 1;

  const { data: bud, error } = await supabase.from("budgets").insert({
    code, project_id: project.id, estimate_id: estimateId, name: project.project_name + " budget",
    version, status: "draft",
    markup_pct: (cfg as any).budget_markup_pct ?? 20,
    creditor_interest_pct: (cfg as any).budget_creditor_interest_pct ?? 15,
    advance_pct: (cfg as any).budget_advance_pct ?? 10,
    created_by: createdBy,
  }).select().single();
  if (error) throw error;
  const budget = bud as Budget;

  // copy template heads into this budget
  if (tmpl.length) {
    const headRows = tmpl.filter((h) => h.is_active).map((h) => ({
      budget_id: budget.id, head_name: h.head_name, sort_order: h.sort_order,
      calc_type: h.calc_type, value: 0, pct_value: h.pct_value, pct_basis: h.pct_basis,
      payment_delay_days: h.default_payment_delay_days,
    }));
    const ins = await supabase.from("budget_heads").insert(headRows);
    if (ins.error) throw ins.error;
  }

  // seed material build-up from the estimate BOM
  if (estimateId) {
    try {
      const bom = await buildProcurementBom(estimateId);
      const matById = Object.fromEntries((await fetchMaterials()).map((m) => [m.id, m]));
      if (bom.length) {
        const matRows = bom.map((b, i) => ({
          budget_id: budget.id, description: b.description, qty: Number(b.qty) || 0, uom: b.unit,
          rate: b.material_id ? Number(matById[b.material_id]?.default_rate) || 0 : 0,
          source: "estimate", sort_order: i,
        }));
        await supabase.from("budget_material_lines").insert(matRows);
      }
    } catch (e) { console.warn("budget material seed failed", e); }
  }
  return budget;
}

export async function updateBudget(
  id: string, patch: Partial<Pick<Budget,
    "name" | "status" | "reference_date" | "start_date" | "on_site_date" | "completion_date" |
    "markup_pct" | "creditor_interest_pct" | "debtor_interest_pct" | "advance_pct" | "retention_pct" |
    "total_costs" | "markup_amount" | "contract_value" | "cashflow_snapshot">>
): Promise<void> {
  const { error } = await supabase.from("budgets").update(patch).eq("id", id);
  if (error) throw error;
}

export async function replaceBudgetHeads(budgetId: string, rows: Omit<BudgetHead, "id" | "budget_id">[]): Promise<void> {
  const del = await supabase.from("budget_heads").delete().eq("budget_id", budgetId);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await supabase.from("budget_heads").insert(rows.map((r, i) => ({ ...r, budget_id: budgetId, sort_order: r.sort_order ?? i })));
    if (ins.error) throw ins.error;
  }
}

export async function replaceBudgetPmLines(budgetId: string, rows: Array<Pick<BudgetPmLine, "description" | "uom" | "qty" | "salary" | "duration_months">>): Promise<void> {
  const del = await supabase.from("budget_pm_lines").delete().eq("budget_id", budgetId);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await supabase.from("budget_pm_lines").insert(rows.map((r, i) => ({ ...r, budget_id: budgetId, sort_order: i })));
    if (ins.error) throw ins.error;
  }
}

export async function replaceBudgetMaterialLines(budgetId: string, rows: Array<Pick<BudgetMaterialLine, "description" | "qty" | "uom" | "rate" | "source">>): Promise<void> {
  const del = await supabase.from("budget_material_lines").delete().eq("budget_id", budgetId);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await supabase.from("budget_material_lines").insert(rows.map((r, i) => ({ ...r, budget_id: budgetId, sort_order: i })));
    if (ins.error) throw ins.error;
  }
}

// ============================================================================
// Step 7 — MRN (Material Receiving Note)
// ============================================================================

export async function fetchProcurementRequests(projectId: string): Promise<ProcurementRequest[]> {
  const { data, error } = await supabase.from("procurement_requests").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) return [];
  return (data as ProcurementRequest[]) ?? [];
}

export async function fetchProcurementLines(requestId: string): Promise<ProcurementLine[]> {
  const { data, error } = await supabase.from("procurement_lines").select("*").eq("request_id", requestId).order("sort_order");
  if (error) return [];
  return (data as ProcurementLine[]) ?? [];
}

export async function fetchMrns(projectId: string): Promise<MaterialReceivingNote[]> {
  const { data, error } = await supabase.from("material_receiving_notes").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data as MaterialReceivingNote[];
}

export async function fetchMrnLines(mrnId: string): Promise<MrnLineItem[]> {
  const { data, error } = await supabase.from("mrn_line_items").select("*").eq("mrn_id", mrnId).order("sort_order");
  if (error) throw error;
  return data as MrnLineItem[];
}

export async function createMrn(
  header: { project_id: string; procurement_request_id?: string | null; vendor_name?: string; vendor_gstin?: string; invoice_ref?: string; received_date?: string; notes?: string; created_by: string | null },
  lines: Array<{ procurement_line_id?: string | null; material_id?: string | null; description: string; ordered_qty: number; received_qty: number; unit: string; rate: number }>
): Promise<MaterialReceivingNote> {
  const code = await nextRef("MRN");
  const total = lines.reduce((s, l) => s + (Number(l.received_qty) || 0) * (Number(l.rate) || 0), 0);
  const { data: mrn, error } = await supabase.from("material_receiving_notes").insert({
    code, project_id: header.project_id, procurement_request_id: header.procurement_request_id ?? null,
    vendor_name: header.vendor_name ?? null, vendor_gstin: header.vendor_gstin ?? null, invoice_ref: header.invoice_ref ?? null,
    received_date: header.received_date ?? new Date().toISOString().slice(0, 10), notes: header.notes ?? null,
    total_value: total, created_by: header.created_by,
  }).select().single();
  if (error) throw error;
  const m = mrn as MaterialReceivingNote;
  if (lines.length) {
    const rows = lines.map((l, i) => ({
      mrn_id: m.id, procurement_line_id: l.procurement_line_id ?? null, material_id: l.material_id ?? null,
      description: l.description, ordered_qty: Number(l.ordered_qty) || 0, received_qty: Number(l.received_qty) || 0,
      unit: l.unit, rate: Number(l.rate) || 0, sort_order: i,
    }));
    const ins = await supabase.from("mrn_line_items").insert(rows);
    if (ins.error) throw ins.error;
  }
  return m;
}

export async function updateMrnStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("material_receiving_notes").update({ status }).eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Step 8 — Finance (receivables / payables tracking; export-only)
// ============================================================================

export async function fetchPayments(projectId: string): Promise<Payment[]> {
  const { data, error } = await supabase.from("payments").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data as Payment[];
}

export async function createReceivable(p: {
  project_id: string; party_name: string; amount: number; due_date?: string | null; invoice_ref?: string | null;
}): Promise<Payment> {
  const code = await nextRef("PAY");
  const { data, error } = await supabase.from("payments").insert({
    code, project_id: p.project_id, payment_type: "client_invoice", direction: "receivable",
    party_name: p.party_name, amount: p.amount, status: "pending", paid_amount: 0,
    due_date: p.due_date ?? null, invoice_ref: p.invoice_ref ?? null,
  }).select().single();
  if (error) throw error;
  return data as Payment;
}

export async function createPayableFromMrn(mrn: MaterialReceivingNote, createdBy: string | null): Promise<Payment> {
  const code = await nextRef("PAY");
  const { data, error } = await supabase.from("payments").insert({
    code, project_id: mrn.project_id, payment_type: "vendor_payment", direction: "payable",
    party_name: mrn.vendor_name, amount: mrn.total_value, status: "pending", paid_amount: 0,
    mrn_id: mrn.id, vendor_gstin: mrn.vendor_gstin, invoice_ref: mrn.invoice_ref, created_by: createdBy,
  }).select().single();
  if (error) throw error;
  return data as Payment;
}

/** Update a payment's paid amount / due date; status is derived from paid vs amount. */
export async function updatePayment(
  id: string, patch: { paid_amount?: number; due_date?: string | null; amount?: number }
): Promise<void> {
  const updates: any = { ...patch };
  if (patch.paid_amount != null || patch.amount != null) {
    // fetch current to derive status
    const { data } = await supabase.from("payments").select("amount, paid_amount, due_date").eq("id", id).single();
    const amount = patch.amount ?? (Number((data as any)?.amount) || 0);
    const paid = patch.paid_amount ?? (Number((data as any)?.paid_amount) || 0);
    const due = patch.due_date ?? (data as any)?.due_date;
    let status = "pending";
    if (paid >= amount && amount > 0) status = "paid";
    else if (paid > 0) status = "partly_paid";
    else if (due && new Date(due) < new Date()) status = "overdue";
    updates.status = status;
  }
  const { error } = await supabase.from("payments").update(updates).eq("id", id);
  if (error) throw error;
}
