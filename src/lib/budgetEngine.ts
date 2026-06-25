// ============================================================================
// Budget engine — pure TypeScript model of the manual "Cash Flow Project Input
// Form" (Cash_Flow Hager Stone.xls). Two layers:
//   1) computeBudget   : cost heads -> total cost -> + markup -> contract value
//   2) computeCashflow : spread each head over its months, apply payment delays
//                        + client advance/retention -> monthly cash in/out,
//                        running balance and interest.
//
// This is DELIBERATELY separate from rateEngine.ts. It never imports or mutates
// the rate engine; the estimate only *seeds* the Material/Production heads. So
// the verified ₹1 rate maths is untouched.
// ============================================================================

export type HeadCalcType = "manual" | "pct_of" | "from_estimate" | "staffing";
export type PctBasis = "material_production" | "total_costs" | "sales" | "none";

export interface BudgetHeadInput {
  head_name: string;
  sort_order?: number;
  calc_type: HeadCalcType;
  value?: number | null;        // stored/entered amount (manual, from_estimate)
  pct_value?: number | null;    // used when calc_type='pct_of'
  pct_basis?: PctBasis | string | null;
  payment_delay_days?: number | null;
  deliver_from_month?: number | null;
  deliver_from_year?: number | null;
  deliver_to_month?: number | null;
  deliver_to_year?: number | null;
}

export interface PmLineInput { qty: number; salary: number; duration_months: number; }
export interface MaterialLineInput { qty: number; rate: number; }

export interface BudgetParams {
  markup_pct: number;
  material_misc_pct: number; // uplift on the material build-up (default 10%)
}

export interface ResolvedHead {
  head_name: string;
  sort_order: number;
  calc_type: HeadCalcType;
  value: number;             // resolved INR amount
  pct_value: number | null;
  pct_basis: string;
  pct_on_costs: number;      // value / total_costs
  payment_delay_days: number;
  deliver_from_month: number | null;
  deliver_from_year: number | null;
  deliver_to_month: number | null;
  deliver_to_year: number | null;
}

export interface BudgetResult {
  heads: ResolvedHead[];
  pm_total: number;
  material_buildup: number;  // Σ material lines (before misc uplift)
  total_costs: number;
  markup_pct: number;
  markup_amount: number;
  contract_value: number;
}

/**
 * Resolve every cost head to an INR amount, then total -> markup -> contract.
 * `pct_of` heads are computed on a base of the non-pct heads (avoids circularity);
 * `material_production` basis uses just the Material + Production heads.
 */
export function computeBudget(
  heads: BudgetHeadInput[],
  pmLines: PmLineInput[],
  materialLines: MaterialLineInput[],
  params: BudgetParams
): BudgetResult {
  const pm_total = pmLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.salary) || 0) * (Number(l.duration_months) || 0), 0);
  const material_buildup = materialLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const materialFromBuildup = material_buildup * (1 + (Number(params.material_misc_pct) || 0) / 100);

  // pass 1: resolve direct (non-pct) heads
  const direct: Record<string, number> = {};
  for (const h of heads) {
    if (h.calc_type === "pct_of") continue;
    let v = Number(h.value) || 0;
    if (h.calc_type === "staffing") v = pm_total;
    else if (h.calc_type === "from_estimate" && /material/i.test(h.head_name) && material_buildup > 0) v = materialFromBuildup;
    direct[h.head_name] = v;
  }
  const directTotal = Object.values(direct).reduce((s, v) => s + v, 0);
  const materialPlusProduction =
    Object.entries(direct)
      .filter(([k]) => /material|production/i.test(k))
      .reduce((s, [, v]) => s + v, 0);

  // pass 2: resolve pct_of heads on the chosen base
  const pctValues: Record<string, number> = {};
  for (const h of heads) {
    if (h.calc_type !== "pct_of") continue;
    const pct = (Number(h.pct_value) || 0) / 100;
    const basis = (h.pct_basis || "total_costs") as string;
    const base = basis === "material_production" ? materialPlusProduction
      : basis === "sales" ? 0 // sales basis resolved post-markup; rare — treat as 0 here
      : directTotal;
    pctValues[h.head_name] = pct * base;
  }

  const total_costs = directTotal + Object.values(pctValues).reduce((s, v) => s + v, 0);
  const markup_pct = Number(params.markup_pct) || 0;
  const markup_amount = total_costs * (markup_pct / 100);
  const contract_value = total_costs + markup_amount;

  const resolved: ResolvedHead[] = heads
    .map((h) => {
      const value = h.calc_type === "pct_of" ? (pctValues[h.head_name] || 0) : (direct[h.head_name] || 0);
      return {
        head_name: h.head_name,
        sort_order: Number(h.sort_order) || 0,
        calc_type: h.calc_type,
        value,
        pct_value: h.pct_value ?? null,
        pct_basis: (h.pct_basis as string) || "none",
        pct_on_costs: total_costs > 0 ? value / total_costs : 0,
        payment_delay_days: Number(h.payment_delay_days) || 0,
        deliver_from_month: h.deliver_from_month ?? null,
        deliver_from_year: h.deliver_from_year ?? null,
        deliver_to_month: h.deliver_to_month ?? null,
        deliver_to_year: h.deliver_to_year ?? null,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  return { heads: resolved, pm_total, material_buildup, total_costs, markup_pct, markup_amount, contract_value };
}

// ---------------- Cash flow ----------------

export interface CashflowParams {
  start_month: number;  // 1-12
  start_year: number;
  end_month: number;
  end_year: number;
  advance_pct: number;
  retention_pct: number;
  creditor_interest_pct: number; // annual %, charged on a negative balance
  invoice_delay_days?: number;   // client payment delay on invoices (default 30)
  retention_release_months?: number; // months after completion (default 0)
}

export interface CashflowRow {
  label: string;       // e.g. "Mar-26"
  month: number;
  year: number;
  cash_out: number;
  cash_in: number;
  net: number;
  balance: number;     // cumulative incl. interest
  interest: number;    // interest charged this month
}

export interface CashflowResult {
  rows: CashflowRow[];
  total_cash_out: number;
  total_cash_in: number;
  total_interest: number;
  peak_negative: number; // most negative balance (financing need)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const idx = (m: number, y: number) => y * 12 + (m - 1);          // absolute month index
const lbl = (i: number) => `${MONTHS[((i % 12) + 12) % 12]}-${String(Math.floor(i / 12)).slice(-2)}`;
const delayMonths = (days: number) => Math.round((Number(days) || 0) / 30);

/**
 * Spread a value linearly across [from..to] (inclusive). Returns a map of
 * absolute-month-index -> amount. Falls back to a single month at `fallback`.
 */
function linearSpread(
  value: number,
  fromM: number | null, fromY: number | null,
  toM: number | null, toY: number | null,
  fallback: number
): Map<number, number> {
  const out = new Map<number, number>();
  if (!value) return out;
  if (!fromM || !fromY || !toM || !toY) { out.set(fallback, value); return out; }
  const a = idx(fromM, fromY), b = idx(toM, toY);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const n = hi - lo + 1;
  const per = value / n;
  for (let i = lo; i <= hi; i++) out.set(i, (out.get(i) || 0) + per);
  return out;
}

const shift = (m: Map<number, number>, by: number): Map<number, number> => {
  if (!by) return m;
  const out = new Map<number, number>();
  for (const [k, v] of m) out.set(k + by, v);
  return out;
};

/**
 * Build the monthly cash-flow projection (the PLAN/VIEW sheets of the Excel).
 * - Cash OUT: each head spread over its delivery window, shifted by its payment delay.
 * - Cash IN : advance up front, the rest invoiced in proportion to economic cost
 *             progress (PoC) shifted by the invoice delay, retention released at the end.
 * - Balance : running cumulative; interest charged monthly on a negative balance.
 */
export function computeCashflow(budget: BudgetResult, p: CashflowParams): CashflowResult {
  const startIx = idx(p.start_month, p.start_year);
  const endIx = idx(p.end_month, p.end_year);

  // ----- cash out (economic spread shifted by payment delay) -----
  const economic = new Map<number, number>(); // for PoC
  const cashOut = new Map<number, number>();
  for (const h of budget.heads) {
    if (!h.value) continue;
    const eco = linearSpread(h.value, h.deliver_from_month, h.deliver_from_year, h.deliver_to_month, h.deliver_to_year, startIx);
    for (const [k, v] of eco) economic.set(k, (economic.get(k) || 0) + v);
    const fin = shift(eco, delayMonths(h.payment_delay_days));
    for (const [k, v] of fin) cashOut.set(k, (cashOut.get(k) || 0) + v);
  }

  // ----- cash in -----
  const advance = budget.contract_value * (Number(p.advance_pct) || 0) / 100;
  const retention = budget.contract_value * (Number(p.retention_pct) || 0) / 100;
  const invoiceable = budget.contract_value - advance - retention;
  const invDelay = delayMonths(p.invoice_delay_days ?? 30);
  const cashIn = new Map<number, number>();

  // advance at the first delivery month (+ its delay handled as 0 here)
  cashIn.set(startIx, (cashIn.get(startIx) || 0) + advance);

  // invoice the balance in proportion to economic cost progress, shifted by the client delay
  if (budget.total_costs > 0 && invoiceable > 0) {
    for (const [k, v] of economic) {
      const portion = invoiceable * (v / budget.total_costs);
      cashIn.set(k + invDelay, (cashIn.get(k + invDelay) || 0) + portion);
    }
  }
  // retention released after completion
  if (retention > 0) {
    const rk = endIx + (p.retention_release_months ?? 0) + invDelay;
    cashIn.set(rk, (cashIn.get(rk) || 0) + retention);
  }

  // ----- assemble the timeline -----
  const keys = new Set<number>([startIx, endIx]);
  for (const k of cashOut.keys()) keys.add(k);
  for (const k of cashIn.keys()) keys.add(k);
  const lo = Math.min(...keys), hi = Math.max(...keys);

  const rows: CashflowRow[] = [];
  let balance = 0, total_interest = 0, total_cash_out = 0, total_cash_in = 0, peak_negative = 0;
  const monthlyRate = (Number(p.creditor_interest_pct) || 0) / 100 / 12;

  for (let i = lo; i <= hi; i++) {
    const out = cashOut.get(i) || 0;
    const inn = cashIn.get(i) || 0;
    const net = inn - out;
    const opening = balance;
    const interest = opening < 0 ? -opening * monthlyRate : 0;
    balance = opening + net - interest;
    total_cash_out += out; total_cash_in += inn; total_interest += interest;
    if (balance < peak_negative) peak_negative = balance;
    rows.push({ label: lbl(i), month: ((i % 12) + 12) % 12 + 1, year: Math.floor(i / 12), cash_out: out, cash_in: inn, net, balance, interest });
  }

  return { rows, total_cash_out, total_cash_in, total_interest, peak_negative };
}

export const formatINR0 = (n: number) =>
  "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
