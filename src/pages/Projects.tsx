import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FolderKanban, Plus, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchProjects, createProject } from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";

const STATUS_COLOR: Record<string, string> = {
  enquiry: "bg-slate-500/15 text-slate-600", estimating: "bg-blue-500/15 text-blue-600",
  quoted: "bg-amber-500/15 text-amber-600", approved: "bg-emerald-500/15 text-emerald-600",
  in_execution: "bg-violet-500/15 text-violet-600", completed: "bg-emerald-500/15 text-emerald-700",
  lost: "bg-destructive/15 text-destructive",
};

export default function Projects() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();
  const { data: projects, isLoading } = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_name: "", project_name: "", location: "", site_address: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.client_name || !form.project_name) { toast.error("Client aur project ka naam zaroori hai"); return; }
    setBusy(true);
    try {
      const p = await createProject({ ...form, created_by: user?.id ?? null });
      await logAudit("project", p.id, "create", user?.id ?? null, { code: p.code });
      toast.success(`${p.code} ban gaya`);
      setOpen(false); setForm({ client_name: "", project_name: "", location: "", site_address: "" });
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${p.id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FolderKanban className="h-6 w-6 text-primary" /> Projects (Kaam)</h1>
            <p className="text-muted-foreground text-sm mt-1">Poochh-taachh → estimate → quotation → kaam.</p>
          </div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Naya Project</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Naya Project banayein</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>Client ka naam *</Label><Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Project ka naam *</Label><Input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Jagah (Location)</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Site ka pata</Label><Input value={form.site_address} onChange={(e) => setForm({ ...form, site_address: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Banayein"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}

        <div className="space-y-2">
          {projects?.map((p) => (
            <Card key={p.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/projects/${p.id}`)}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className="font-mono">{p.code}</Badge>
                  <div>
                    <p className="font-medium text-sm">{p.project_name}</p>
                    <p className="text-xs text-muted-foreground">{p.client_name}{p.location ? ` · ${p.location}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? "bg-muted"}`}>{p.status}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
          {projects && projects.length === 0 && <p className="text-sm text-muted-foreground">Abhi koi project nahi hai. "Naya Project" par click karein.</p>}
        </div>
      </div>
    </Layout>
  );
}
