import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Building2, Calculator, Database, BadgeCheck, LogOut, LayoutDashboard, FolderKanban, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/calculator", label: "Rate Calculator", icon: Calculator },
  { to: "/assemblies", label: "Assemblies", icon: Boxes },
  { to: "/masters", label: "Masters", icon: Database },
  { to: "/verification", label: "Verification", icon: BadgeCheck },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut, canViewMargin } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-4.5 w-4.5 text-primary" />
            </div>
            <span className="font-semibold text-sm hidden sm:block">Facade System</span>
          </div>
          <nav className="flex items-center gap-1 flex-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                    isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )
                }
              >
                <n.icon className="h-4 w-4" />
                <span className="hidden md:block">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium leading-tight">{user?.name}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {user?.role}{canViewMargin ? " · margin" : ""}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => signOut().then(() => navigate("/login"))} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
