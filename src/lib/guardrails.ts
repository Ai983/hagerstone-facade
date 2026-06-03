// v1.1 calculator guardrails — validation warnings driven by editable
// thresholds in facade.calc_config. Pure function; UI renders the result.
import type { FacadeSystem, RateCard } from "@/types/facade";

export type Severity = "warn" | "block";
export interface Guard {
  severity: Severity;
  message: string;
}

export interface CalcConfig {
  margin_floor_pct: number;
  wastage_min_pct: number;
  wastage_max_pct: number;
  price_stale_days: number;
}

export const DEFAULT_CALC_CONFIG: CalcConfig = {
  margin_floor_pct: 10,
  wastage_min_pct: 5,
  wastage_max_pct: 20,
  price_stale_days: 14,
};

/**
 * Validate a system's costing parameters against the configured thresholds.
 * `effectiveWastagePct` lets callers pass the cut-optimised wastage later; for
 * v1.1 it's just the system's flat wastage_pct.
 */
export function validateSystem(
  system: Pick<FacadeSystem, "oh_profit_pct" | "wastage_pct" | "labour_per_sqm" | "freight_per_sqm">,
  rateCard: Pick<RateCard, "effective_from"> | null,
  cfg: CalcConfig,
  effectiveWastagePct?: number
): Guard[] {
  const out: Guard[] = [];

  if (Number(system.oh_profit_pct) < cfg.margin_floor_pct) {
    out.push({ severity: "warn", message: `OH & profit ${system.oh_profit_pct}% is below the margin floor (${cfg.margin_floor_pct}%).` });
  }

  const wastage = effectiveWastagePct != null ? effectiveWastagePct : Number(system.wastage_pct);
  if (wastage < cfg.wastage_min_pct) {
    out.push({ severity: "warn", message: `Wastage ${wastage.toFixed(1)}% is below the expected minimum (${cfg.wastage_min_pct}%).` });
  } else if (wastage > cfg.wastage_max_pct) {
    out.push({ severity: "warn", message: `Wastage ${wastage.toFixed(1)}% is above the expected maximum (${cfg.wastage_max_pct}%).` });
  }

  if (Number(system.labour_per_sqm) === 0) {
    out.push({ severity: "warn", message: "Labour per sqm is 0 — did you forget to set it?" });
  }
  if (Number(system.freight_per_sqm) === 0) {
    out.push({ severity: "warn", message: "Freight per sqm is 0 — did you forget to set it?" });
  }

  if (rateCard?.effective_from) {
    const ageDays = (Date.now() - new Date(rateCard.effective_from).getTime()) / 86_400_000;
    if (ageDays > cfg.price_stale_days) {
      out.push({ severity: "warn", message: `Active rate card is ${Math.round(ageDays)} days old (stale after ${cfg.price_stale_days}). Re-confirm prices.` });
    }
  }

  return out;
}

export interface CompatRule {
  section_id: string | null;
  material_id: string | null;
  message: string | null;
  is_active: boolean;
}

/**
 * A5 light compatibility check (warn-only, not engineering): a rule fires when a
 * system uses BOTH the rule's section and material together. No rules → no warnings.
 */
export function checkCompatibility(
  sectionIds: Set<string>, materialIds: Set<string>, rules: CompatRule[]
): Guard[] {
  const out: Guard[] = [];
  for (const r of rules) {
    if (!r.is_active) continue;
    const secHit = !r.section_id || sectionIds.has(r.section_id);
    const matHit = !r.material_id || materialIds.has(r.material_id);
    if (r.section_id && r.material_id && secHit && matHit) {
      out.push({ severity: "warn", message: r.message || "Incompatible section/material pairing." });
    }
  }
  return out;
}
