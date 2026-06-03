import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, Database, BadgeCheck, FolderKanban, FileText } from "lucide-react";

const MODULES: Array<{ icon: any; title: string; desc: string; to: string; live: boolean; phase?: string }> = [
  { icon: Calculator, title: "Rate Calculator", desc: "Sections, materials, rate card & live cost build-up", to: "/calculator", live: true },
  { icon: Database, title: "Masters", desc: "Rate card, materials & aluminium sections", to: "/masters", live: true },
  { icon: BadgeCheck, title: "Verification", desc: "₹1 acceptance gate vs the Excel", to: "/verification", live: true },
  { icon: FolderKanban, title: "Projects & Estimates", desc: "Enquiry → estimate (BOQ) → versions", to: "/projects", live: true },
  { icon: FileText, title: "Quotations", desc: "Client quotation + PDF (from a project)", to: "/projects", live: true },
];

export default function Dashboard() {
  const { user, canViewMargin } = useAuth();
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Facade System · {user?.role}{canViewMargin ? " · full margin visibility" : ""}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Card
              key={m.title}
              className={m.live ? "cursor-pointer hover:border-primary/50 transition-colors" : "opacity-70"}
              onClick={() => m.live && navigate(m.to)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <m.icon className="h-5 w-5 text-primary" />
                  {!m.live && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.phase}</span>}
                </div>
                <CardTitle className="text-base pt-2">{m.title}</CardTitle>
              </CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{m.desc}</p></CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
