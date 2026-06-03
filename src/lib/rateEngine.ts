// ============================================================================
// Facade rate engine — pure TypeScript implementation of PRD §5.
// Verified against Consumption.xlsx: every seeded system reproduces the sheet's
// Rate/sqm within ₹1 (see scripts/parse-and-verify.mjs and the Verification page).
//
// This is the single source of truth for live calculation in the browser and
// for the snapshot persisted to facade.system_rates.breakdown.
// ============================================================================
import { optimizeCuts } from "@/lib/cutOptimize";

export interface RateCardInput {
  aluminium_per_kg: number;
  conversion_per_kg: number;
  powder_coating_per_kg: number;
  // v1.1 landed-cost base (optional; defaults reproduce baseline)
  aluminium_basis?: "landed" | "stockist" | string | null;
  freight_handling_pct?: number | null;
}

/**
 * Effective aluminium rate per kg. When basis = 'stockist', apply the freight/
 * handling uplift; otherwise (default 'landed') use the rate as-is. With the
 * shipped defaults (basis='landed', uplift=0) this equals aluminium_per_kg, so
 * the baseline is preserved.
 */
export function aluminiumEffectivePerKg(rc: RateCardInput): number {
  const base = Number(rc.aluminium_per_kg) || 0;
  if (rc.aluminium_basis === "stockist") {
    return base * (1 + (Number(rc.freight_handling_pct) || 0) / 100);
  }
  return base;
}

/** A member with its unit weight already resolved (member value, else section default). */
export interface MemberInput {
  member_name?: string;
  cutlength_m: number;
  number: number;
  qty: number;
  unit_weight_kg_per_m: number; // resolved
  section_key?: string; // profile grouping for cut-optimization (section_id, else a label)
}

/** A material line with its rate already resolved (rate_override, else material default). */
export interface MaterialInput {
  name?: string;
  qty: number;
  rate: number; // resolved
  is_infill: boolean;
  // v1.3 sealant bead-volume (optional; when is_sealant, qty is computed)
  is_sealant?: boolean;
  perimeter_m?: number | null;
  structural_bite_mm?: number | null;
  glueline_mm?: number | null;
  tube_volume_ml?: number | null;
}

/** Sealant tubes from bead volume: (perimeter_m × bite_mm × glueline_mm) / tube_ml. */
export function sealantTubes(m: {
  perimeter_m?: number | null; structural_bite_mm?: number | null;
  glueline_mm?: number | null; tube_volume_ml?: number | null;
}): number {
  const p = Number(m.perimeter_m) || 0, b = Number(m.structural_bite_mm) || 0;
  const g = Number(m.glueline_mm) || 0, v = Number(m.tube_volume_ml) || 0;
  if (v <= 0) return 0;
  return (p * b * g) / v;
}

export interface SystemParamsInput {
  panel_area_sqm: number;
  apply_powder_coating: boolean;
  labour_per_sqm: number;
  freight_per_sqm: number;
  wastage_pct: number;
  design_pct: number;
  misc_pct: number;
  pmc_pct: number;
  oh_profit_pct: number;
}

export interface RateBreakdown {
  total_alu_kg: number; // members' actual (used) weight
  aluminium_cost: number;
  conversion_cost: number;
  coating_cost: number;
  consumable_total: number;
  infill_total: number;
  wastage_cost: number;
  material_total: number;
  area: number;
  labour_cost: number;
  freight_cost: number;
  basic: number;
  design: number;
  misc: number;
  pmc: number;
  oh_profit: number;
  final: number;
  rate_per_sqm: number;
  // v1.2 cut-optimization (present only when enabled)
  cut_optimized?: boolean;
  purchased_alu_kg?: number;
  offcut_kg?: number;
  optimized_wastage_pct?: number;
  scrap_credit_amount?: number;
}

export interface CutOptInput {
  enabled: boolean;
  applyScrapCredit: boolean;
  bar: import("@/lib/cutOptimize").BarParams;
  scrap_recovery_pct: number;
}

/**
 * Compute the per-sqm rate and full cost build-up for one system.
 * Inputs must have unit weights / material rates already resolved.
 */
export function computeRate(
  system: SystemParamsInput,
  members: MemberInput[],
  materials: MaterialInput[],
  rateCard: RateCardInput,
  cutOpt?: CutOptInput
): RateBreakdown {
  // 1) aluminium weight (members' actual / used weight)
  const total_alu_kg = members.reduce(
    (s, m) => s + m.cutlength_m * m.number * m.qty * (m.unit_weight_kg_per_m || 0),
    0
  );
  const aluEff = aluminiumEffectivePerKg(rateCard);

  // 1b) optional cut-optimization: buy whole bars → purchased_kg > used_kg
  let purchased_alu_kg: number | undefined;
  let offcut_kg: number | undefined;
  let optimized_wastage_pct: number | undefined;
  let scrap_credit_amount = 0;
  let aluminium_billed_kg = total_alu_kg;

  if (cutOpt?.enabled) {
    const packed = optimizeCutsForMembers(members, cutOpt.bar);
    purchased_alu_kg = packed.purchased_kg;
    offcut_kg = packed.offcut_kg;
    optimized_wastage_pct = packed.optimized_wastage_pct;
    aluminium_billed_kg = packed.purchased_kg; // you pay for whole bars
    if (cutOpt.applyScrapCredit) {
      scrap_credit_amount = (offcut_kg || 0) * aluEff * (cutOpt.scrap_recovery_pct / 100);
    }
  }

  // 2) metal costs — aluminium on billed kg; conversion & coating on actual (used) kg
  const aluminium_cost = aluminium_billed_kg * aluEff;
  const conversion_cost = total_alu_kg * rateCard.conversion_per_kg;
  const coating_cost = system.apply_powder_coating
    ? total_alu_kg * rateCard.powder_coating_per_kg
    : 0;

  // 3) materials split + wastage on infill
  let consumable_total = 0;
  let infill_total = 0;
  for (const m of materials) {
    // v1.3: sealant qty is computed from bead volume (ceil of tubes); else stored qty
    const qty = m.is_sealant ? Math.ceil(sealantTubes(m)) : m.qty;
    const line = qty * m.rate;
    if (m.is_infill) infill_total += line;
    else consumable_total += line;
  }
  const wastage_cost = infill_total * (system.wastage_pct / 100);

  // 4) material total (scrap credit, if any, reduces it)
  const material_total =
    aluminium_cost + conversion_cost + coating_cost + consumable_total + infill_total + wastage_cost
    - scrap_credit_amount;

  // 5) labour + freight → basic
  const area = system.panel_area_sqm || 0;
  const labour_cost = area * system.labour_per_sqm;
  const freight_cost = area * system.freight_per_sqm;
  const basic = material_total + labour_cost + freight_cost;

  // 6) the four percentages on basic (not compounding) → final → rate
  const design = basic * (system.design_pct / 100);
  const misc = basic * (system.misc_pct / 100);
  const pmc = basic * (system.pmc_pct / 100);
  const oh_profit = basic * (system.oh_profit_pct / 100);
  const final = basic + design + misc + pmc + oh_profit;
  const rate_per_sqm = area > 0 ? final / area : 0;

  return {
    total_alu_kg,
    aluminium_cost,
    conversion_cost,
    coating_cost,
    consumable_total,
    infill_total,
    wastage_cost,
    material_total,
    area,
    labour_cost,
    freight_cost,
    basic,
    design,
    misc,
    pmc,
    oh_profit,
    final,
    rate_per_sqm,
    cut_optimized: cutOpt?.enabled || undefined,
    purchased_alu_kg,
    offcut_kg,
    optimized_wastage_pct,
    scrap_credit_amount: cutOpt?.enabled ? scrap_credit_amount : undefined,
  };
}

function optimizeCutsForMembers(members: MemberInput[], bar: import("@/lib/cutOptimize").BarParams) {
  const packMembers = members.map((m) => ({
    section_key: m.section_key || m.member_name || "default",
    cutlength_m: m.cutlength_m,
    count: m.number * m.qty,
    unit_weight_kg_per_m: m.unit_weight_kg_per_m || 0,
  }));
  return optimizeCuts(packMembers, bar);
}

// ---- Resolution adapters (DB rows -> engine inputs) ----

export interface ResolvableMember {
  cutlength_m: number;
  number: number;
  qty: number;
  unit_weight_kg_per_m: number | null;
  member_name?: string;
  section_id?: string | null;
}

export interface ResolvableMaterial {
  qty: number;
  rate_override: number | null;
  is_infill: boolean;
  material_id?: string | null;
  name?: string;
  is_sealant?: boolean;
  perimeter_m?: number | null;
  structural_bite_mm?: number | null;
  glueline_mm?: number | null;
  tube_volume_ml?: number | null;
}

/** Resolve a member's unit weight: member value, else the linked section default. */
export function resolveMember(
  m: ResolvableMember,
  sectionDefaultWeight?: number | null
): MemberInput {
  return {
    member_name: m.member_name,
    cutlength_m: Number(m.cutlength_m) || 0,
    number: Number(m.number) || 0,
    qty: Number(m.qty) || 0,
    unit_weight_kg_per_m:
      m.unit_weight_kg_per_m != null
        ? Number(m.unit_weight_kg_per_m)
        : Number(sectionDefaultWeight) || 0,
    section_key: m.section_id ?? m.member_name ?? "default",
  };
}

/** Resolve a material line's rate: rate_override, else material default_rate. */
export function resolveMaterial(
  m: ResolvableMaterial,
  materialDefaultRate?: number | null
): MaterialInput {
  return {
    name: m.name,
    qty: Number(m.qty) || 0,
    rate: m.rate_override != null ? Number(m.rate_override) : Number(materialDefaultRate) || 0,
    is_infill: !!m.is_infill,
    is_sealant: !!m.is_sealant,
    perimeter_m: m.perimeter_m,
    structural_bite_mm: m.structural_bite_mm,
    glueline_mm: m.glueline_mm,
    tube_volume_ml: m.tube_volume_ml,
  };
}

export const formatINR = (n: number, dp = 2) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
