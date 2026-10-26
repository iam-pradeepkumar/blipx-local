import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/BlipxNav";
import { ArrowLeft, Loader2, Upload, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createCampaign } from "@/lib/campaigns.functions";

export const Route = createFileRoute("/_authenticated/campaigns/new")({
  head: () => ({ meta: [{ title: "New campaign · BlipX" }] }),
  component: NewCampaignPage,
});

function NewCampaignPage() {
  const navigate = useNavigate();
  const create = useServerFn(createCampaign);
  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("id,name").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: numbers } = useQuery({
    queryKey: ["phone_numbers", "for-campaign"],
    queryFn: async () => {
      const { data, error } = await supabase.from("phone_numbers").select("id,e164,provider").neq("provider", "sip_custom");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [csv, setCsv] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [retryDelay, setRetryDelay] = useState(30);
  const [hoursStart, setHoursStart] = useState("09:00");
  const [hoursEnd, setHoursEnd] = useState("19:00");
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    if (!csv.trim()) return null;
    const lines = csv.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length);
    if (!lines.length) return null;
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const sample = lines.slice(1, 4).map((l) => l.split(","));
    return { headers, sample, rowCount: lines.length - 1 };
  }, [csv]);

  const onFile = async (f: File | null) => {
    if (!f) return;
    if (f.size > 2_000_000) return toast.error("CSV too big (2MB max)");
    setCsv(await f.text());
  };

  const submit = async () => {
    if (!name.trim() || !agentId || !phoneNumberId || !csv.trim()) return toast.error("Fill in every field first");
    setSaving(true);
    try {
      const res = await create({ data: {
        name, agentId, phoneNumberId, csv,
        max_attempts: maxAttempts, retry_delay_min: retryDelay,
        active_hours_start: hoursStart, active_hours_end: hoursEnd,
      } });
      toast.success(`Campaign created with ${res.leadCount} leads`);
      navigate({ to: "/campaigns/$campaignId", params: { campaignId: res.campaign.id } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-4xl mx-auto w-full">
        <Logo />
        <Link to="/campaigns" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Campaigns
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 pb-16 space-y-6">
        <div>
          <h1 className="display-lg">New campaign</h1>
          <p className="text-ink-soft mt-2">Upload a CSV of leads. We'll call them one by one using your agent.</p>
        </div>

        <div className="surface-card p-6 md:p-8 space-y-5">
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <div className="font-display font-semibold text-sm">Campaign name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali cohort — mid-funnel leads"
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
            </label>
            <label className="block">
              <div className="font-display font-semibold text-sm">Agent</div>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm">
                <option value="">— Pick an agent —</option>
                {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="font-display font-semibold text-sm">Caller number</div>
              <select value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm">
                <option value="">— Pick a connected number —</option>
                {(numbers ?? []).map((n) => <option key={n.id} value={n.id}>{n.e164} ({n.provider})</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="font-display font-semibold text-sm">Max attempts per lead</div>
                <input type="number" min={1} max={5} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
              </label>
              <label className="block">
                <div className="font-display font-semibold text-sm">Retry after (min)</div>
                <input type="number" min={1} max={1440} value={retryDelay} onChange={(e) => setRetryDelay(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
              </label>
            </div>
            <label className="block">
              <div className="font-display font-semibold text-sm">Active hours start</div>
              <input type="time" value={hoursStart} onChange={(e) => setHoursStart(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
            </label>
            <label className="block">
              <div className="font-display font-semibold text-sm">Active hours end</div>
              <input type="time" value={hoursEnd} onChange={(e) => setHoursEnd(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
            </label>
          </div>
        </div>

        <div className="surface-card p-6 md:p-8">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center size-11 rounded-2xl bg-foreground text-background"><Upload className="size-5" /></span>
            <div>
              <h2 className="font-display font-bold text-xl">Upload leads</h2>
              <p className="text-sm text-ink-soft">CSV with a `phone` column (any 10-digit Indian number auto-gets +91). Any other column becomes a `{"{{variable}}"}` you can use in the agent script — e.g. `name`, `city`.</p>
            </div>
          </div>

          <label className="mt-5 block cursor-pointer">
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="hidden" />
            <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center hover:bg-muted">
              <Upload className="size-6 mx-auto text-ink-soft" />
              <div className="text-sm font-medium mt-2">Click to upload CSV</div>
              <div className="text-xs text-ink-soft mt-1">Or paste rows below.</div>
            </div>
          </label>

          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6}
            placeholder="name,phone,city&#10;Priya,9876543210,Bengaluru&#10;Rahul,9123456789,Mumbai"
            className="mt-4 w-full font-mono text-xs rounded-2xl border border-input bg-surface px-4 py-3" />

          {preview && (
            <div className="mt-5 rounded-2xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm">
                <Users className="size-4 text-ink-soft" />
                <span className="font-display font-semibold">{preview.rowCount} rows detected</span>
                <span className="text-ink-soft">· columns: {preview.headers.join(", ")}</span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="text-xs w-full">
                  <thead><tr>{preview.headers.map((h) => <th key={h} className="text-left px-2 py-1 border-b border-border">{h}</th>)}</tr></thead>
                  <tbody>{preview.sample.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-1 border-b border-border/50">{c}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={submit} disabled={saving}
            className="pill inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Create campaign
          </button>
        </div>
      </main>
    </div>
  );
}
