import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, XCircle, Loader2 } from "lucide-react";
import {
  fetchSystems, fetchSystemMembers, fetchSystemMaterials, fetchMaterials, fetchSections, fetchActiveRateCard,
  fetchAiConfig, fetchActualAverages,
} from "@/lib/facadeApi";
import { computeRate, resolveMember, resolveMaterial, formatINR } from "@/lib/rateEngine";

// Verified targets from Consumption.xlsx "Rate per sqm"
const EXCEL_RATE: Record<string, number> = {
  SG: 9584.40, CG: 16624.40, LV: 9231.45, ACP: 7754.42, FD: 12978.95, RL: 5824.08,
};

export default function Verification() {
  const { data, isLoading } = useQuery({
    queryKey: ["verification"],
    queryFn: async () => {
      const [systems, materials, sections, rc] = await Promise.all([
        fetchSystems(), fetchMaterials(), fetchSections(), fetchActiveRateCard(),
      ]);
      const matById = Object.fromEntries(materials.map((m) => [m.id, m]));
      const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
      const rows = await Promise.all(systems.map(async (s) => {
        const [mem, mat] = await Promise.all([fetchSystemMembers(s.id), fetchSystemMaterials(s.id)]);
        const b = rc ? computeRate(
          {
            panel_area_sqm: Number(s.panel_area_sqm) || 0, apply_powder_coating: s.apply_powder_coating,
            labour_per_sqm: s.labour_per_sqm, freight_per_sqm: s.freight_per_sqm, wastage_pct: s.wastage_pct,
            design_pct: s.design_pct, misc_pct: s.misc_pct, pmc_pct: s.pmc_pct, oh_profit_pct: s.oh_profit_pct,
          },
          mem.map((m) => resolveMember(m, m.section_id ? secById[m.section_id]?.default_unit_weight_kg_per_m : null)),
          mat.map((m) => resolveMaterial(m, m.material_id ? matById[m.material_id]?.default_rate : null)),
          rc
        ) : null;
        const expected = EXCEL_RATE[s.code];
        const computed = b?.rate_per_sqm ?? 0;
        const delta = expected != null ? Math.abs(computed - expected) : null;
        return { code: s.code, name: s.name, computed, expected, delta, pass: delta != null && delta < 1 };
      }));
      return { rows, hasRateCard: !!rc };
    },
  });

  const allPass = data?.rows.every((r) => r.pass);

  const tier3Q = useQuery({
    queryKey: ["tier3"],
    queryFn: async () => {
      const [cfg, avg] = await Promise.all([fetchAiConfig(), fetchActualAverages()]);
      return { cfg, samples: avg.count };
    },
  });
  const MIN_SAMPLES = 30; // rough floor; PRD: ~12-24 months of clean actuals

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BadgeCheck className="h-6 w-6 text-primary" /> Verification Gate</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Global acceptance gate (PRD §8): every seeded system must reproduce the Excel "Rate per sqm" within ₹1,
            computed by the live TypeScript rate engine.
          </p>
        </div>

        {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
        {data && !data.hasRateCard && <p className="text-sm text-destructive">No active rate card.</p>}

        {data && (
          <>
            <div className={`rounded-lg p-4 flex items-center gap-3 ${allPass ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
              {allPass ? <BadgeCheck className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              <span className="font-semibold">{allPass ? "PASS — all 6 systems within ₹1 of the Excel" : "FAIL — one or more systems exceed ₹1"}</span>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Per-system comparison</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                      <th className="py-2">System</th>
                      <th className="py-2 text-right">Engine rate</th>
                      <th className="py-2 text-right">Excel rate</th>
                      <th className="py-2 text-right">Δ</th>
                      <th className="py-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.code} className="border-b last:border-0">
                        <td className="py-2"><Badge variant="secondary" className="font-mono mr-2">{r.code}</Badge>{r.name}</td>
                        <td className="py-2 text-right tabular-nums">{formatINR(r.computed)}</td>
                        <td className="py-2 text-right tabular-nums">{r.expected != null ? formatINR(r.expected) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{r.delta != null ? `₹${r.delta.toFixed(3)}` : "—"}</td>
                        <td className="py-2 text-right">{r.pass ? <span className="text-emerald-600">✓</span> : <span className="text-destructive">✗</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        {/* Tier 3 AI — gated learning features (ship disabled) */}
        {tier3Q.data && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">AI learning (Tier 3 — gated)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Rate-suggestion, anomaly flagging and variance analysis need ~12–24 months of clean actuals to be trustworthy.
                They ship <b>disabled</b>; enabling early produces confident-but-wrong numbers. Recorded actuals so far: <b>{tier3Q.data.samples}</b> (need ≥ {MIN_SAMPLES}).
              </p>
              {(["rate_suggest", "anomaly", "variance"] as const).map((f) => {
                const enabled = tier3Q.data!.cfg[f]?.enabled;
                const ready = tier3Q.data!.samples >= MIN_SAMPLES;
                return (
                  <div key={f} className="text-xs flex items-center justify-between border border-border rounded px-2 py-1.5">
                    <span className="font-mono">{f}</span>
                    {!enabled ? <span className="text-muted-foreground">disabled (enable in Masters → AI features once data exists)</span>
                      : ready ? <span className="text-emerald-600">active</span>
                      : <span className="text-amber-600">enabled but insufficient historical data — no suggestions shown</span>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
