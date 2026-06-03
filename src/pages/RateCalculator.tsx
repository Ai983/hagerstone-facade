import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchSystems } from "@/lib/facadeApi";
import { Calculator, ChevronRight } from "lucide-react";

export default function RateCalculator() {
  const navigate = useNavigate();
  const { data: systems, isLoading, error } = useQuery({ queryKey: ["systems"], queryFn: fetchSystems });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" /> Rate Nikalo
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kisi system par click karein — member, material aur setting badlein, live rate dekhein, aur snapshot save karein.
          </p>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Systems load ho rahe hain…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {systems?.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => navigate(`/calculator/${s.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="font-mono">{s.code}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-base pt-1">{s.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between"><span>Type</span><span className="text-foreground">{s.category ?? "—"}</span></div>
                <div className="flex justify-between"><span>Panel area</span><span className="text-foreground">{s.panel_area_sqm ?? "—"} sqm</span></div>
                <div className="flex justify-between"><span>Powder coating</span><span className="text-foreground">{s.apply_powder_coating ? "Haan" : "Nahi"}</span></div>
                <div className="flex justify-between"><span>OH &amp; profit</span><span className="text-foreground">{s.oh_profit_pct}%</span></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
