import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShoppingCart, Plus, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchMaterials, nextRef } from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";
import type { Project } from "@/types/facade";

interface ProcurementLine {
  material_id: string;
  description: string;
  quantity: string;
  unit: string;
  specs: string;
}

export function ProcurementPanel({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();
  const matQ = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });

  const [lines, setLines] = useState<ProcurementLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [sentPr, setSentPr] = useState<string | null>(null);

  if (!canCreate) return null;

  const addLine = () => {
    const first = matQ.data?.[0];
    if (!first) return;
    setLines((a) => [...a, {
      material_id: first.id,
      description: first.name,
      quantity: "",
      unit: first.unit,
      specs: "",
    }]);
  };

  const setLine = (i: number, patch: Partial<ProcurementLine>) =>
    setLines((a) => a.map((x, j) => j === i ? { ...x, ...patch } : x));

  const pickMaterial = (i: number, matId: string) => {
    const mat = matQ.data?.find((m) => m.id === matId);
    if (!mat) return;
    setLine(i, { material_id: matId, description: mat.name, unit: mat.unit });
  };

  const send = async () => {
    if (!lines.length) { toast.error("Kam se kam ek material jodein"); return; }
    const invalid = lines.find((l) => !l.quantity || Number(l.quantity) <= 0);
    if (invalid) { toast.error(`"${invalid.description}" ki quantity daalna zaroori hai`); return; }

    setBusy(true);
    try {
      // Call the SECURITY DEFINER function that writes to CPS
      const { data, error } = await supabase.schema("facade").rpc("raise_cps_pr", {
        p_project_code: project.code,
        p_project_site: project.location ?? project.site_address ?? project.project_name,
        p_notes: `Facade project: ${project.project_name} (${project.client_name})`,
        p_lines: lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit: l.unit,
          specs: l.specs || null,
        })),
      });

      if (error) throw error;

      const result = data as { pr_id: string; pr_number: string };

      // Record in facade procurement_requests
      const facadeCode = await nextRef("PR");
      await supabase.from("procurement_requests").insert({
        code: facadeCode,
        project_id: project.id,
        status: "exported",
        exported_to_cps: true,
        exported_at: new Date().toISOString(),
        cps_pr_id: result.pr_id,
        cps_pr_number: result.pr_number,
        export_payload: { lines, pr_number: result.pr_number },
      });

      // Record line items
      const { data: prData } = await supabase
        .from("procurement_requests")
        .select("id")
        .eq("code", facadeCode)
        .single();

      if (prData) {
        await supabase.from("procurement_lines").insert(
          lines.map((l, i) => ({
            request_id: prData.id,
            material_id: l.material_id,
            description: l.description,
            qty: Number(l.quantity),
            unit: l.unit,
            sort_order: i,
          }))
        );
      }

      await logAudit("procurement_request", project.id, "cps_pr_raised", user?.id ?? null, {
        pr_number: result.pr_number, lines: lines.length, project: project.code,
      });

      setSentPr(result.pr_number);
      setLines([]);
      toast.success(`✅ ${result.pr_number} Avisha ke paas CPS mein pahunch gayi!`);
      qc.invalidateQueries({ queryKey: ["project", project.id] });

    } catch (e: any) {
      toast.error(`PR nahi bhaiji: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Procurement Request
        </CardTitle>
        <Button size="sm" variant="outline" onClick={addLine} disabled={!matQ.data?.length}>
          <Plus className="h-3.5 w-3.5 mr-1" />Material jodein
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Jo materials chahiye unhe yahan chunein — "Avisha ko PR bhejo" dabate hi CPS mein
          Purchase Requisition ban jaayegi.
        </p>

        {sentPr && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="text-sm text-emerald-700">
              <b>{sentPr}</b> CPS mein Avisha ke paas bhej di gayi ✅
            </span>
          </div>
        )}

        {lines.length > 0 && (
          <>
            <div className="grid grid-cols-[1.5fr_70px_60px_1fr_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
              <span>Material</span><span>Qty</span><span>Unit</span><span>Specs / vishesh</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1.5fr_70px_60px_1fr_28px] gap-2 items-center">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={l.material_id}
                  onChange={(e) => pickMaterial(i, e.target.value)}
                >
                  {(matQ.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <Input
                  className="h-8"
                  type="number"
                  step="any"
                  placeholder="0"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <Input
                  className="h-8"
                  value={l.unit}
                  onChange={(e) => setLine(i, { unit: e.target.value })}
                />
                <Input
                  className="h-8"
                  placeholder="brand, size, grade..."
                  value={l.specs}
                  onChange={(e) => setLine(i, { specs: e.target.value })}
                />
                <Button
                  size="icon" variant="ghost" className="h-8 w-7"
                  onClick={() => setLines((a) => a.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </>
        )}

        {lines.length === 0 && !sentPr && (
          <p className="text-xs text-muted-foreground">
            "+ Material jodein" dabao aur jo chahiye vo chunein.
          </p>
        )}

        {lines.length > 0 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">{lines.length} material(s) ready</span>
            <Button onClick={send} disabled={busy} className="gap-2">
              {busy
                ? <><Loader2 className="h-4 w-4 animate-spin" />Bhej raha hoon...</>
                : <><ShoppingCart className="h-4 w-4" />Avisha ko PR bhejo (CPS)</>
              }
            </Button>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground border-t pt-2">
          PR Avisha (<Badge variant="outline" className="text-[9px] font-normal">procurement@hagerstone.com</Badge>) ke naam se CPS mein ban jaayegi. Woh CPS mein vendor se quote leke PO banayegi.
        </p>
      </CardContent>
    </Card>
  );
}
