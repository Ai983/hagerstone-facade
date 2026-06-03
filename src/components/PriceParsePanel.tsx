import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Receipt, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { parseSupplierPrices } from "@/lib/aiService";
import {
  fetchMaterials, fetchAiConfig, fetchPriceProposals, insertPriceProposals,
  acceptPriceProposal, rejectPriceProposal, logAiRun,
} from "@/lib/facadeApi";
import { formatINR } from "@/lib/rateEngine";
import { logAudit } from "@/lib/audit";

export function PriceParsePanel() {
  const qc = useQueryClient();
  const { user, canManageRates } = useAuth();
  const matQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const aiQ = useQuery({ queryKey: ["aiConfig"], queryFn: fetchAiConfig });
  const propQ = useQuery({ queryKey: ["priceProposals"], queryFn: fetchPriceProposals });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canManageRates) return null;
  const cfg = aiQ.data?.price_parse ?? { enabled: true, threshold: 70 };
  if (!cfg.enabled) return null;

  const matByName = Object.fromEntries((matQ.data ?? []).map((m) => [m.name.toLowerCase(), m]));
  const matById = Object.fromEntries((matQ.data ?? []).map((m) => [m.id, m]));

  const parse = async () => {
    if (!text.trim()) { toast.error("Paste the supplier quote/email first"); return; }
    setBusy(true);
    try {
      const res = await parseSupplierPrices(text, (matQ.data ?? []).map((m) => m.name));
      const rows = res.items.map((i) => {
        const mat = matByName[i.material_name.toLowerCase()];
        return { material_id: mat?.id ?? null, proposed_rate: i.proposed_rate, current_rate: mat ? Number(mat.default_rate) : null, source_doc: "supplier quote", confidence: i.confidence };
      }).filter((r) => r.material_id);
      if (!rows.length) { toast.error("No known materials matched in the text"); return; }
      await insertPriceProposals(rows);
      await logAiRun({ feature: "price_parse", output: res, confidence: res.overall_confidence, confidence_reason: res.confidence_reason, accepted: false, actor_id: user?.id ?? null });
      toast.success(`${rows.length} price proposals created`);
      setText("");
      qc.invalidateQueries({ queryKey: ["priceProposals"] });
    } catch (e: any) { toast.error(`Parse failed: ${e.message ?? e}`); } finally { setBusy(false); }
  };

  const accept = async (p: any) => {
    if (!p.material_id || p.proposed_rate == null) return;
    const mat = matById[p.material_id];
    if (!confirm(`Update ${mat?.name} default rate ${formatINR(p.current_rate ?? 0)} → ${formatINR(p.proposed_rate)}?`)) return;
    try {
      await acceptPriceProposal(p.id, p.material_id, Number(p.proposed_rate), user?.id ?? null);
      await logAudit("material", p.material_id, "price_from_ai", user?.id ?? null, { from: p.current_rate, to: p.proposed_rate });
      toast.success("Material price updated");
      qc.invalidateQueries({ queryKey: ["priceProposals"] }); qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (e: any) { toast.error(e.message); }
  };
  const reject = async (p: any) => {
    try { await rejectPriceProposal(p.id, user?.id ?? null); qc.invalidateQueries({ queryKey: ["priceProposals"] }); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4" /> Supplier price parsing (AI)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">Paste a supplier quote/email. AI proposes per-material rate updates; you accept each one (audited) before the materials master changes. AI never updates a price silently.</p>
        <Textarea rows={3} value={text} placeholder="Paste supplier quotation / email…" onChange={(e) => setText(e.target.value)} />
        <Button size="sm" onClick={parse} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Receipt className="h-3.5 w-3.5 mr-1" />}Parse prices</Button>

        {propQ.data && propQ.data.length > 0 && (
          <div className="space-y-1.5">
            {propQ.data.map((p) => (
              <div key={p.id} className="text-xs border border-border rounded-md px-2 py-1.5 flex items-center justify-between gap-2">
                <span><b>{matById[p.material_id ?? ""]?.name ?? "Material"}</b> · {formatINR(p.current_rate ?? 0)} → <b className="text-primary">{formatINR(p.proposed_rate ?? 0)}</b> · conf {p.confidence}%</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => accept(p)}>Accept</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => reject(p)}>Reject</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
