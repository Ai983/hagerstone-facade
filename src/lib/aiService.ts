// Supplementary AI layer (AI-2 scope, AI-3 price parse, AI-4 review, AI-5 NL draft).
// All calls go through the Claude proxy edge function — never the browser → API.
// Confidence contract: every response carries {confidence, confidence_reason};
// callers gate on ai_config.confidence_threshold. Nothing here finalises a price
// or quantity — outputs are proposals for human acceptance.
import { callClaude } from "@/lib/claudeProxy";

function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(s, e + 1));
}

const MODEL = "claude-sonnet-4-6";

export interface ScopeItem {
  description: string; system_guess: string | null; area_sqm: number | null;
  spec_notes: string | null; confidence: number; flagged: boolean;
}
export interface ScopeResult { items: ScopeItem[]; overall_confidence: number; confidence_reason: string; }

/** AI-2: parse a tender BOQ/spec into scope items + flag ambiguous/missed scope. */
export async function extractTenderScope(text: string, systemCodes: string[]): Promise<ScopeResult> {
  const prompt = `You are a facade estimator reviewing a client tender / BOQ / spec.
Extract each facade scope item. Map each to one of these system codes if possible: ${systemCodes.join(", ")}.
FLAG (flagged=true) anything ambiguous, under-specified, or that looks like commonly-missed scope
(e.g. unspecified glass spec, missing finishes, edge/corner conditions, access/scaffold).
Return ONLY JSON:
{"items":[{"description":"...","system_guess":"SG","area_sqm":123.4,"spec_notes":"...","confidence":80,"flagged":false}],"overall_confidence":75,"confidence_reason":"..."}
If quantities are not stated, set area_sqm null and lower confidence. Never invent numbers.

TENDER TEXT:
${text.slice(0, 60000)}`;
  const res = await callClaude({ model: MODEL, max_tokens: 3000, messages: [{ role: "user", content: prompt }] });
  const out = extractJson(res.content?.map((c) => c.text).join("\n") ?? "");
  return {
    items: (out.items ?? []).map((i: any) => ({
      description: String(i.description ?? ""), system_guess: i.system_guess ?? null,
      area_sqm: i.area_sqm != null ? Number(i.area_sqm) : null, spec_notes: i.spec_notes ?? null,
      confidence: Math.max(0, Math.min(100, Number(i.confidence) || 0)), flagged: !!i.flagged,
    })),
    overall_confidence: Math.max(0, Math.min(100, Number(out.overall_confidence) || 0)),
    confidence_reason: String(out.confidence_reason ?? ""),
  };
}

export interface PriceItem { material_name: string; proposed_rate: number; unit: string | null; confidence: number; }
export interface PriceResult { items: PriceItem[]; overall_confidence: number; confidence_reason: string; }

/** AI-3: parse a supplier quote/email into per-material price proposals. */
export async function parseSupplierPrices(text: string, materialNames: string[]): Promise<PriceResult> {
  const prompt = `You are parsing a supplier quotation/email for facade materials.
Extract each quoted material and its unit rate. Match the material name to one of these known materials when possible: ${materialNames.join("; ")}.
Return ONLY JSON:
{"items":[{"material_name":"EPDM Gasket","proposed_rate":62.5,"unit":"mtr","confidence":85}],"overall_confidence":80,"confidence_reason":"..."}
Use the known material name in material_name when you can match it. Never invent prices not in the text.

SUPPLIER TEXT:
${text.slice(0, 40000)}`;
  const res = await callClaude({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
  const out = extractJson(res.content?.map((c) => c.text).join("\n") ?? "");
  return {
    items: (out.items ?? []).map((i: any) => ({
      material_name: String(i.material_name ?? ""), proposed_rate: Number(i.proposed_rate) || 0,
      unit: i.unit ?? null, confidence: Math.max(0, Math.min(100, Number(i.confidence) || 0)),
    })),
    overall_confidence: Math.max(0, Math.min(100, Number(out.overall_confidence) || 0)),
    confidence_reason: String(out.confidence_reason ?? ""),
  };
}

export interface ReviewFinding { severity: "info" | "warn" | "high"; message: string; }
export interface ReviewResult { findings: ReviewFinding[]; risk_summary: string; }

/** AI-4: second-checker. Advisory review of a finished estimate — changes no number. */
export async function reviewEstimate(payload: unknown): Promise<ReviewResult> {
  const prompt = `You are a senior facade estimator doing a second-check of a finished estimate (JSON below).
Point out omissions and risks: missing freight/labour on a line, margin below floor, no escalation clause,
labour/wastage that looks off, scope that looks thin. Be specific and reference line/system where possible.
You must NOT output any corrected numbers — advisory only.
Return ONLY JSON: {"findings":[{"severity":"warn","message":"..."}],"risk_summary":"one short paragraph"}

ESTIMATE:
${JSON.stringify(payload).slice(0, 40000)}`;
  const res = await callClaude({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
  const out = extractJson(res.content?.map((c) => c.text).join("\n") ?? "");
  return {
    findings: (out.findings ?? []).map((f: any) => ({ severity: (f.severity ?? "info"), message: String(f.message ?? "") })),
    risk_summary: String(out.risk_summary ?? ""),
  };
}

export interface NlDraftLine { system_code: string | null; area_sqm: number; oh_profit_pct: number | null; notes: string | null; confidence: number; }
export interface NlDraftResult { lines: NlDraftLine[]; confidence: number; confidence_reason: string; }

/** AI-5: draft estimate lines from a natural-language brief. */
export async function draftFromBrief(brief: string, systemCodes: string[]): Promise<NlDraftResult> {
  const prompt = `Draft facade estimate lines from this brief. Available system codes: ${systemCodes.join(", ")}.
Return ONLY JSON: {"lines":[{"system_code":"SG","area_sqm":400,"oh_profit_pct":18,"notes":"...","confidence":80}],"confidence":80,"confidence_reason":"..."}
Map to a system code; set area from the brief; leave oh_profit_pct null unless stated. Never invent rates.

BRIEF: ${brief.slice(0, 4000)}`;
  const res = await callClaude({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
  const out = extractJson(res.content?.map((c) => c.text).join("\n") ?? "");
  return {
    lines: (out.lines ?? []).map((l: any) => ({
      system_code: l.system_code ?? null, area_sqm: Number(l.area_sqm) || 0,
      oh_profit_pct: l.oh_profit_pct != null ? Number(l.oh_profit_pct) : null,
      notes: l.notes ?? null, confidence: Math.max(0, Math.min(100, Number(l.confidence) || 0)),
    })),
    confidence: Math.max(0, Math.min(100, Number(out.confidence) || 0)),
    confidence_reason: String(out.confidence_reason ?? ""),
  };
}
