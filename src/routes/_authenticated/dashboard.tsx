import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/BlipxNav";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { placeTestCall, connectPhoneNumber, assignPhoneNumberToAgent, deletePhoneNumber, type ProviderId } from "@/lib/telephony.functions";
import { deleteAgent } from "@/lib/agent-generate.functions";
import { getMyCredits, rechargeCredits } from "@/lib/credits.functions";
import {
  Activity, History, IndianRupee, Settings, Phone as PhoneIcon,
  Search, Plus, Phone, MessageSquare, LogOut, Loader2, Eye, Trash2, Megaphone, Wallet, X, Pencil,
} from "lucide-react";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · BlipX" }] }),
  component: DashboardPage,
});

type Tab = "agents" | "numbers" | "calls" | "costs" | "credits" | "settings";

function DashboardPage() {
  const [tab, setTab] = useState<Tab>("agents");
  const [showRecharge, setShowRecharge] = useState(false);
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const fetchCredits = useServerFn(getMyCredits);
  const { data: credits, refetch: refetchCredits } = useQuery({
    queryKey: ["my-credits"],
    queryFn: () => fetchCredits(),
    refetchInterval: 30_000,
  });
  const balance = credits?.balance ?? 0;
  const lowBalance = balance < 2;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid lg:grid-cols-[260px_1fr] min-h-screen">
        <aside className="border-r border-border bg-surface px-5 py-6 sticky top-0 h-screen overflow-y-auto">
          <Logo />

          <button onClick={() => setShowRecharge(true)}
            className={"mt-6 w-full text-left rounded-2xl border p-3 transition " +
              (lowBalance ? "border-red-300 bg-red-50 hover:bg-red-100" : "border-border bg-muted/50 hover:bg-muted")}>
            <div className="flex items-center gap-2">
              <Wallet className={"size-4 " + (lowBalance ? "text-red-600" : "text-ink-soft")} />
              <span className="text-[10px] uppercase tracking-wide text-ink-soft">Credits</span>
            </div>
            <div className="mt-1 font-display font-bold text-2xl leading-none">₹{balance.toFixed(2)}</div>
            <div className={"text-[11px] mt-1 " + (lowBalance ? "text-red-600 font-medium" : "text-ink-soft")}>
              {lowBalance ? "Low — tap to recharge" : "Tap to recharge"}
            </div>
          </button>

          <nav className="mt-6 space-y-1">
            {([
              { id: "agents", label: "Agents", icon: Activity },
              { id: "numbers", label: "Phone numbers", icon: PhoneIcon },
              { id: "calls", label: "Call history", icon: History },
              { id: "costs", label: "Costs", icon: IndianRupee },
              { id: "credits", label: "Credits & billing", icon: Wallet },
              { id: "settings", label: "Account", icon: Settings },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={"w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition " +
                  (tab === id ? "bg-foreground text-background" : "text-ink-soft hover:bg-muted hover:text-foreground")}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
            <Link to="/campaigns"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-soft hover:bg-muted hover:text-foreground transition">
              <Megaphone className="size-4" /> Campaigns
            </Link>
          </nav>
          <Link to="/agents/new"
            className="mt-8 pill inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-semibold bg-lime text-ink">
            <Plus className="size-4" /> New agent
          </Link>
          <button onClick={signOut}
            className="mt-3 w-full inline-flex items-center gap-1.5 px-3 py-2 text-xs text-ink-soft hover:text-foreground">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </aside>

        <main className="px-6 md:px-10 py-8 max-w-[1400px]">
          {tab === "agents" && <AgentsView />}
          {tab === "numbers" && <NumbersView />}
          {tab === "calls" && <CallsView />}
          {tab === "costs" && <CostsView />}
          {tab === "credits" && <CreditsView credits={credits} onRecharge={() => setShowRecharge(true)} />}
          {tab === "settings" && <SettingsView />}
        </main>
      </div>
      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} onSuccess={() => { refetchCredits(); setShowRecharge(false); }} />}
    </div>
  );
}

function RechargeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const recharge = useServerFn(rechargeCredits);
  const preset = [50, 100, 250, 500, 1000, 2500];

  const submit = async () => {
    if (amount <= 0) return toast.error("Enter a valid amount");
    setBusy(true);
    try {
      const r = await recharge({ data: { amount } });
      toast.success(`Recharged — new balance ₹${r.balance.toFixed(2)}`);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recharge failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md surface-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="chip-lime inline-flex items-center gap-1.5"><Wallet className="size-3" /> Recharge credits</div>
            <h2 className="font-display font-bold text-2xl mt-2">Top up your balance</h2>
            <p className="text-sm text-ink-soft mt-1">Voice calls run ~₹8/min. Pick an amount below.</p>
          </div>
          <button onClick={onClose} className="text-ink-soft hover:text-foreground"><X className="size-5" /></button>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {preset.map((v) => (
            <button key={v} onClick={() => setAmount(v)}
              className={"rounded-2xl border py-3 text-sm font-semibold transition " +
                (amount === v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
              ₹{v}
            </button>
          ))}
        </div>
        <label className="block mt-4">
          <div className="text-xs text-ink-soft">Or custom amount (INR)</div>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
            className="mt-1 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:border-foreground" />
        </label>
        <div className="mt-3 text-[11px] text-ink-soft bg-muted rounded-xl px-3 py-2">
          Demo mode — this instantly adds credits without a payment. Wire your payment gateway when ready.
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="pill px-4 py-2 text-sm border border-border">Cancel</button>
          <button onClick={submit} disabled={busy || amount <= 0}
            className="pill inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-lime text-ink disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
            Recharge ₹{amount}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreditsView({ credits, onRecharge }: { credits: { balance: number; ledger: Array<{ id: string; delta_inr: number; kind: string; note: string | null; created_at: string }> } | undefined; onRecharge: () => void }) {
  const balance = credits?.balance ?? 0;
  const ledger = credits?.ledger ?? [];
  return (
    <div>
      <PageHeader title="Credits & billing" subtitle="Every top-up and every rupee spent — down to the call."
        action={
          <button onClick={onRecharge} className="pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-lime text-ink">
            <Wallet className="size-4" /> Recharge
          </button>
        } />
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="surface-card p-5 bg-lime-soft border-lime/40">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft">Current balance</div>
          <div className="font-display font-bold text-3xl mt-2">₹{balance.toFixed(2)}</div>
          <div className="text-xs text-ink-soft mt-1">≈ {(balance / 8).toFixed(1)} minutes of voice</div>
        </div>
        <div className="surface-card p-5">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft">Rate</div>
          <div className="font-display font-bold text-3xl mt-2">₹8<span className="text-lg text-ink-soft"> / min</span></div>
          <div className="text-xs text-ink-soft mt-1">Gemini Live realtime voice</div>
        </div>
        <div className="surface-card p-5">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft">Welcome credit</div>
          <div className="font-display font-bold text-3xl mt-2">₹20</div>
          <div className="text-xs text-ink-soft mt-1">Given free on signup</div>
        </div>
      </div>
      <div className="mt-8 surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-border">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-soft">No activity yet.</td></tr>
            ) : ledger.map((l) => (
              <tr key={l.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 text-xs text-ink-soft">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-4 py-3"><span className="chip-outline text-[10px]">{l.kind}</span></td>
                <td className="px-4 py-3 text-ink-soft">{l.note || "—"}</td>
                <td className={"px-4 py-3 text-right font-mono font-semibold " + (Number(l.delta_inr) >= 0 ? "text-green-700" : "text-red-600")}>
                  {Number(l.delta_inr) >= 0 ? "+" : ""}₹{Number(l.delta_inr).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="display-lg">{title}</h1>
        {subtitle && <p className="text-ink-soft mt-2 max-w-xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents")
        .select("*, phone_numbers(*)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

function AgentsView() {
  const { data: agents, isLoading, refetch } = useAgents();
  const testCall = useServerFn(placeTestCall);
  const removeAgent = useServerFn(deleteAgent);
  const [calling, setCalling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [testTo, setTestTo] = useState<Record<string, string>>({});

  const onTest = async (phoneNumberId: string) => {
    const to = testTo[phoneNumberId]?.trim();
    if (!to) return toast.error("Enter a phone number to call");
    setCalling(phoneNumberId);
    try {
      await testCall({ data: { phoneNumberId, to } });
      toast.success("Test call placed", { description: `Voxbiz is ringing ${to}` });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Call failed");
    } finally {
      setCalling(null);
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This removes the agent and all its call data. This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await removeAgent({ data: { agentId: id } });
      toast.success(`${name} deleted`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <PageHeader title="Your agents" subtitle="Every agent you've built. Test in the browser, or place a real Voxbiz call to your phone."
        action={
          <Link to="/agents/new" className="pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground">
            <Plus className="size-4" /> New agent
          </Link>
        }
      />
      {isLoading ? (
        <div className="surface-card p-10 text-center text-ink-soft">
          <Loader2 className="size-5 animate-spin mx-auto" />
        </div>
      ) : !agents?.length ? (
        <div className="surface-card p-12 text-center">
          <div className="font-display font-bold text-xl">No agents yet.</div>
          <p className="text-ink-soft mt-2">Build your first voice agent — it takes 2 minutes.</p>
          <Link to="/agents/new" className="mt-5 inline-flex pill px-5 py-2.5 text-sm font-semibold bg-foreground text-background">
            Build an agent
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {agents.map((a) => {
            const phones = (a as { phone_numbers?: Array<{ id: string; e164: string; label?: string | null; voxbiz_api_key?: string | null }> })
              .phone_numbers ?? [];
            return (
              <div key={a.id} className="surface-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <span className="grid place-items-center w-12 h-12 rounded-2xl bg-lime text-ink font-display font-bold text-lg">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-display font-bold text-xl">{a.name}</div>
                      <div className="text-sm text-ink-soft">{a.business_name} · {a.industry || "—"}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={"chip-outline text-[10px] " +
                          (a.status === "live" ? "!bg-lime !text-ink !border-lime" : "")}>{a.status}</span>
                        <span className="chip-outline text-[10px]">{a.direction}</span>
                        {(a.languages || []).map((l: string) => <span key={l} className="chip-outline text-[10px]">{l}</span>)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link to="/agents/$agentId/details" params={{ agentId: a.id }} search={{ view: "data" }}
                      className="pill inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-border hover:bg-muted">
                      <Eye className="size-3.5" /> View data
                    </Link>
                    <Link to="/agents/$agentId/details" params={{ agentId: a.id }}
                      className="pill inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-border hover:bg-muted">
                      <Pencil className="size-3.5" /> Edit
                    </Link>
                    <Link to="/agents/$agentId/test" params={{ agentId: a.id }}
                      className="pill inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-foreground text-background">
                      <MessageSquare className="size-3.5" /> Browser test
                    </Link>
                    <button
                      onClick={() => onDelete(a.id, a.name)}
                      disabled={deleting === a.id}
                      title="Delete agent"
                      className="pill inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-border text-red-600 hover:bg-red-50 disabled:opacity-50">
                      {deleting === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </button>
                  </div>
                </div>

                {phones.length > 0 && (
                  <div className="mt-5 pt-5 border-t border-border space-y-3">
                    {phones.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-3">
                        <div className="font-mono text-sm">{p.e164}</div>
                        {p.label && <span className="text-xs text-ink-soft">· {p.label}</span>}
                        <span className={"chip-outline text-[10px] " +
                          (p.voxbiz_api_key ? "!bg-lime !text-ink !border-lime" : "!bg-amber-100")}>
                          {p.voxbiz_api_key ? "Voxbiz connected" : "No Voxbiz key"}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <input
                            value={testTo[p.id] || ""}
                            onChange={(e) => setTestTo((s) => ({ ...s, [p.id]: e.target.value }))}
                            placeholder="+91 your phone"
                            className="rounded-xl border border-input bg-surface px-3 py-1.5 text-sm w-44 outline-none focus:border-foreground"
                          />
                          <button
                            onClick={() => onTest(p.id)}
                            disabled={calling === p.id || !p.voxbiz_api_key}
                            className="pill inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
                          >
                            {calling === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
                            Test call
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CallsView() {
  const [q, setQ] = useState("");
  const { data: calls, isLoading } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => {
      const { data, error } = await supabase.from("calls")
        .select("*, agents(name)").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  const filtered = useMemo(
    () => (calls || []).filter((c) => !q ||
      c.to_number?.includes(q) || c.from_number?.includes(q) || c.summary?.toLowerCase().includes(q.toLowerCase())),
    [calls, q]
  );
  return (
    <div>
      <PageHeader title="Call history" subtitle="Every real call placed through your agents." />
      <div className="surface-card p-4 mb-4 flex items-center gap-3">
        <Search className="size-4 text-ink-soft" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number or summary..."
          className="flex-1 bg-transparent text-sm outline-none" />
      </div>
      {isLoading ? <div className="surface-card p-10 text-center"><Loader2 className="size-5 animate-spin mx-auto" /></div>
        : !filtered.length ? (
          <div className="surface-card p-12 text-center text-ink-soft">
            No calls yet — place a test call from the Agents tab.
          </div>
        ) : (
          <div className="surface-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-border">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">From → To</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3 text-xs text-ink-soft">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">{(c as { agents?: { name?: string } }).agents?.name || "—"}</td>
                    <td className="px-4 py-3 text-ink-soft">{c.direction}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.from_number || "—"} → {c.to_number}</td>
                    <td className="px-4 py-3"><span className="chip-outline text-[10px]">{c.status}</span></td>
                    <td className="px-4 py-3 max-w-md"><span className="line-clamp-2 text-ink-soft text-xs">{c.summary}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function CostsView() {
  const { data: calls } = useQuery({
    queryKey: ["calls", "cost"],
    queryFn: async () => {
      const { data, error } = await supabase.from("calls")
        .select("duration_sec,cost_inr,provider,direction,agent_id,agents(name)");
      if (error) throw error;
      return data;
    },
  });
  const rows = calls || [];
  const totalMin = rows.reduce((s, c) => s + (c.duration_sec || 0), 0) / 60;
  const totalINR = rows.reduce((s, c) => s + Number(c.cost_inr || 0), 0);
  const avg = totalMin ? totalINR / totalMin : 0;
  const browserMin = rows.filter((c) => c.provider === "browser").reduce((s, c) => s + (c.duration_sec || 0), 0) / 60;
  const browserINR = rows.filter((c) => c.provider === "browser").reduce((s, c) => s + Number(c.cost_inr || 0), 0);
  const phoneINR = totalINR - browserINR;

  const byAgent = new Map<string, { name: string; min: number; inr: number; calls: number }>();
  for (const c of rows) {
    const key = c.agent_id ?? "unassigned";
    const name = (c as { agents?: { name?: string } }).agents?.name ?? "Unassigned";
    const cur = byAgent.get(key) ?? { name, min: 0, inr: 0, calls: 0 };
    cur.min += (c.duration_sec || 0) / 60;
    cur.inr += Number(c.cost_inr || 0);
    cur.calls += 1;
    byAgent.set(key, cur);
  }
  const agentRows = [...byAgent.values()].sort((a, b) => b.inr - a.inr);

  return (
    <div>
      <PageHeader title="Costs" subtitle="Spend across every call — browser tests, real phone calls, all agents." />
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="surface-card p-5">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft">Total minutes</div>
          <div className="font-display font-bold text-3xl mt-2">{totalMin.toFixed(1)}</div>
          <div className="text-xs text-ink-soft mt-1">{browserMin.toFixed(1)} browser · {(totalMin - browserMin).toFixed(1)} phone</div>
        </div>
        <div className="surface-card p-5">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft">Total spend</div>
          <div className="font-display font-bold text-3xl mt-2">₹{totalINR.toFixed(2)}</div>
          <div className="text-xs text-ink-soft mt-1">₹{browserINR.toFixed(2)} browser · ₹{phoneINR.toFixed(2)} phone</div>
        </div>
        <div className="surface-card p-5 bg-lime-soft border-lime/40">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft">Avg ₹/min</div>
          <div className="font-display font-bold text-3xl mt-2">₹{avg.toFixed(2)}</div>
        </div>
      </div>

      <div className="mt-8 surface-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-border">
            <tr>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Calls</th>
              <th className="px-4 py-3">Minutes</th>
              <th className="px-4 py-3">Spend</th>
            </tr>
          </thead>
          <tbody>
            {agentRows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-soft">No calls yet.</td></tr>
            ) : agentRows.map((a) => (
              <tr key={a.name} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{a.name}</td>
                <td className="px-4 py-3">{a.calls}</td>
                <td className="px-4 py-3">{a.min.toFixed(1)}</td>
                <td className="px-4 py-3">₹{a.inr.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------- Numbers view: connect / assign / delete numbers across all agents --------- */

const PROVIDERS: {
  id: ProviderId;
  name: string;
  desc: string;
  fields: { key: string; label: string; type?: string; placeholder?: string; hint?: string }[];
}[] = [
  {
    id: "twilio", name: "Twilio", desc: "Global. Works everywhere.",
    fields: [
      { key: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxx" },
      { key: "auth_token", label: "Auth Token", type: "password" },
      { key: "from", label: "Twilio number (E.164)", placeholder: "+14155551234" },
      { key: "answer_url", label: "TwiML answer URL (optional)" },
    ],
  },
  {
    id: "exotel", name: "Exotel", desc: "India-first.",
    fields: [
      { key: "account_sid", label: "Account SID" },
      { key: "api_key", label: "API Key" },
      { key: "api_token", label: "API Token", type: "password" },
      { key: "subdomain", label: "Cluster subdomain", placeholder: "api.exotel.com" },
      { key: "from", label: "Exophone (E.164)", placeholder: "+9180xxxxxxxx" },
      { key: "caller_id", label: "Caller ID (optional)" },
    ],
  },
  {
    id: "plivo", name: "Plivo", desc: "APAC + US.",
    fields: [
      { key: "auth_id", label: "Auth ID", placeholder: "MAxxxxxxxx" },
      { key: "auth_token", label: "Auth Token", type: "password" },
      { key: "from", label: "Plivo number (E.164)", placeholder: "+14155551234" },
      { key: "answer_url", label: "Answer URL (optional)" },
    ],
  },
  {
    id: "voxbiz", name: "Voxbiz", desc: "India Click2Call.",
    fields: [
      { key: "api_key", label: "Voxbiz API key", type: "password" },
      { key: "api_url", label: "Voxbiz API URL", placeholder: "https://api.voxbiz.com/v1/click2call" },
      { key: "from", label: "Voxbiz DID (E.164)", placeholder: "+9180xxxxxxxx" },
      { key: "caller_id", label: "Caller ID (optional)" },
    ],
  },
  {
    id: "sip_custom", name: "Custom SIP trunk", desc: "Bring your own SIP / PBX.",
    fields: [
      { key: "sip_username", label: "SIP username" },
      { key: "sip_password", label: "SIP password", type: "password" },
      { key: "sip_host", label: "SIP host / proxy", placeholder: "sip.example.com" },
      { key: "from", label: "Phone number (E.164)", placeholder: "+..." },
    ],
  },
];

function NumbersView() {
  const { data: agents } = useAgents();
  const { data: numbers, refetch, isLoading } = useQuery({
    queryKey: ["all-phone-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("phone_numbers")
        .select("*, agents(name)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const connect = useServerFn(connectPhoneNumber);
  const assign = useServerFn(assignPhoneNumberToAgent);
  const removeNum = useServerFn(deletePhoneNumber);

  const [showAdd, setShowAdd] = useState(false);
  const [providerId, setProviderId] = useState<ProviderId>("twilio");
  const [label, setLabel] = useState("Main line");
  const [agentId, setAgentId] = useState<string>("");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  const submit = async () => {
    const e164 = cfg.from?.trim();
    if (!e164) return toast.error("Phone number (E.164) is required");
    setSaving(true);
    try {
      await connect({ data: { agentId: agentId || null, provider: providerId, e164, label, config: cfg } });
      toast.success("Number added", { description: `${provider.name} · ${e164}` });
      setCfg({}); setShowAdd(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally { setSaving(false); }
  };

  const onAssign = async (phoneNumberId: string, newAgentId: string) => {
    setBusy(phoneNumberId);
    try {
      await assign({ data: { phoneNumberId, agentId: newAgentId || null } });
      toast.success("Agent updated");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally { setBusy(null); }
  };

  const onDelete = async (phoneNumberId: string, e164: string) => {
    if (!confirm(`Remove ${e164}? Calls linked to it stay in history.`)) return;
    setBusy(phoneNumberId);
    try {
      await removeNum({ data: { phoneNumberId } });
      toast.success(`${e164} removed`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader
        title="Phone numbers"
        subtitle="Every number you've connected — across all providers and SIP trunks. Assign to any agent."
        action={
          <button onClick={() => setShowAdd((v) => !v)}
            className="pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground">
            <Plus className="size-4" /> {showAdd ? "Close" : "Add number"}
          </button>
        }
      />

      {showAdd && (
        <div className="surface-card p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {PROVIDERS.map((p) => (
              <button key={p.id}
                onClick={() => { setProviderId(p.id); setCfg({}); }}
                className={"text-left rounded-2xl border p-3 transition " +
                  (providerId === p.id ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted")}>
                <div className="font-display font-bold text-sm">{p.name}</div>
                <div className={"text-[11px] mt-1 " + (providerId === p.id ? "text-white/70" : "text-ink-soft")}>{p.desc}</div>
              </button>
            ))}
          </div>

          <div className="mt-5 grid md:grid-cols-2 gap-4">
            <label className="block">
              <div className="font-display font-semibold text-sm">Label</div>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
            </label>
            <label className="block">
              <div className="font-display font-semibold text-sm">Assign to agent (optional)</div>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm">
                <option value="">— Unassigned —</option>
                {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {provider.fields.map((f) => (
              <label key={f.key} className="block">
                <div className="font-display font-semibold text-sm">{f.label}</div>
                {f.hint && <div className="text-xs text-ink-soft mt-0.5">{f.hint}</div>}
                <input type={f.type || "text"} value={cfg[f.key] ?? ""}
                  onChange={(e) => setCfg((m) => ({ ...m, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
              </label>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={submit} disabled={saving}
              className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
              Add {provider.name}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="surface-card p-10 text-center"><Loader2 className="size-5 animate-spin mx-auto" /></div>
      ) : !numbers?.length ? (
        <div className="surface-card p-12 text-center">
          <div className="font-display font-bold text-xl">No numbers yet.</div>
          <p className="text-ink-soft mt-2">Bring a number from Twilio, Plivo, Exotel, Voxbiz, or a custom SIP trunk.</p>
        </div>
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-border">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-sm">{n.e164}</td>
                  <td className="px-4 py-3"><span className="chip-outline text-[10px]">{n.provider}</span></td>
                  <td className="px-4 py-3 text-ink-soft">{n.label || "—"}</td>
                  <td className="px-4 py-3">
                    <select
                      value={n.agent_id ?? ""}
                      disabled={busy === n.id}
                      onChange={(e) => onAssign(n.id, e.target.value)}
                      className="rounded-xl border border-input bg-surface px-3 py-1.5 text-sm">
                      <option value="">— Unassigned —</option>
                      {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onDelete(n.id, n.e164)} disabled={busy === n.id}
                      title="Remove number"
                      className="pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border text-red-600 hover:bg-red-50 disabled:opacity-50">
                      {busy === n.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function SettingsView() {
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
      return { ...data, email: u.user.email };
    },
  });
  return (
    <div>
      <PageHeader title="Account" />
      <div className="surface-card p-6 max-w-xl space-y-3">
        <Row k="Email" v={profile?.email || "—"} />
        <Row k="Name" v={profile?.full_name || "—"} />
        <Row k="Business" v={profile?.business_name || "—"} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm border-b border-border last:border-0 pb-2 last:pb-0">
      <span className="text-ink-soft">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
