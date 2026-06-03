import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ScanText, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractTenderScope } from "@/lib/aiService";
import { fetchSystems, fetchAiConfig, computeSystemCurrentRate, logAiRun, type EstimateLineDraft } from "@/lib/facadeApi";

export function TenderScopePanel({ projectId, onAddLines }: { projectId: string; onAddLines: (lines: EstimateLineDraft[]) => void }) {
  const { user, canCreate } = useAuth();
  const sysQ = useQuery({ queryKey: ["systems"], queryFn: fetchSystems });
  const aiQ = useQuery({ queryKey: ["aiConfig"], queryFn: fetchAiConfig });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const cfg = aiQ.data?.scope ?? { enabled: true, threshold: 70 };
  if (!canCreate) return null;

  const extract = async () => {
    if (!text.trim()) { toast.error("Pehle tender/BOQ ka text paste karein"); return; }
    setBusy(true);
    try {
      const codes = (sysQ.data ?? []).map((s) => s.code);
      const res = await extractTenderScope(text, codes);
      setItems(res.items.map((i) => ({ ...i, _accept: i.confidence >= cfg.threshold && !i.flagged })));
      await logAiRun({ feature: "scope", input_ref: projectId, output: res, confidence: res.overall_confidence, confidence_reason: res.confidence_reason, accepted: false, actor_id: user?.id ?? null });
      toast.success(`${res.items.length} scope items extracted (overall ${res.overall_confidence}%)`);
    } catch (e: any) { toast.error(`Scope extraction failed: ${e.message ?? e}`); } finally { setBusy(false); }
  };

  const acceptSelected = async () => {
    const chosen = items.filter((i) => i._accept);
    if (!chosen.length) { toast.error("Kam se kam ek item chunein"); return; }
    const sysByCode = Object.fromEntries((sysQ.data ?? []).map((s) => [s.code, s]));
    const lines: EstimateLineDraft[] = [];
    for (const it of chosen) {
      const sys = it.system_guess ? sysByCode[it.system_guess] : null;
      let rate = 0;
      if (sys) { try { const r = await computeSystemCurrentRate(sys.id); if (r) rate = Number(r.rate_per_sqm.toFixed(4)); } catch { /* */ } }
      lines.push({
        system_id: sys?.id ?? null, elevation_ref: null, area_sqm: Number(it.area_sqm) || 0,
        rate_per_sqm: rate, notes: it.spec_notes || it.description, area_source: "ai_extracted",
        ai_confidence: it.confidence, ai_confidence_reason: it.description,
      });
    }
    onAddLines(lines);
    await logAiRun({ feature: "scope", input_ref: projectId, output: { accepted: chosen.length }, confidence: 0, confidence_reason: "accepted into estimate", accepted: true, actor_id: user?.id ?? null });
    toast.success(`${lines.length} lines added to the estimate — review & Save`);
    setItems([]); setText("");
  };

  if (!cfg.enabled) return null;

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><ScanText className="h-4 w-4" /> Tender se kaam nikalo (AI)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">Tender/BOQ ka text yahan paste karein. AI items nikaalega aur jo cheez doubtful ya chhooti lage use mark karega. Aapke confirm karne par hi estimate me jaayega. Rate matched system se aata hai; AI rate tay nahi karta.</p>
        <Textarea rows={4} value={text} placeholder="Tender / BOQ / spec ka text paste karein…" onChange={(e) => setText(e.target.value)} />
        <Button size="sm" onClick={extract} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ScanText className="h-3.5 w-3.5 mr-1" />}Kaam nikalo</Button>

        {items.length > 0 && (
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className={`text-xs border rounded-md px-2 py-1.5 flex items-start gap-2 ${it.flagged ? "border-amber-500/40 bg-amber-500/5" : "border-border"}`}>
                <input type="checkbox" className="mt-0.5" checked={!!it._accept} onChange={(e) => setItems((a) => a.map((x, j) => j === i ? { ...x, _accept: e.target.checked } : x))} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {it.system_guess && <Badge variant="secondary" className="font-mono text-[10px]">{it.system_guess}</Badge>}
                    <span className="font-medium">{it.description}</span>
                    {it.flagged && <span className="text-amber-600 flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />dekhein</span>}
                  </div>
                  <span className="text-muted-foreground">{it.area_sqm != null ? `${it.area_sqm} sqm · ` : "qty nahi · "}bharosa {it.confidence}%{it.spec_notes ? ` · ${it.spec_notes}` : ""}</span>
                </div>
              </div>
            ))}
            <Button size="sm" onClick={acceptSelected}>Chune hue estimate me daalein</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
