// F6 — elevation PDF → per-system area take-off, via the Claude proxy edge
// function (server-side key, never called from the browser directly).
import { callClaude } from "@/lib/claudeProxy";
import type { FacadeSystem } from "@/types/facade";

export interface TakeoffLine {
  system_code: string;
  system_name?: string;
  elevation_ref: string | null;
  area_sqm: number;
  confidence: number; // 0-100
  confidence_reason: string;
}

export interface TakeoffResult {
  lines: TakeoffLine[];
  overall_confidence: number;
  notes?: string;
}

export const CONFIDENCE_THRESHOLD = 70; // ≥70 auto-fill, <70 manual + warning

/** Read a File into a base64 string (no data-uri prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      resolve(res.includes(",") ? res.split(",")[1] : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function extractJson(text: string): any {
  // strip ```json fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Send the elevation PDF + the catalogue of available systems to Claude and ask
 * for a per-system area take-off following the confidence contract.
 */
export async function runElevationTakeoff(
  pdfBase64: string,
  systems: Pick<FacadeSystem, "code" | "name" | "category">[]
): Promise<TakeoffResult> {
  const sysList = systems.map((s) => `- ${s.code}: ${s.name}${s.category ? ` (${s.category})` : ""}`).join("\n");

  const prompt = `You are a facade estimator. The attached PDF is an architectural elevation drawing.
Identify each facade element/elevation and map it to one of these available systems (use the exact system code):
${sysList}

For every distinct elevation area you can measure or reasonably infer, output one line with:
- system_code (must be one of the codes above)
- elevation_ref (a short label like "E1", "North", or the drawing's grid ref; null if unknown)
- area_sqm (numeric, in square metres)
- confidence (0-100 integer: how sure you are about BOTH the system match and the area)
- confidence_reason (one short sentence)

Return ONLY a JSON object, no prose:
{"lines":[{"system_code":"SG","elevation_ref":"E1","area_sqm":120.5,"confidence":85,"confidence_reason":"..."}],"overall_confidence":80,"notes":"..."}
If you cannot read areas from the drawing, return lines with low confidence and your best estimate.`;

  const res = await callClaude({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const text = res.content?.map((c) => c.text).join("\n") ?? "";
  const parsed = extractJson(text);
  const lines: TakeoffLine[] = (parsed.lines ?? []).map((l: any) => ({
    system_code: String(l.system_code ?? "").toUpperCase(),
    elevation_ref: l.elevation_ref ?? null,
    area_sqm: Number(l.area_sqm) || 0,
    confidence: Math.max(0, Math.min(100, Number(l.confidence) || 0)),
    confidence_reason: String(l.confidence_reason ?? ""),
  }));
  return {
    lines,
    overall_confidence: Math.max(0, Math.min(100, Number(parsed.overall_confidence) || 0)),
    notes: parsed.notes,
  };
}
