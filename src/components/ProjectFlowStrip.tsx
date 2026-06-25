import { useNavigate } from "react-router-dom";
import { FileInput, ScanText, FolderKanban, Wallet, FileSignature, ShoppingCart, PackageCheck, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/facade";

const STEPS = [
  { n: 1, label: "Tender", icon: FileInput },
  { n: 2, label: "Scope", icon: ScanText },
  { n: 3, label: "Project", icon: FolderKanban },
  { n: 4, label: "Budget", icon: Wallet },
  { n: 5, label: "Quotation", icon: FileSignature },
  { n: 6, label: "Procurement", icon: ShoppingCart },
  { n: 7, label: "MRN", icon: PackageCheck },
  { n: 8, label: "Finance", icon: Banknote },
];

/** Map project status -> the step the job has reached (1..8). */
function currentStep(status: string): number {
  switch (status) {
    case "enquiry": return 3;
    case "estimating": return 4;
    case "quoted": return 5;
    case "approved": return 6;
    case "in_execution": return 7;
    case "completed": return 8;
    default: return 3;
  }
}

/**
 * The always-visible Step 1 → 8 progress strip. Shows where the job is and lets
 * the user jump to the Budget sheet. Step 4 (Budget) links to /projects/:id/budget.
 */
export function ProjectFlowStrip({ project }: { project: Project }) {
  const navigate = useNavigate();
  const cur = currentStep(project.status);

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s, i) => {
          const done = s.n < cur;
          const active = s.n === cur;
          const clickable = s.n === 4;
          return (
            <div key={s.n} className="flex items-center shrink-0">
              <button
                disabled={!clickable}
                onClick={() => clickable && navigate(`/projects/${project.id}/budget`)}
                title={clickable ? "Budget sheet kholein" : s.label}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors",
                  active ? "bg-primary text-primary-foreground font-medium"
                    : done ? "bg-primary/10 text-primary"
                    : "text-muted-foreground",
                  clickable && "hover:ring-1 hover:ring-primary cursor-pointer"
                )}
              >
                <s.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:block">{s.n}. {s.label}</span>
                <span className="sm:hidden">{s.n}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn("w-3 h-px", done ? "bg-primary/40" : "bg-border")} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
