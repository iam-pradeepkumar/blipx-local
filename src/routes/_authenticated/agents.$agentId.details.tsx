import { createFileRoute, Link, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/BlipxNav";
import { ArrowLeft, Loader2, MessageSquare, ChevronDown, Trash2, Plus, Link as LinkIcon, FileText, Webhook, Mail, Sparkles, Save, Share2, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { addKnowledgeText, addKnowledgeUrl, deleteKnowledgeDoc } from "@/lib/knowledge.functions";
import { updateAgentSettings } from "@/lib/agent-settings.functions";
import { voicesForProvider } from "@/lib/voice-providers";

export const Route = createFileRoute("/_authenticated/agents/$agentId/details")({
  head: () => ({ meta: [{ title: "Agent details · BlipX" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ view: s.view === "data" ? "data" : undefined }) as { view?: "data" },
  component: AgentDetailsPage,
});

type Tab = "overview" | "voice" | "realtime" | "knowledge" | "automations" | "calls" | "share";

// Voices are resolved from the agent's TTS provider via voicesForProvider().


const LANGUAGES = ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali", "Hinglish", "Tanglish"];
const TONES = ["Friendly", "Professional", "Empathetic", "Concise"];

function AgentDetailsPage() {
  const { agentId } = useParams({ from: "/_authenticated/agents/$agentId/details" });
  const search = useSearch({ from: "/_authenticated/agents/$agentId/details" });
  const viewOnly = search.view === "data";
  const [tab, setTab] = useState<Tab>(viewOnly ? "calls" : "overview");

  const { data: agent, isLoading: al, refetch: refetchAgent } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("*").eq("id", agentId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (al) return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-ink-soft" /></div>;
  if (!agent) return <div className="min-h-screen grid place-items-center text-ink-soft">Agent not found.</div>;

  const tabs: { id: Tab; label: string }[] = viewOnly
    ? [{ id: "calls", label: "Call data" }]
    : [
        { id: "overview", label: "Overview" },
        { id: "voice", label: "Voice & language" },
        { id: "realtime", label: "Realtime pipeline" },
        { id: "knowledge", label: "Knowledge" },
        { id: "automations", label: "After-call automations" },
        { id: "share", label: "Share / Embed" },
      ];


  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Logo />
        <Link to="/dashboard" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 pb-16 space-y-6">
        <div className="surface-card p-6 md:p-8">
          <div className="flex items-start gap-4 flex-wrap">
            <span className="grid place-items-center w-14 h-14 rounded-2xl bg-lime text-ink font-display font-bold text-xl">
              {agent.name?.charAt(0) || "A"}
            </span>
            <div className="flex-1 min-w-[240px]">
              <h1 className="font-display font-bold text-2xl">{agent.name}</h1>
              <p className="text-sm text-ink-soft">{agent.business_name} · {agent.industry || "—"} · {agent.direction}</p>
            </div>
            <Link to="/agents/$agentId/test" params={{ agentId: agent.id }}
              className="pill inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-foreground text-background">
              <MessageSquare className="size-3.5" /> Test in browser
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap gap-1.5 border-b border-border">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={"px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition " +
                  (tab === t.id ? "border-foreground text-foreground" : "border-transparent text-ink-soft hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "overview" && <OverviewPanel agent={agent} />}
        {tab === "voice" && <VoicePanel agent={agent} onSaved={refetchAgent} />}
        {tab === "realtime" && <RealtimePanel agent={agent} onSaved={refetchAgent} />}
        {tab === "knowledge" && <KnowledgePanel agentId={agent.id} />}
        {tab === "automations" && <AutomationsPanel agent={agent} onSaved={refetchAgent} />}
        {tab === "share" && <SharePanel agent={agent} />}
        {tab === "calls" && <CallsPanel agentId={agent.id} />}
      </main>
    </div>
  );

}

/* ---------- Overview ---------- */

function OverviewPanel({ agent }: { agent: any }) {
  const captureFields: string[] = Array.isArray(agent.capture_fields) ? (agent.capture_fields as string[]) : [];
  return (
    <div className="surface-card p-6 md:p-8 space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-soft">Opening line</div>
        <div className="rounded-2xl border border-border p-4 bg-surface text-sm mt-1">{agent.greeting}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-soft">What it does</div>
        <div className="rounded-2xl border border-border p-4 bg-surface text-sm whitespace-pre-wrap mt-1 max-h-64 overflow-y-auto">{agent.system_prompt}</div>
      </div>
      {captureFields.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-soft mb-2">Captures every call</div>
          <div className="flex flex-wrap gap-1.5">
            {captureFields.map((f) => <span key={f} className="chip-outline text-[10px]">{f}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Voice & language ---------- */

function VoicePanel({ agent, onSaved }: { agent: any; onSaved: () => void }) {
  const ttsProvider: string = agent.tts_provider || "gemini";
  const voices = voicesForProvider(ttsProvider);
  const fallbackVoice = voices[0]?.id ?? "Leda";
  const initialVoice = voices.some((v) => v.id === agent.tts_voice_id)
    ? agent.tts_voice_id
    : voices.some((v) => v.id === agent.voice_name)
      ? agent.voice_name
      : fallbackVoice;
  const [voice, setVoice] = useState<string>(initialVoice);
  const [style, setStyle] = useState<string>(agent.voice_style || "");
  const [tone, setTone] = useState<string>(agent.tone || "Friendly");
  const [greeting, setGreeting] = useState<string>(agent.greeting || "");
  const [langs, setLangs] = useState<string[]>(agent.languages || ["English"]);
  const [autoLang, setAutoLang] = useState<boolean>(!!agent.auto_detect_language);
  const [saving, setSaving] = useState(false);
  const save = useServerFn(updateAgentSettings);

  const toggleLang = (l: string) => setLangs((cur) => cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]);
  const submit = async () => {
    setSaving(true);
    try {
      await save({ data: { agentId: agent.id, voice_name: voice, tts_voice_id: voice, voice_style: style, tone, greeting, languages: langs, auto_detect_language: autoLang } });
      toast.success("Voice updated");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="surface-card p-6 md:p-8 space-y-6">
      <div>
        <div className="font-display font-semibold text-sm mb-1">Voice</div>
        <div className="text-xs text-ink-soft mb-2">
          Voices below are for your current TTS engine (<span className="font-mono">{ttsProvider}</span>).
          To change engines, use the <span className="font-semibold">Realtime pipeline</span> tab.
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {voices.map((v) => (
            <button key={v.id} onClick={() => setVoice(v.id)}
              className={"text-left rounded-2xl border p-3 text-sm transition " +
                (voice === v.id ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted")}>
              {v.label}
            </button>
          ))}
        </div>
      </div>



      <label className="block">
        <div className="font-display font-semibold text-sm">Voice style hint (optional)</div>
        <div className="text-xs text-ink-soft">e.g. "Warm and unhurried. Smile in the voice. Slight south-Indian accent."</div>
        <textarea value={style} onChange={(e) => setStyle(e.target.value)} rows={2}
          className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
      </label>

      <label className="block">
        <div className="font-display font-semibold text-sm">Opening line</div>
        <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2}
          className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
      </label>

      <div>
        <div className="font-display font-semibold text-sm mb-2">Tone</div>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <button key={t} onClick={() => setTone(t)}
              className={"pill px-4 py-2 text-xs font-semibold border " +
                (tone === t ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted")}>{t}</button>
          ))}
        </div>
      </div>

      <div>
        <div className="font-display font-semibold text-sm mb-2">Languages it speaks</div>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <button key={l} onClick={() => toggleLang(l)}
              className={"pill px-4 py-2 text-xs font-semibold border " +
                (langs.includes(l) ? "bg-lime text-ink border-lime" : "border-border hover:bg-muted")}>{l}</button>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={autoLang} onChange={(e) => setAutoLang(e.target.checked)} className="size-4" />
          <span>Auto-switch to the caller's language mid-call</span>
        </label>
      </div>

      <div className="flex justify-end">
        <button onClick={submit} disabled={saving}
          className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save voice settings
        </button>
      </div>
    </div>
  );
}

/* ---------- Knowledge ---------- */

function KnowledgePanel({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { data: docs, isLoading } = useQuery({
    queryKey: ["knowledge_docs", agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_docs").select("*").eq("agent_id", agentId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["knowledge_docs", agentId] });

  const addText = useServerFn(addKnowledgeText);
  const addUrl = useServerFn(addKnowledgeUrl);
  const remove = useServerFn(deleteKnowledgeDoc);

  const [mode, setMode] = useState<"text" | "url">("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    try {
      if (mode === "text") {
        if (!title.trim() || !content.trim()) return toast.error("Add a title and paste some text");
        await addText({ data: { agentId, title, content } });
      } else {
        if (!url.trim()) return toast.error("Paste a URL");
        await addUrl({ data: { agentId, url, title } });
      }
      toast.success("Added to knowledge base");
      setTitle(""); setContent(""); setUrl("");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  const onRemove = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from the knowledge base?`)) return;
    setBusy(id);
    try { await remove({ data: { docId: id } }); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="surface-card p-6 md:p-8">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center size-11 rounded-2xl bg-foreground text-background"><FileText className="size-5" /></span>
          <div>
            <h2 className="font-display font-bold text-xl">Teach the agent</h2>
            <p className="text-sm text-ink-soft">Paste your FAQ, price list, policies, or a website link. The agent will answer callers using it.</p>
          </div>
        </div>

        <div className="mt-5 inline-flex rounded-full border border-border p-1 bg-surface">
          <button onClick={() => setMode("text")}
            className={"px-4 py-1.5 rounded-full text-sm font-medium " + (mode === "text" ? "bg-foreground text-background" : "text-ink-soft")}>Paste text</button>
          <button onClick={() => setMode("url")}
            className={"px-4 py-1.5 rounded-full text-sm font-medium " + (mode === "url" ? "bg-foreground text-background" : "text-ink-soft")}>Website URL</button>
        </div>

        <div className="mt-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "text" ? "Title (e.g. Pricing FAQ)" : "Label (optional)"}
            className="w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
          {mode === "text" ? (
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8}
              placeholder="Paste anything you want the agent to know — FAQs, policies, offers, price list…"
              className="w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
          ) : (
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.com/faq"
              className="w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm" />
          )}
          <div className="flex justify-end">
            <button onClick={submit} disabled={saving}
              className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add to knowledge
            </button>
          </div>
        </div>
      </div>

      <div className="surface-card p-6">
        <div className="font-display font-semibold mb-3">Attached knowledge ({docs?.length ?? 0})</div>
        {isLoading ? <Loader2 className="size-5 animate-spin text-ink-soft" />
         : !docs?.length ? <div className="text-sm text-ink-soft">Nothing added yet.</div>
         : (
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="rounded-2xl border border-border p-4 flex items-start gap-3">
                <span className="mt-0.5">{d.kind === "url" ? <LinkIcon className="size-4 text-ink-soft" /> : <FileText className="size-4 text-ink-soft" />}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold text-sm truncate">{d.title}</div>
                  {d.source_url && <a href={d.source_url} target="_blank" rel="noreferrer" className="text-xs text-ink-soft underline truncate block">{d.source_url}</a>}
                  <div className="text-xs text-ink-soft mt-1">{d.size_chars.toLocaleString()} chars · added {new Date(d.created_at).toLocaleDateString()}</div>
                </div>
                <button onClick={() => onRemove(d.id, d.title)} disabled={busy === d.id}
                  className="pill inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {busy === d.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Automations ---------- */

function AutomationsPanel({ agent, onSaved }: { agent: any; onSaved: () => void }) {
  const a = (agent.automations ?? {}) as any;
  const [webhookOn, setWebhookOn] = useState<boolean>(!!a.webhook_enabled);
  const [webhookUrl, setWebhookUrl] = useState<string>(a.webhook_url || "");
  const [emailOn, setEmailOn] = useState<boolean>(!!a.email_enabled);
  const [emailTo, setEmailTo] = useState<string>(a.email_to || "");
  const [saving, setSaving] = useState(false);
  const save = useServerFn(updateAgentSettings);

  const submit = async () => {
    setSaving(true);
    try {
      await save({ data: { agentId: agent.id, automations: { webhook_enabled: webhookOn, webhook_url: webhookUrl, email_enabled: emailOn, email_to: emailTo } } });
      toast.success("Automations saved");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="surface-card p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-11 rounded-2xl bg-foreground text-background"><Sparkles className="size-5" /></span>
        <div>
          <h2 className="font-display font-bold text-xl">After every call</h2>
          <p className="text-sm text-ink-soft">Automatically push the summary + captured data anywhere you want.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <Webhook className="size-5 mt-1 text-ink-soft" />
            <div className="flex-1">
              <div className="font-display font-semibold text-sm">Webhook (Zapier, Make, n8n, your CRM)</div>
              <p className="text-xs text-ink-soft mt-1">We POST JSON with the summary, transcript and captured fields.</p>
              <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                className="mt-3 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={webhookOn} onChange={(e) => setWebhookOn(e.target.checked)} className="size-4" /> On
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <Mail className="size-5 mt-1 text-ink-soft" />
            <div className="flex-1">
              <div className="font-display font-semibold text-sm">Email summary</div>
              <p className="text-xs text-ink-soft mt-1">We queue an email preview for you (SMTP delivery coming soon).</p>
              <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
                placeholder="you@business.com"
                className="mt-3 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} className="size-4" /> On
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={submit} disabled={saving}
          className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save automations
        </button>
      </div>
    </div>
  );
}

/* ---------- Share / Embed ---------- */

function SharePanel({ agent }: { agent: any }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = `${origin}/talk/${agent.id}`;
  const embed = `<script src="${origin}/widget.js" data-agent="${agent.id}" defer></script>`;

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); }
    catch { toast.error("Copy failed"); }
  };

  return (
    <div className="surface-card p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-11 rounded-2xl bg-foreground text-background"><Share2 className="size-5" /></span>
        <div>
          <h2 className="font-display font-bold text-xl">Let anyone talk to this agent</h2>
          <p className="text-sm text-ink-soft">Share a link, or paste the snippet on your website to add a floating "Talk to agent" button.</p>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-soft">Public web-call link</div>
        <div className="mt-1 flex items-center gap-2">
          <input readOnly value={publicUrl} className="flex-1 rounded-2xl border border-input bg-surface px-4 py-3 text-sm font-mono" />
          <button onClick={() => copy(publicUrl, "url")}
            className="pill inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold bg-foreground text-background">
            {copied === "url" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Anyone with this link can click "Start call", grant mic permission, and speak to the agent from the browser.</p>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-soft">Website embed snippet</div>
        <div className="mt-1 flex items-start gap-2">
          <textarea readOnly value={embed} rows={2} className="flex-1 rounded-2xl border border-input bg-surface px-4 py-3 text-xs font-mono" />
          <button onClick={() => copy(embed, "embed")}
            className="pill inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold bg-foreground text-background">
            {copied === "embed" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied === "embed" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Paste before <code className="text-[11px]">&lt;/body&gt;</code> on any page. Adds a floating chip in the bottom-right.</p>
      </div>

      <div className="rounded-2xl border border-border p-4 bg-surface">
        <div className="font-display font-semibold text-sm">Phone number</div>
        <p className="text-xs text-ink-soft mt-1">Connect a Twilio number under <Link to="/dashboard" className="underline">Phone numbers</Link>; incoming calls to it will be answered by this agent automatically.</p>
      </div>
    </div>
  );
}

/* ---------- Calls ---------- */

function CallsPanel({ agentId }: { agentId: string }) {
  const { data: calls, isLoading } = useQuery({
    queryKey: ["agent-calls", agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("calls").select("*").eq("agent_id", agentId)
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const downloadCsv = () => {
    if (!calls?.length) return;
    const fieldKeys = new Set<string>();
    for (const c of calls) {
      const f = c.captured_fields && typeof c.captured_fields === "object" ? c.captured_fields as Record<string, unknown> : {};
      Object.keys(f).forEach((k) => fieldKeys.add(k));
    }
    const capCols = Array.from(fieldKeys);
    const headers = ["created_at", "direction", "duration_sec", "sentiment", "outcome", "from_number", "to_number", "summary", ...capCols.map((k) => `field_${k}`), "transcript"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = calls.map((c) => {
      const f = (c.captured_fields ?? {}) as Record<string, unknown>;
      const t = Array.isArray(c.transcript) ? (c.transcript as Array<{ role: string; content: string }>).map((m) => `${m.role}: ${m.content}`).join(" | ") : "";
      return [c.created_at, c.direction, c.duration_sec, c.sentiment, c.outcome, c.from_number, c.to_number, c.summary, ...capCols.map((k) => f[k]), t].map(esc).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-${agentId}-calls-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="surface-card p-10 text-center"><Loader2 className="size-5 animate-spin mx-auto" /></div>;
  if (!calls?.length) return <div className="surface-card p-10 text-center text-sm text-ink-soft">No calls yet — run a browser test or launch a campaign.</div>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={downloadCsv}
          className="pill inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-foreground text-background">
          <FileText className="size-3.5" /> Download CSV ({calls.length})
        </button>
      </div>
      {calls.map((c) => <CallCard key={c.id} call={c} />)}
    </div>
  );
}

function CallCard({ call }: { call: any }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const fields: Record<string, unknown> = call.captured_fields && typeof call.captured_fields === "object" ? call.captured_fields : {};
  const transcript: Array<{ role: string; content: string }> = Array.isArray(call.transcript) ? call.transcript : [];
  return (
    <div className="surface-card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="chip-outline text-[10px]">{call.direction}</span>
        <span className="text-xs text-ink-soft">{new Date(call.created_at).toLocaleString()}</span>
        <span className="text-xs text-ink-soft">· {call.duration_sec}s</span>
        {call.sentiment && <span className="chip-outline text-[10px]">{call.sentiment}</span>}
        {call.outcome && <span className="chip-outline text-[10px]">{call.outcome}</span>}
      </div>
      {call.summary && <div className="text-sm text-ink-soft">{call.summary}</div>}

      <div>
        <div className="font-display font-semibold text-sm mb-2">Data collected</div>
        {Object.keys(fields).length === 0 ? (
          <div className="text-xs text-ink-soft">No fields were captured on this call.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(fields).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border p-3 bg-surface">
                <div className="text-[10px] uppercase tracking-wide text-ink-soft">{k}</div>
                <div className="text-sm mt-0.5">{v == null || v === "" ? <span className="text-ink-soft">—</span> : String(v)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {transcript.length > 0 && (
        <div>
          <button onClick={() => setShowTranscript((o) => !o)} className="text-xs text-ink-soft hover:text-foreground inline-flex items-center gap-1">
            <ChevronDown className={"size-3.5 transition " + (showTranscript ? "rotate-180" : "")} />
            {showTranscript ? "Hide" : "Show"} transcript ({transcript.length} messages)
          </button>
          {showTranscript && (
            <div className="mt-3 space-y-2 max-h-80 overflow-y-auto pr-1">
              {transcript.map((t, i) => (
                <div key={i} className={"flex " + (t.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={"max-w-[80%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap " +
                    (t.role === "user" ? "bg-foreground text-background" : "bg-muted")}>{t.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ---------- Realtime pipeline (Vapi-style) ---------- */

import { STT_OPTIONS, LLM_OPTIONS, TTS_OPTIONS, TIERS, estimateInrPerMinute } from "@/lib/voice-providers";

function voiceListFor(provider: string) {
  return voicesForProvider(provider);
}


function RealtimePanel({ agent, onSaved }: { agent: any; onSaved: () => void }) {
  const [useRealtime, setUseRealtime]   = useState<boolean>(!!agent.use_realtime);
  const [sttProvider, setSttProvider]   = useState<string>(agent.stt_provider || "deepgram");
  const [sttModel, setSttModel]         = useState<string>(agent.stt_model || "nova-3");
  const [llmProvider, setLlmProvider]   = useState<string>(agent.llm_provider || "lovable");
  const [llmModel, setLlmModel]         = useState<string>(agent.llm_model || "google/gemini-3-flash-preview");

  const [llmTemp, setLlmTemp]           = useState<number>(Number(agent.llm_temperature ?? 0.6));
  const [ttsProvider, setTtsProvider]   = useState<string>(agent.tts_provider || "elevenlabs");
  const [ttsModel, setTtsModel]         = useState<string>(agent.tts_model || "eleven_turbo_v2_5");
  const [ttsVoice, setTtsVoice]         = useState<string>(agent.tts_voice_id || "EXAVITQu4vr4xnSDxMaL");
  const [firstMode, setFirstMode]       = useState<string>(agent.first_message_mode || "assistant-speaks-first");
  const [interruptMs, setInterruptMs]   = useState<number>(Number(agent.interruption_threshold_ms ?? 150));
  const [silenceMs, setSilenceMs]       = useState<number>(Number(agent.silence_timeout_ms ?? 8000));
  const [maxSec, setMaxSec]             = useState<number>(Number(agent.max_duration_sec ?? 600));
  const [endPhrases, setEndPhrases]     = useState<string>((agent.end_call_phrases ?? ["goodbye","bye"]).join(", "));
  const [saving, setSaving] = useState(false);
  const save = useServerFn(updateAgentSettings);

  const sttModels = STT_OPTIONS.find((o) => o.id === sttProvider)?.models ?? [];
  const llmModels = LLM_OPTIONS.find((o) => o.id === llmProvider)?.models ?? [];
  const ttsModels = TTS_OPTIONS.find((o) => o.id === ttsProvider)?.models ?? [];

  const submit = async () => {
    if (estimateInrPerMinute(sttProvider, llmProvider, ttsProvider) > 3) {
      toast.error("This combination costs more than ₹3/min — pick a cheaper preset or provider.");
      return;
    }
    setSaving(true);
    try {
      await save({ data: {
        agentId: agent.id,
        use_realtime: useRealtime,
        stt_provider: sttProvider, stt_model: sttModel,
        llm_provider: llmProvider, llm_model: llmModel, llm_temperature: llmTemp,
        tts_provider: ttsProvider, tts_model: ttsModel, tts_voice_id: ttsVoice,
        first_message_mode: firstMode,
        interruption_threshold_ms: interruptMs,
        silence_timeout_ms: silenceMs,
        max_duration_sec: maxSec,
        end_call_phrases: endPhrases.split(",").map((s) => s.trim()).filter(Boolean),
      }});
      toast.success("Realtime pipeline updated");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block">
      <div className="font-display font-semibold text-sm">{label}</div>
      {hint && <div className="text-xs text-ink-soft mb-1">{hint}</div>}
      {children}
    </label>
  );
  const selectCls = "mt-1 w-full rounded-2xl border border-input bg-surface px-3 py-2.5 text-sm";
  const inputCls  = "mt-1 w-full rounded-2xl border border-input bg-surface px-3 py-2.5 text-sm";

  const estInr = estimateInrPerMinute(sttProvider, llmProvider, ttsProvider);
  const overBudget = estInr > 3;
  const voices = voiceListFor(ttsProvider);

  const applyTier = (tierId: string) => {
    const t = TIERS.find((x) => x.id === tierId);
    if (!t) return;
    setSttProvider(t.defaults.stt_provider); setSttModel(t.defaults.stt_model);
    setLlmProvider(t.defaults.llm_provider); setLlmModel(t.defaults.llm_model);
    setTtsProvider(t.defaults.tts_provider); setTtsModel(t.defaults.tts_model); setTtsVoice(t.defaults.tts_voice_id);
  };

  return (
    <div className="surface-card p-6 md:p-8 space-y-6">
      <div className="rounded-2xl border border-border p-4 flex items-start gap-3">
        <input id="rt" type="checkbox" checked={useRealtime} onChange={(e) => setUseRealtime(e.target.checked)} className="size-4 mt-1" />
        <div className="flex-1">
          <label htmlFor="rt" className="font-display font-semibold text-sm cursor-pointer">
            Enable realtime pipeline (Vapi/Retell-style)
          </label>
          <p className="text-xs text-ink-soft mt-1">
            The agent picks up the phone directly and speaks to the caller — no human in the loop.
            Streaming STT → LLM → TTS with sub-second barge-in. Pick a preset below or hand-pick
            each provider; the estimator on the right shows total spend per spoken minute.
          </p>
        </div>
      </div>

      {/* Cost tier picker */}
      <div className="rounded-2xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="font-display font-bold text-sm">Cost preset</div>
          <div className={`text-sm font-display font-bold ${overBudget ? "text-red-600" : "text-emerald-600"}`}>
            Est. ₹{estInr.toFixed(2)} / spoken min {overBudget ? "· over ₹3 budget" : "· within ₹3 budget"}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          {TIERS.map((t) => (
            <button key={t.id} type="button" onClick={() => applyTier(t.id)}
              className="text-left rounded-2xl border border-border p-3 hover:border-primary transition">
              <div className="font-display font-semibold text-sm">{t.label}</div>
              <div className="text-xs text-ink-soft mt-1">{t.description}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-ink-soft">
          Twilio phone-number cost (~₹0.55/min for India inbound) is billed by the carrier and shown separately in your call log.
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* STT */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="font-display font-bold text-sm">Speech-to-text</div>
          <Field label="Provider">
            <select value={sttProvider} onChange={(e) => { setSttProvider(e.target.value); const m = STT_OPTIONS.find(o=>o.id===e.target.value)?.models?.[0]; if (m) setSttModel(m); }} className={selectCls}>
              {STT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label} · ₹{o.costInrPerMinute}/min</option>)}
            </select>
          </Field>
          <Field label="Model">
            <select value={sttModel} onChange={(e) => setSttModel(e.target.value)} className={selectCls}>
              {sttModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>

        {/* LLM */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="font-display font-bold text-sm">LLM (brain)</div>
          <Field label="Provider">
            <select value={llmProvider} onChange={(e) => { setLlmProvider(e.target.value); const m = LLM_OPTIONS.find(o=>o.id===e.target.value)?.models?.[0]; if (m) setLlmModel(m); }} className={selectCls}>
              {LLM_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label} · ₹{o.costInrPerMinute}/min</option>)}
            </select>
          </Field>
          <Field label="Model">
            <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className={selectCls}>
              {llmModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label={`Temperature: ${llmTemp.toFixed(2)}`}>
            <input type="range" min={0} max={1.5} step={0.05} value={llmTemp} onChange={(e) => setLlmTemp(Number(e.target.value))} className="mt-1 w-full" />
          </Field>
        </div>

        {/* TTS */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="font-display font-bold text-sm">Text-to-speech</div>
          <Field label="Provider">
            <select value={ttsProvider} onChange={(e) => {
              const p = e.target.value;
              setTtsProvider(p);
              const m = TTS_OPTIONS.find(o=>o.id===p)?.models?.[0]; if (m) setTtsModel(m);
              const v = voiceListFor(p)[0]?.id; if (v) setTtsVoice(v);
            }} className={selectCls}>
              {TTS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label} · ₹{o.costInrPerMinute}/min</option>)}
            </select>
          </Field>
          <Field label="Model">
            <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} className={selectCls}>
              {ttsModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          {voices.length > 0 && (
            <Field label="Voice">
              <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} className={selectCls}>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Field>
          )}
        </div>
      </div>


      <div className="grid md:grid-cols-2 gap-4">
        <Field label="First message" hint="Who speaks first when the call connects.">
          <select value={firstMode} onChange={(e) => setFirstMode(e.target.value)} className={selectCls}>
            <option value="assistant-speaks-first">Assistant speaks first</option>
            <option value="wait-for-user">Wait for user</option>
          </select>
        </Field>
        <Field label="End-call phrases" hint="Comma-separated. When the caller says any of these, the agent politely hangs up.">
          <input value={endPhrases} onChange={(e) => setEndPhrases(e.target.value)} className={inputCls} />
        </Field>
        <Field label={`Interruption threshold: ${interruptMs} ms`} hint="How quickly the agent stops talking when caller interrupts.">
          <input type="range" min={50} max={800} step={25} value={interruptMs} onChange={(e) => setInterruptMs(Number(e.target.value))} className="mt-1 w-full" />
        </Field>
        <Field label={`Silence timeout: ${Math.round(silenceMs/1000)} s`} hint="Ends the call after this much silence.">
          <input type="range" min={2000} max={30000} step={1000} value={silenceMs} onChange={(e) => setSilenceMs(Number(e.target.value))} className="mt-1 w-full" />
        </Field>
        <Field label={`Max call duration: ${Math.round(maxSec/60)} min`} hint="Hard cap on call length.">
          <input type="range" min={60} max={1800} step={30} value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))} className="mt-1 w-full" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3">
        {overBudget && <span className="text-xs text-red-600">Save disabled — reduce cost to ≤ ₹3/min</span>}
        <button onClick={submit} disabled={saving || overBudget}
          className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save realtime pipeline
        </button>
      </div>
    </div>
  );
}
