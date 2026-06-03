// Row types for the facade schema (hand-mapped to facade_001_init.sql).
import type { RateBreakdown } from "@/lib/rateEngine";

export interface Section {
  id: string;
  section_no: string;
  name: string;
  default_unit_weight_kg_per_m: number | null;
  finish: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type MaterialCategory =
  | "aluminium" | "conversion" | "coating" | "silicone" | "fastener"
  | "screw" | "gasket" | "bracket" | "glass" | "acp" | "dgu" | "hardware" | "other";

export type MaterialUnit = "kg" | "m" | "mtr" | "bottle" | "pcs" | "sqm" | "set";

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory | string;
  unit: MaterialUnit | string;
  default_rate: number;
  is_infill: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RateCard {
  id: string;
  name: string;
  effective_from: string;
  aluminium_per_kg: number;
  conversion_per_kg: number;
  powder_coating_per_kg: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface FacadeSystem {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  panel_width_mm: number | null;
  panel_height_mm: number | null;
  panel_area_sqm: number | null;
  apply_powder_coating: boolean;
  labour_per_sqm: number;
  freight_per_sqm: number;
  wastage_pct: number;
  design_pct: number;
  misc_pct: number;
  pmc_pct: number;
  oh_profit_pct: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SystemMember {
  id: string;
  system_id: string;
  section_id: string | null;
  member_name: string;
  cutlength_m: number;
  number: number;
  qty: number;
  unit_weight_kg_per_m: number | null;
  sort_order: number;
}

export interface SystemMaterial {
  id: string;
  system_id: string;
  material_id: string | null;
  qty: number;
  rate_override: number | null;
  is_infill: boolean;
  wastage_applies: boolean;
  sort_order: number;
}

export interface SystemRate {
  id: string;
  system_id: string;
  rate_card_id: string | null;
  rate_per_sqm: number;
  breakdown: RateBreakdown | null;
  computed_at: string;
  computed_by: string | null;
}

export type ProjectStatus =
  | "enquiry" | "estimating" | "quoted" | "approved" | "in_execution" | "completed" | "lost";

export interface Project {
  id: string;
  code: string;
  client_name: string;
  project_name: string;
  location: string | null;
  site_address: string | null;
  status: ProjectStatus | string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Estimate {
  id: string;
  code: string;
  project_id: string;
  version: number;
  status: string;
  total_amount: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface EstimateLine {
  id: string;
  estimate_id: string;
  system_id: string | null;
  elevation_ref: string | null;
  area_sqm: number;
  rate_per_sqm: number;
  amount: number; // generated (area_sqm * rate_per_sqm)
  notes: string | null;
  sort_order: number;
  area_source: string; // manual|ai
  ai_confidence: number | null;
  ai_confidence_reason: string | null;
}

export interface Quotation {
  id: string;
  code: string;
  project_id: string;
  estimate_id: string | null;
  status: string; // draft|sent|approved|rejected|expired
  valid_until: string | null;
  terms: string | null;
  total_amount: number;
  created_by: string | null;
  created_at: string;
}

export interface QuotationLine {
  id: string;
  quotation_id: string;
  description: string;
  system_id: string | null;
  area_sqm: number | null;
  rate_per_sqm: number | null;
  amount: number | null;
  sort_order: number;
}

export interface ProjectStage {
  id: string;
  project_id: string;
  stage: string;
  status: string; // pending|in_progress|completed|blocked
  owner_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  sort_order: number;
}

export interface EmployeeLite {
  id: string;
  name: string;
  role: string | null;
}

export interface ProcurementRequest {
  id: string;
  code: string;
  project_id: string;
  status: string;
  exported_to_cps: boolean;
  export_payload: unknown | null;
  exported_at: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  code: string;
  project_id: string;
  payment_type: string; // client_invoice|vendor_payment
  party_name: string | null;
  amount: number;
  status: string;
  exported_to_finance: boolean;
  export_payload: unknown | null;
  exported_at: string | null;
  created_at: string;
}

export interface BomLine {
  material_id: string | null;
  description: string;
  qty: number;
  unit: string;
}

export type { RateBreakdown };
