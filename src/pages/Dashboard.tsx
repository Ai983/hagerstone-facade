import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, Database, BadgeCheck, FolderKanban, FileText } from "lucide-react";

const MODULES: Array<{ icon: any; title: string; desc: string; to: string; live: boolean; phase?: string }> = [
  { icon: FolderKanban, title: "Projects (Kaam)", desc: "Naya kaam banayein, estimate aur quotation banayein", to: "/projects", live: true },
  { icon: Calculator, title: "Rate Nikalo", desc: "System ka rate dekho aur banao (live hisaab)", to: "/calculator", live: true },
  { icon: FileText, title: "Quotation", desc: "Client ke liye quotation + PDF (project se)", to: "/projects", live: true },
  { icon: Database, title: "Settings", desc: "Rate card, material aur aluminium sections", to: "/masters", live: true },
  { icon: BadgeCheck, title: "Jaanch", desc: "Rate Excel se milta hai ya nahi (₹1 ke andar)", to: "/verification", live: true },
];

export default function Dashboard() {
  const { user, canViewMargin } = useAuth();
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Namaste{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Facade System · {user?.role}{canViewMargin ? " · poora margin dikhega" : ""}
          </p>
          <p className="text-muted-foreground text-sm mt-1">Neeche kisi bhi box par click karein:</p>
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
