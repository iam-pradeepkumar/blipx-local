import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/BlipxNav";
import { ArrowLeft, Loader2, Play, Pause, PhoneCall, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dialNextLead, setCampaignStatus } from "@/lib/campaigns.functions";

export const Route = createFileRoute("/_authenticated/campaigns/$campaignId")({
  head: () => ({ meta: [{ title: "Campaign · BlipX" }] }),
  component: CampaignDashboard,
});

function CampaignDashboard() {
  const { campaignId } = useParams({ from: "/_authenticated/campaigns/$campaignId" });
  const qc = useQueryClient();
  const dial = useServerFn(dialNextLead);
  const setStatus = useServerFn(setCampaignStatus);

  const { data: campaign, refetch: refetchCamp } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaigns")
        .select("*, agents(name), phone_numbers(e164, provider)")
        .eq("id", campaignId).maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 4000,
  });
  const { data: leads } = useQuery({
    queryKey: ["campaign_leads", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_leads").select("*")
        .eq("campaign_id", campaignId).order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 4000,
  });

  const [dialing, setDialing] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const autoRef = useRef<any>(null);

  const dialOne = async () => {
    setDialing(true);
    try {
      const res: any = await dial({ data: { campaignId } });
      if (res.dialed) toast.success(`Dialing ${res.lead?.phone}`);
      else if (res.reason === "no-eligible-leads") { toast.info("No eligible leads right now"); setAutoRun(false); }
      else toast.warning(res.reason ?? "Skipped");
      refetchCamp();
      qc.invalidateQueries({ queryKey: ["campaign_leads", campaignId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Dial failed"); setAutoRun(false); }
    finally { setDialing(false); }
  };

  useEffect(() => {
    if (!autoRun) { if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; } return; }
    autoRef.current = setInterval(() => { if (!dialing) void dialOne(); }, 8000);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, dialing]);

  const changeStatus = async (status: "running" | "paused" | "cancelled") => {
    try { await setStatus({ data: { campaignId, status } }); toast.success(status); refetchCamp(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  if (!campaign) return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-ink-soft" /></div>;

  const total = campaign.total ?? 0;
  const done = campaign.completed ?? 0;
  const connected = campaign.connected ?? 0;
  const failed = campaign.failed ?? 0;
  const pending = (leads ?? []).filter((l) => l.status === "pending").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Logo />
        <Link to="/campaigns" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Campaigns
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16 space-y-6">
        <div className="surface-card p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="chip-outline text-[10px]">{campaign.status}</span>
              <h1 className="font-display font-bold text-2xl mt-2">{campaign.name}</h1>
              <p className="text-sm text-ink-soft">
                Agent {(campaign as any).agents?.name ?? "—"} · dialing from {(campaign as any).phone_numbers?.e164 ?? "—"} · {campaign.max_attempts} attempts · retry {campaign.retry_delay_min}m
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={dialOne} disabled={dialing}
                className="pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60">
                {dialing ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />} Dial next
              </button>
              <button onClick={() => setAutoRun((v) => !v)}
                className={"pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold " +
                  (autoRun ? "bg-lime text-ink" : "border border-border hover:bg-muted")}>
                {autoRun ? <Pause className="size-4" /> : <Play className="size-4" />} {autoRun ? "Auto-dialing…" : "Auto-dial"}
              </button>
              {campaign.status !== "cancelled" && (
                <button onClick={() => changeStatus("cancelled")}
                  className="pill inline-flex items-center gap-2 px-3 py-2 text-xs border border-border text-red-600 hover:bg-red-50">
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Total leads" value={total.toString()} />
            <Stat label="Dialed" value={done.toString()} />
            <Stat label="Connected" value={connected.toString()} />
            <Stat label="Pending" value={pending.toString()} />
            <Stat label="Failed" value={failed.toString()} />
          </div>

          <div className="mt-5 h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-lime transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs text-ink-soft mt-2">{done}/{total} dialed · {pct}%</div>
        </div>

        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-border">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Last error / outcome</th>
              </tr>
            </thead>
            <tbody>
              {(leads ?? []).map((l) => (
                <tr key={l.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">{l.name || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.phone}</td>
                  <td className="px-4 py-3"><span className={"chip-outline text-[10px] " + leadChip(l.status)}>{l.status}</span></td>
                  <td className="px-4 py-3">{l.attempts}/{campaign.max_attempts}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft max-w-md truncate">{l.last_error ?? l.outcome ?? "—"}</td>
                </tr>
              ))}
              {(!leads || leads.length === 0) && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-soft">No leads.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border p-4 bg-surface">
      <div className="text-[10px] uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="font-display font-bold text-2xl mt-1">{value}</div>
    </div>
  );
}

function leadChip(status: string) {
  if (status === "connected" || status === "completed") return "!bg-lime !text-ink !border-lime";
  if (status === "dialing") return "!bg-amber-100";
  if (status === "failed" || status === "opted_out" || status === "do_not_call") return "!bg-red-50 !text-red-700";
  return "";
}
