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
  // A2 sheet dims (for 2D nesting)
  sheet_width_mm?: number | null;
  sheet_height_mm?: number | null;
  sheet_edge_trim_mm?: number | null;
}

export interface InfillPiece {
  id: string;
  system_id: string | null;
  assembly_id: string | null;
  estimate_line_id: string | null;
  material_id: string | null;
  width_mm: number;
  height_mm: number;
  count: number;
  allow_rotation: boolean;
  sort_order: number;
  source: string;
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
  // v1.1
  valid_until: string | null;
  escalation_note: string | null;
  aluminium_basis: "landed" | "stockist" | string;
  freight_handling_pct: number;
  // v1.2 cut-optimization / scrap params
  stock_bar_length_m: number;
  kerf_mm: number;
  bar_trim_mm: number;
  min_usable_offcut_mm: number;
  scrap_recovery_pct: number;
  // supplementary A4/A3
  import_duty_pct: number;
  price_source: string;
}

export interface PriceFeedLog {
  id: string;
  metal: string;
  index_name: string | null;
  value_per_kg_inr: number | null;
  fetched_at: string;
  source_note: string | null;
}

export interface CalcConfigRow {
  id: string;
  key: string;
  num_value: number | null;
  text_value: string | null;
  description: string | null;
  updated_at: string;
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
  // v1.2 toggles
  use_cut_optimization: boolean;
  apply_scrap_credit: boolean;
  // A2 toggle
  use_sheet_optimization: boolean;
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
  // v1.3 sealant bead-volume
  is_sealant: boolean;
  perimeter_m: number | null;
  structural_bite_mm: number | null;
  glueline_mm: number | null;
  tube_volume_ml: number | null;
}

export interface MarkupTier {
  id: string;
  name: string;
  risk_level: string | null;
  markup_pct: number;
  contingency_pct: number;
  is_active: boolean;
  created_at: string;
}

export interface EstimateRevision {
  id: string;
  estimate_id: string;
  snapshot: unknown;
  changed_by: string | null;
  changed_at: string;
  change_note: string | null;
}

export interface SystemRate {
  id: string;
  system_id: string;
  rate_card_id: string | null;
  rate_per_sqm: number;
  breakdown: RateBreakdown | null;
  computed_at: string;
  computed_by: string | null;
  // v1.2
  optimized_wastage_pct: number | null;
  offcut_kg: number | null;
  scrap_credit_amount: number | null;
}

export interface Actual {
  id: string;
  project_id: string;
  estimate_id: string | null;
  total_alu_kg_actual: number | null;
  wastage_pct_actual: number | null;
  labour_cost_actual: number | null;
  freight_cost_actual: number | null;
  material_cost_actual: number | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
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
  // v1.3
  markup_tier_id: string | null;
  contingency_pct: number;
  scenario_label: string | null;
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
  area_source: string; // manual|ai|ai_extracted|ai_override
  ai_confidence: number | null;
  ai_confidence_reason: string | null;
  // A1 assembly instantiation
  assembly_id: string | null;
  inst_width_mm: number | null;
  inst_height_mm: number | null;
  inst_count: number | null;
}

export interface Assembly {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  base_width_mm: number;
  base_height_mm: number;
  apply_powder_coating: boolean;
  labour_per_sqm: number;
  freight_per_sqm: number;
  wastage_pct: number;
  design_pct: number;
  misc_pct: number;
  pmc_pct: number;
  oh_profit_pct: number;
  is_active: boolean;
  use_sheet_optimization?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssemblyMember {
  id: string;
  assembly_id: string;
  section_id: string | null;
  member_name: string;
  orientation: "horizontal" | "vertical" | "fixed" | string;
  base_cutlength_m: number;
  number: number;
  qty: number;
  unit_weight_kg_per_m: number | null;
  sort_order: number;
}

export interface AssemblyMaterial {
  id: string;
  assembly_id: string;
  material_id: string | null;
  qty_per_unit: number;
  is_infill: boolean;
  wastage_applies: boolean;
  sort_order: number;
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
  // v1.1
  price_valid_until: string | null;
  escalation_clause: string | null;
  // Brawn-Globus letter fields
  greeting_name: string | null;
  subject: string | null;
  body_text: string | null;
  price_per_sqft: number | null;
  payment_terms_a: string | null;
  payment_terms_b: string | null;
  payment_terms_c: string | null;
  payment_terms_d: string | null;
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
  cps_pr_id: string | null;
  cps_pr_number: string | null;
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
  // Step 8 finance tracking
  direction: string; // receivable|payable
  mrn_id: string | null;
  due_date: string | null;
  paid_amount: number;
  vendor_gstin: string | null;
  invoice_ref: string | null;
}

export interface BomLine {
  material_id: string | null;
  description: string;
  qty: number;
  unit: string;
}

export interface AiConfigRow {
  id: string;
  feature: string;
  enabled: boolean;
  confidence_threshold: number;
  provider: string;
  notes: string | null;
  updated_at: string;
}

export interface TenderScopeItem {
  id: string;
  project_id: string | null;
  tender_id: string | null;
  document_id: string | null;
  description: string | null;
  system_guess: string | null;
  area_sqm: number | null;
  spec_notes: string | null;
  confidence: number | null;
  flagged: boolean;
  status: string;
  created_at: string;
}

export interface MaterialPriceProposal {
  id: string;
  material_id: string | null;
  proposed_rate: number | null;
  current_rate: number | null;
  source_doc: string | null;
  confidence: number | null;
  status: string;
  decided_by: string | null;
  created_at: string;
}

export interface CompatibilityRule {
  id: string;
  rule_type: string;
  section_id: string | null;
  material_id: string | null;
  min_value: number | null;
  max_value: number | null;
  severity: string;
  message: string | null;
  is_active: boolean;
}

// ---------------- Step 1: Tenders ----------------

export type TenderStatus = "received" | "scoping" | "qualified" | "converted" | "declined";

export interface Tender {
  id: string;
  code: string;
  client_name: string;
  tender_name: string;
  location: string | null;
  site_address: string | null;
  document_ref: string | null;
  due_date: string | null;
  status: TenderStatus | string;
  converted_project_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------- Step 4: Budget Sheet ----------------

export interface BudgetTemplateHead {
  id: string;
  head_name: string;
  sort_order: number;
  calc_type: string; // manual|pct_of|from_estimate|staffing
  pct_value: number | null;
  pct_basis: string | null;
  default_payment_delay_days: number;
  is_active: boolean;
}

export interface Budget {
  id: string;
  code: string;
  project_id: string;
  estimate_id: string | null;
  name: string | null;
  version: number;
  status: string; // draft|approved
  reference_date: string | null;
  start_date: string | null;
  on_site_date: string | null;
  completion_date: string | null;
  markup_pct: number;
  creditor_interest_pct: number;
  debtor_interest_pct: number;
  advance_pct: number;
  retention_pct: number;
  total_costs: number;
  markup_amount: number;
  contract_value: number;
  cashflow_snapshot: unknown | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetHead {
  id: string;
  budget_id: string;
  head_name: string;
  sort_order: number;
  calc_type: string;
  value: number;
  pct_value: number | null;
  pct_basis: string | null;
  payment_delay_days: number;
  deliver_from_month: number | null;
  deliver_from_year: number | null;
  deliver_to_month: number | null;
  deliver_to_year: number | null;
  notes: string | null;
}

export interface BudgetPmLine {
  id: string;
  budget_id: string;
  description: string | null;
  uom: string | null;
  qty: number;
  salary: number;
  duration_months: number;
  amount: number; // generated
  sort_order: number;
}

export interface BudgetMaterialLine {
  id: string;
  budget_id: string;
  description: string | null;
  qty: number;
  uom: string | null;
  rate: number;
  amount: number; // generated
  source: string; // manual|estimate
  sort_order: number;
}

// ---------------- Step 7: MRN ----------------

export interface MaterialReceivingNote {
  id: string;
  code: string;
  project_id: string;
  procurement_request_id: string | null;
  vendor_name: string | null;
  vendor_gstin: string | null;
  invoice_ref: string | null;
  received_date: string | null;
  status: string; // received|partial|verified|rejected
  notes: string | null;
  total_value: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MrnLineItem {
  id: string;
  mrn_id: string;
  procurement_line_id: string | null;
  material_id: string | null;
  description: string | null;
  ordered_qty: number;
  received_qty: number;
  unit: string | null;
  rate: number;
  amount: number; // generated
  sort_order: number;
}

export interface ProcurementLine {
  id: string;
  request_id: string;
  material_id: string | null;
  description: string | null;
  qty: number;
  unit: string | null;
  sort_order: number;
}

export type { RateBreakdown };
