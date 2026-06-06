import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileInput, Plus, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTenders, createTender } from "@/lib/facadeApi";
import { logAudit } from "@/lib/audit";

const STATUS_COLOR: Record<string, string> = {
  received: "bg-slate-500/15 text-slate-600", scoping: "bg-blue-500/15 text-blue-600",
  qualified: "bg-amber-500/15 text-amber-600", converted: "bg-emerald-500/15 text-emerald-600",
  declined: "bg-destructive/15 text-destructive",
};

export default function Tenders() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, canCreate } = useAuth();
  const { data: tenders, isLoading } = useQuery({ queryKey: ["tenders"], queryFn: fetchTenders });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_name: "", tender_name: "", location: "", site_address: "", due_date: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.client_name || !form.tender_name) { toast.error("Client aur tender ka naam zaroori hai"); return; }
    setBusy(true);
    try {
      const t = await createTender({ ...form, due_date: form.due_date || null, created_by: user?.id ?? null });
      await logAudit("tender", t.id, "create", user?.id ?? null, { code: t.code });
      toast.success(`${t.code} ban gaya`);
      setOpen(false); setForm({ client_name: "", tender_name: "", location: "", site_address: "", due_date: "" });
      qc.invalidateQueries({ queryKey: ["tenders"] });
      navigate(`/tenders/${t.id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><FileInput className="h-6 w-6 text-primary" /> Tenders</h1>
            <p className="text-muted-foreground text-sm mt-1">Step 1 — Client ka tender yahan se shuru. Scope nikalo → Project banao.</p>
          </div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Naya Tender</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Naya Tender banayein</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>Client ka naam *</Label><Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Tender ka naam *</Label><Input value={form.tender_name} onChange={(e) => setForm({ ...form, tender_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Jagah (Location)</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Site ka pata</Label><Input value={form.site_address} onChange={(e) => setForm({ ...form, site_address: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Due date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
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
          {tenders?.map((t) => (
            <Card key={t.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/tenders/${t.id}`)}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className="font-mono">{t.code}</Badge>
                  <div>
                    <p className="font-medium text-sm">{t.tender_name}</p>
                    <p className="text-xs text-muted-foreground">{t.client_name}{t.location ? ` · ${t.location}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[t.status] ?? "bg-muted"}`}>{t.status}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
          {tenders && tenders.length === 0 && <p className="text-sm text-muted-foreground">Abhi koi tender nahi hai. "Naya Tender" par click karein.</p>}
        </div>
      </div>
    </Layout>
  );
}
