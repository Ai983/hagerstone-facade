import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Ruler, AlertTriangle, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { runElevationTakeoff, fileToBase64, CONFIDENCE_THRESHOLD } from "@/lib/elevationTakeoff";
import { fetchSystems, fetchAiConfig, computeSystemCurrentRate, logAiRun, type EstimateLineDraft } from "@/lib/facadeApi";

/**
 * Step "Drawings → estimate": upload a drawing PDF (export the CAD/AutoCAD to PDF),
 * the AI reads each elevation's area + system, high-confidence lines auto-fill and
 * low-confidence lines are flagged for manual review. Reused by Tender + Project.
 */
export function DrawingTakeoffPanel({ refId, onAddLines }: { refId: string; onAddLines: (lines: EstimateLineDraft[]) => void }) {
  const { user, canCreate } = useAuth();
  const sysQ = useQuery({ queryKey: ["systems"], queryFn: fetchSystems });
  const aiQ = useQuery({ queryKey: ["aiConfig"], queryFn: fetchAiConfig });
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<any[]>([]);

  const cfg = aiQ.data?.takeoff ?? { enabled: true, threshold: CONFIDENCE_THRESHOLD };
  if (!canCreate || !cfg.enabled) return null;

  const onFiles = async (files: FileList) => {
    const pdfs = Array.from(files).filter((f) => /\.pdf$/i.test(f.name));
    const bad = Array.from(files).length - pdfs.length;
    if (bad > 0) toast.warning(`${bad} file(s) skip kiye — sirf PDF allowed hai`);
    if (!pdfs.length) return;
    setBusy(true);
    try {
      const sys = (sysQ.data ?? []).map((s) => ({ code: s.code, name: s.name, category: s.category }));
      const results = await Promise.all(
        pdfs.map(async (file) => {
          const b64 = await fileToBase64(file);
          const res = await runElevationTakeoff(b64, sys);
          await logAiRun({ feature: "takeoff", input_ref: refId, output: res, confidence: res.overall_confidence, confidence_reason: res.notes ?? "", accepted: false, actor_id: user?.id ?? null });
          return { file: file.name, res };
        })
      );
      const merged = results.flatMap(({ file, res }) =>
        res.lines.map((l) => ({ ...l, _source: file, _accept: l.confidence >= (cfg.threshold ?? CONFIDENCE_THRESHOLD) }))
      );
      setLines(merged);
      const total = merged.length;
      toast.success(`${pdfs.length} PDF${pdfs.length > 1 ? "s" : ""} se ${total} elevations padhe`);
    } catch (e: any) { toast.error(`Drawing padhne me dikkat: ${e.message ?? e}`); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const acceptSelected = async () => {
    const chosen = lines.filter((l) => l._accept);
    if (!chosen.length) { toast.error("Kam se kam ek line chunein"); return; }
    const sysByCode = Object.fromEntries((sysQ.data ?? []).map((s) => [s.code, s]));
    const out: EstimateLineDraft[] = [];
    for (const l of chosen) {
      const sys = sysByCode[l.system_code];
      let rate = 0;
      if (sys) { try { const r = await computeSystemCurrentRate(sys.id); if (r) rate = Number(r.rate_per_sqm.toFixed(4)); } catch { /* */ } }
      const isAuto = l.confidence >= (cfg.threshold ?? CONFIDENCE_THRESHOLD);
      out.push({
        system_id: sys?.id ?? null, elevation_ref: l.elevation_ref, area_sqm: Number(l.area_sqm) || 0,
        rate_per_sqm: rate, notes: null, area_source: isAuto ? "ai" : "manual",
        ai_confidence: l.confidence, ai_confidence_reason: l.confidence_reason,
      });
    }
    onAddLines(out);
    await logAiRun({ feature: "takeoff", input_ref: refId, output: { accepted: chosen.length }, confidence: 0, confidence_reason: "accepted into estimate", accepted: true, actor_id: user?.id ?? null });
    toast.success(`${out.length} lines added — review & Save`);
    setLines([]);
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Ruler className="h-4 w-4" /> Drawing se area nikalo (AI)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">AutoCAD drawing ko PDF me export karke upload karein. AI har elevation ka area + system padhega. Zyada bharosa wali line apne aap bharegi, kam bharosa wali "dekhein" ke saath. Aapke confirm karne par hi estimate me jaayegi.</p>
        <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); }} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}Drawing PDFs upload karein</Button>

        {lines.length > 0 && (
          <div className="space-y-1.5">
            {lines.map((l, i) => {
              const low = l.confidence < (cfg.threshold ?? CONFIDENCE_THRESHOLD);
              return (
                <div key={i} className={`text-xs border rounded-md px-2 py-1.5 flex items-start gap-2 ${low ? "border-amber-500/40 bg-amber-500/5" : "border-border"}`}>
                  <input type="checkbox" className="mt-0.5" checked={!!l._accept} onChange={(e) => setLines((a) => a.map((x, j) => j === i ? { ...x, _accept: e.target.checked } : x))} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="font-mono text-[10px]">{l.system_code}</Badge>
                      <span className="font-medium">{l.elevation_ref ?? "—"}</span>
                      <span>{l.area_sqm} sqm</span>
                      {low && <span className="text-amber-600 flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />dekhein</span>}
                    </div>
                    <span className="text-muted-foreground">bharosa {l.confidence}%{l.confidence_reason ? ` · ${l.confidence_reason}` : ""}{l._source ? ` · ${l._source}` : ""}</span>
                  </div>
                </div>
              );
            })}
            <Button size="sm" onClick={acceptSelected}>Chune hue estimate me daalein</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
