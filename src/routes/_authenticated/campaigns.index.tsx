import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/BlipxNav";
import { ArrowLeft, Plus, Loader2, Play, Pause, X, Megaphone, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { setCampaignStatus, deleteCampaign } from "@/lib/campaigns.functions";

export const Route = createFileRoute("/_authenticated/campaigns/")({
  head: () => ({ meta: [{ title: "Campaigns · BlipX" }] }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const { data: campaigns, isLoading, refetch } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns")
        .select("*, agents(name), phone_numbers(e164, provider)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const setStatus = useServerFn(setCampaignStatus);
  const remove = useServerFn(deleteCampaign);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, status: "running" | "paused" | "cancelled") => {
    setBusy(id);
    try { await setStatus({ data: { campaignId: id, status } }); toast.success(`Campaign ${status}`); refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  };
  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete campaign "${name}"? All leads will be removed.`)) return;
    setBusy(id);
    try { await remove({ data: { campaignId: id } }); toast.success("Deleted"); refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Logo />
        <Link to="/dashboard" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="display-lg">Campaigns</h1>
            <p className="text-ink-soft mt-2 max-w-xl">Upload a list of leads and let your agent call them. Track every dial live.</p>
          </div>
          <Link to="/campaigns/new" className="pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground">
            <Plus className="size-4" /> New campaign
          </Link>
        </div>

        {isLoading ? <div className="surface-card p-10 text-center"><Loader2 className="size-5 animate-spin mx-auto" /></div>
         : !campaigns?.length ? (
          <div className="surface-card p-12 text-center">
            <Megaphone className="size-8 mx-auto text-ink-soft" />
            <div className="font-display font-bold text-xl mt-3">No campaigns yet.</div>
            <p className="text-ink-soft mt-2">Upload a CSV and your agent will start calling leads for you.</p>
            <Link to="/campaigns/new" className="mt-5 inline-flex pill px-5 py-2.5 text-sm font-semibold bg-foreground text-background">
              Start a campaign
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map((c) => {
              const done = (c.completed ?? 0);
              const total = c.total ?? 0;
              const pct = total ? Math.round((done / total) * 100) : 0;
              const agentName = (c as any).agents?.name ?? "—";
              const num = (c as any).phone_numbers?.e164 ?? "—";
              return (
                <div key={c.id} className="surface-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-display font-bold text-lg truncate">{c.name}</div>
                        <span className={"chip-outline text-[10px] " + statusChip(c.status)}>{c.status}</span>
                      </div>
                      <div className="text-xs text-ink-soft mt-1">
                        {agentName} · from {num} · {total} leads · {done}/{total} dialed ({pct}%)
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-lime" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.status !== "completed" && c.status !== "cancelled" && (
                        c.status === "paused" || c.status === "ready" || c.status === "scheduled"
                          ? <button disabled={busy === c.id} onClick={() => act(c.id, "running")}
                              className="pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-lime text-ink disabled:opacity-50">
                              <Play className="size-3.5" /> Resume
                            </button>
                          : <button disabled={busy === c.id} onClick={() => act(c.id, "paused")}
                              className="pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border hover:bg-muted disabled:opacity-50">
                              <Pause className="size-3.5" /> Pause
                            </button>
                      )}
                      <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }}
                        className="pill inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-foreground text-background">
                        Open <ChevronRight className="size-3.5" />
                      </Link>
                      <button disabled={busy === c.id} onClick={() => onDelete(c.id, c.name)}
                        title="Delete"
                        className="pill inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-border text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function statusChip(status: string) {
  if (status === "running") return "!bg-lime !text-ink !border-lime";
  if (status === "paused") return "!bg-amber-100";
  if (status === "completed") return "!bg-muted";
  if (status === "cancelled") return "!bg-red-50 !text-red-700";
  return "";
}
