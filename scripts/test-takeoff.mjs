// End-to-end F6 test: build a synthetic elevation PDF, send it through the
// claude-proxy with the take-off prompt, and verify per-system areas come back
// in the confidence contract.
import { jsPDF } from "jspdf";

const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZnZuZXJyamhxd2lweW9ubmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Nzg3MjAsImV4cCI6MjA5MzQ1NDcyMH0.JFH5Z5mznhJKxNpecM1ebWutIltHzdoTgdDiSL4NM5c";
const URL = "https://tpfvnerrjhqwipyonngf.supabase.co/functions/v1/claude-proxy";

// 1) synthetic elevation drawing
const doc = new jsPDF({ unit: "pt", format: "a4" });
doc.setFontSize(16).text("BUILDING ELEVATION — NORTH FACADE", 40, 50);
doc.setFontSize(11);
doc.text("Elevation E1: Straight Glazing curtain wall, 10.0 m wide x 12.0 m high.", 40, 90);
doc.text("Elevation E2: Aluminium Louvres screen, 4.0 m wide x 5.0 m high.", 40, 115);
doc.text("Elevation E3: ACP cladding band, 10.0 m wide x 2.0 m high.", 40, 140);
doc.rect(40, 170, 200, 240); doc.text("E1", 130, 290);
doc.rect(260, 170, 90, 110); doc.text("E2", 295, 225);
doc.rect(40, 420, 200, 40); doc.text("E3", 130, 444);
const b64 = Buffer.from(doc.output("arraybuffer")).toString("base64");

const systems = "SG: Straight Glazing\nCG: Curved Glazing\nLV: Alu. Louvres\nACP: ACP\nFD: Frameless Doors\nRL: Alu. Railing";
const prompt = `You are a facade estimator. The attached PDF is an architectural elevation drawing.
Map each elevation to one of these systems (exact code):
${systems}
For each elevation output: system_code, elevation_ref, area_sqm (number), confidence (0-100), confidence_reason.
Return ONLY JSON: {"lines":[{"system_code":"SG","elevation_ref":"E1","area_sqm":120,"confidence":85,"confidence_reason":"..."}],"overall_confidence":80}`;

const body = {
  model: "claude-sonnet-4-6",
  max_tokens: 1500,
  messages: [{ role: "user", content: [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
    { type: "text", text: prompt },
  ] }],
};

const res = await fetch(URL, {
  method: "POST",
  headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await res.json();
const text = (data.content ?? []).map((c) => c.text).join("\n");
const m = text.match(/\{[\s\S]*\}/);
if (!m) { console.log("RAW:", text.slice(0, 500)); console.log("NO JSON"); process.exit(1); }
const parsed = JSON.parse(m[0]);
console.log("Take-off lines:");
for (const l of parsed.lines) {
  const tag = l.confidence >= 70 ? "AUTO-FILL" : "MANUAL+WARN";
  console.log(`  ${l.system_code.padEnd(4)} ${String(l.elevation_ref).padEnd(4)} area=${String(l.area_sqm).padStart(7)} sqm  conf=${String(l.confidence).padStart(3)}  → ${tag}`);
}
console.log(`overall_confidence=${parsed.overall_confidence}`);
const ok = parsed.lines?.length > 0 && parsed.lines.every((l) => typeof l.area_sqm === "number" && typeof l.confidence === "number");
console.log(ok ? "F6 OK — areas returned in confidence contract" : "F6 FAIL");
process.exit(ok ? 0 : 1);
