// ============================================================================
// Facade rate engine — pure TypeScript implementation of PRD §5.
// Verified against Consumption.xlsx: every seeded system reproduces the sheet's
// Rate/sqm within ₹1 (see scripts/parse-and-verify.mjs and the Verification page).
//
// This is the single source of truth for live calculation in the browser and
// for the snapshot persisted to facade.system_rates.breakdown.
// ============================================================================

export interface RateCardInput {
  aluminium_per_kg: number;
  conversion_per_kg: number;
  powder_coating_per_kg: number;
}

/** A member with its unit weight already resolved (member value, else section default). */
export interface MemberInput {
  member_name?: string;
  cutlength_m: number;
  number: number;
  qty: number;
  unit_weight_kg_per_m: number; // resolved
}

/** A material line with its rate already resolved (rate_override, else material default). */
export interface MaterialInput {
  name?: string;
  qty: number;
  rate: number; // resolved
  is_infill: boolean;
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
  total_alu_kg: number;
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
}

/**
 * Compute the per-sqm rate and full cost build-up for one system.
 * Inputs must have unit weights / material rates already resolved.
 */
export function computeRate(
  system: SystemParamsInput,
  members: MemberInput[],
  materials: MaterialInput[],
  rateCard: RateCardInput
): RateBreakdown {
  // 1) aluminium weight
  const total_alu_kg = members.reduce(
    (s, m) => s + m.cutlength_m * m.number * m.qty * (m.unit_weight_kg_per_m || 0),
    0
  );

  // 2) metal costs
  const aluminium_cost = total_alu_kg * rateCard.aluminium_per_kg;
  const conversion_cost = total_alu_kg * rateCard.conversion_per_kg;
  const coating_cost = system.apply_powder_coating
    ? total_alu_kg * rateCard.powder_coating_per_kg
    : 0;

  // 3) materials split + wastage on infill
  let consumable_total = 0;
  let infill_total = 0;
  for (const m of materials) {
    const line = m.qty * m.rate;
    if (m.is_infill) infill_total += line;
    else consumable_total += line;
  }
  const wastage_cost = infill_total * (system.wastage_pct / 100);

  // 4) material total
  const material_total =
    aluminium_cost + conversion_cost + coating_cost + consumable_total + infill_total + wastage_cost;

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
  };
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
  };
}

export const formatINR = (n: number, dp = 2) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
