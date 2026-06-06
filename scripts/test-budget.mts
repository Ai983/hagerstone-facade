// Validates the budget engine (src/lib/budgetEngine.ts) reproduces the manual
// "Cash_Flow Hager Stone.xls" Cost Summary for the Max Hospital job.
// Run: node --experimental-strip-types scripts/test-budget.mts
import { computeBudget, computeCashflow } from "../src/lib/budgetEngine.ts";

// Cost heads as re-keyed from the Excel (Intercompany zeroed as in the sheet;
// Others 14% and Contingency 7% on the direct-cost base reproduce the totals).
const heads = [
  { head_name: "Engineering", sort_order: 1, calc_type: "manual", value: 63_000_000 },
  { head_name: "Project Management", sort_order: 2, calc_type: "manual", value: 60_775_000 },
  { head_name: "Material", sort_order: 3, calc_type: "manual", value: 1_318_196_000 },
  { head_name: "Production", sort_order: 4, calc_type: "manual", value: 51_000_000 },
  { head_name: "Transport, Offsite storage & Packaging", sort_order: 5, calc_type: "manual", value: 85_000_000 },
  { head_name: "Site costs", sort_order: 6, calc_type: "manual", value: 45_450_000 },
  { head_name: "Subcontracting", sort_order: 7, calc_type: "manual", value: 71_400_000 },
  { head_name: "Intercompany charges", sort_order: 8, calc_type: "pct_of", pct_value: 0, pct_basis: "material_production" },
  { head_name: "Others", sort_order: 9, calc_type: "pct_of", pct_value: 14, pct_basis: "total_costs" },
  { head_name: "Contingency", sort_order: 10, calc_type: "pct_of", pct_value: 7, pct_basis: "total_costs" },
] as const;

const r = computeBudget(heads as any, [], [], { markup_pct: 20, material_misc_pct: 10 });

const expect = (label: string, got: number, want: number, tol = 1) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${label.padEnd(22)} got=${Math.round(got).toLocaleString("en-IN").padStart(16)} want=${want.toLocaleString("en-IN").padStart(16)} ${ok ? "✓" : "✗"}`);
  return ok;
};

console.log("Budget engine vs Excel Cost Summary (Max Hospital):");
let pass = true;
pass = expect("Total costs", r.total_costs, 2_050_733_410) && pass;
pass = expect("Markup (20%)", r.markup_amount, 410_146_682) && pass;
pass = expect("Contract value", r.contract_value, 2_460_880_092) && pass;
pass = expect("Others 14%", r.heads.find((h) => h.head_name === "Others")!.value, 237_274_940) && pass;
pass = expect("Contingency", r.heads.find((h) => h.head_name === "Contingency")!.value, 118_637_470) && pass;

// material build-up + 10% misc check (1,198,360,000 -> 1,318,196,000)
const mat = computeBudget(
  [{ head_name: "Material", sort_order: 1, calc_type: "from_estimate" }] as any,
  [],
  [{ qty: 1, rate: 1_198_360_000 }],
  { markup_pct: 0, material_misc_pct: 10 }
);
pass = expect("Material +10% misc", mat.heads[0].value, 1_318_196_000) && pass;

// cash flow smoke: a 3-month toy job, advance 10%, balance ends near contract-cost
const cf = computeCashflow(r, {
  start_month: 1, start_year: 2026, end_month: 3, end_year: 2026,
  advance_pct: 10, retention_pct: 0, creditor_interest_pct: 0, invoice_delay_days: 0,
});
const cfOk = Math.abs(cf.total_cash_in - r.contract_value) < 5 && Math.abs(cf.total_cash_out - r.total_costs) < 5;
console.log(`  cashflow totals      in=${Math.round(cf.total_cash_in).toLocaleString("en-IN")} out=${Math.round(cf.total_cash_out).toLocaleString("en-IN")} ${cfOk ? "✓" : "✗"}`);
pass = cfOk && pass;

console.log(pass ? "ALL PASS (budget engine reproduces the manual sheet)" : "*** FAIL ***");
process.exit(pass ? 0 : 1);
