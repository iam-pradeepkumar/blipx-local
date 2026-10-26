import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BlipxNav } from "@/components/BlipxNav";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, ArrowRight, Check, Phone, PhoneOutgoing, PhoneIncoming,
  Upload, Sparkles, ShieldCheck, Loader2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/wizard")({
  head: () => ({ meta: [{ title: "Build your voice agent · BlipX" }] }),
  component: WizardPage,
});

type WizardState = {
  business: string;
  industry: string;
  useCase: string;
  agentName: string;
  voice: string;
  tone: string;
  greeting: string;
  languages: string[];
  knowledge: string;
  collect: string[];
  escalation: string;
  direction: "inbound" | "outbound" | "both";
};

const initial: WizardState = {
  business: "",
  industry: "Retail",
  useCase: "Customer support",
  agentName: "",
  voice: "Female · Warm",
  tone: "Friendly",
  greeting: "Hi! Thanks for calling {business}. How can I help you today?",
  languages: ["English"],
  knowledge: "",
  collect: ["Name", "Issue type"],
  escalation: "",
  direction: "inbound",
};

const steps = [
  "Business", "Persona", "Languages", "Knowledge",
  "Capture", "Escalation", "Direction", "Review",
];

function WizardPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardState>(initial);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const projectedCost = useMemo(() => {
    let cost = 2.4;
    if (data.languages.length > 2) cost += 0.1;
    if (data.direction !== "inbound") cost += 0.1;
    return Math.min(cost, 2.9);
  }, [data]);

  const update = <K extends keyof WizardState>(k: K, v: WizardState[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const launch = async () => {
    if (!data.business.trim() || !data.agentName.trim()) {
      toast.error("Business name and agent name are required");
      setStep(0);
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      const systemPrompt = buildSystemPrompt(data);

      const { data: agent, error: agentErr } = await supabase
        .from("agents")
        .insert({
          user_id: userId,
          name: data.agentName,
          business_name: data.business,
          industry: data.industry,
          direction: data.direction,
          languages: data.languages,
          tone: data.tone,
          greeting: data.greeting.replaceAll("{business}", data.business),
          system_prompt: systemPrompt,
          knowledge_base: data.knowledge,
          capture_fields: data.collect,
          status: "live",
        })
        .select()
        .single();
      if (agentErr) throw agentErr;

      toast.success("Agent deployed!", {
        description: `${data.agentName} is live for ${data.business}.`,
      });
      navigate({ to: "/agents/$agentId/test", params: { agentId: agent.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deploy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlipxNav />
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <span className="chip-lime">Step {step + 1} of {steps.length}</span>
            <h1 className="display-lg mt-3">Build your agent.</h1>
            <p className="text-ink-soft mt-2">No code. Plain English. Real telephony.</p>
          </div>
          <div className="surface-card px-5 py-4">
            <div className="text-[10px] uppercase tracking-wide text-ink-soft">Projected cost</div>
            <div className="mt-1 font-display font-bold text-2xl">
              ₹{projectedCost.toFixed(2)}<span className="text-sm text-ink-soft font-normal">/min</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
              <ShieldCheck className="size-3.5" /> Within ₹2–3/min ceiling
            </div>
          </div>
        </div>

        <Progress step={step} />

        <div className="mt-8 grid lg:grid-cols-[1fr_280px] gap-6">
          <div className="surface-card p-7 md:p-9">
            {step === 0 && <StepBusiness data={data} update={update} />}
            {step === 1 && <StepPersona data={data} update={update} />}
            {step === 2 && <StepLanguages data={data} update={update} />}
            {step === 3 && <StepKnowledge data={data} update={update} />}
            {step === 4 && <StepCapture data={data} update={update} />}
            {step === 5 && <StepEscalation data={data} update={update} />}
            {step === 6 && <StepDirection data={data} update={update} />}
            {step === 7 && <StepLaunch data={data} update={update} projectedCost={projectedCost} />}

            <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
              <button
                onClick={prev}
                disabled={step === 0 || saving}
                className="pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border border-border disabled:opacity-40 hover:bg-muted"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              {step < steps.length - 1 ? (
                <button
                  onClick={next}
                  className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90"
                >
                  Continue <ArrowRight className="size-4" />
                </button>
              ) : (
                <button
                  onClick={launch}
                  disabled={saving}
                  className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-lime text-ink hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Deploy agent
                </button>
              )}
            </div>
          </div>

          <SidebarSummary data={data} step={step} />
        </div>
      </div>
    </div>
  );
}

function buildSystemPrompt(d: WizardState): string {
  const lines = [
    `You are a voice agent for ${d.business}, a ${d.industry.toLowerCase()} business.`,
    `Primary use case: ${d.useCase}.`,
    `Tone: ${d.tone}. Languages: ${d.languages.join(", ")}.`,
  ];
  if (d.knowledge.trim()) lines.push(`\nBusiness knowledge:\n${d.knowledge.trim()}`);
  if (d.collect.length) lines.push(`\nDuring the call, capture: ${d.collect.join(", ")}.`);
  if (d.escalation.trim()) lines.push(`\nEscalation rules:\n${d.escalation.trim()}`);
  return lines.join("\n");
}

function Progress({ step }: { step: number }) {
  return (
    <div className="surface-card p-4 flex items-center gap-2 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2 shrink-0">
          <span className={
            "grid place-items-center w-7 h-7 rounded-full text-xs font-semibold " +
            (i < step ? "bg-foreground text-background"
              : i === step ? "bg-lime text-ink"
              : "bg-muted text-ink-soft")
          }>
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={"text-xs font-medium " + (i === step ? "text-foreground" : "text-ink-soft")}>{s}</span>
          {i < steps.length - 1 && <span className="w-6 h-px bg-border mx-1" />}
        </div>
      ))}
    </div>
  );
}

const inputClass =
  "w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:border-foreground transition";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="font-display font-semibold text-sm">{label}</div>
      {hint && <div className="text-xs text-ink-soft mt-0.5">{hint}</div>}
      <div className="mt-2">{children}</div>
    </label>
  );
}

type StepProps = { data: WizardState; update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void };

function StepBusiness({ data, update }: StepProps) {
  const industries = ["Retail", "Healthcare", "Fintech", "Education", "Real estate", "Restaurant", "Logistics", "Other"];
  const useCases = ["Customer support", "Appointment booking", "Order status", "Lead qualification", "Payment / EMI reminders", "Feedback / NPS"];
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">Tell us about your business.</h2>
        <p className="text-sm text-ink-soft mt-1">We use this to personalise your agent.</p>
      </header>
      <Field label="Business name">
        <input className={inputClass} value={data.business} onChange={(e) => update("business", e.target.value)} placeholder="e.g. Saravana Mart" />
      </Field>
      <Field label="Industry">
        <div className="flex flex-wrap gap-2">
          {industries.map((i) => <Chip key={i} active={data.industry === i} onClick={() => update("industry", i)}>{i}</Chip>)}
        </div>
      </Field>
      <Field label="What should the agent do?">
        <div className="flex flex-wrap gap-2">
          {useCases.map((i) => <Chip key={i} active={data.useCase === i} onClick={() => update("useCase", i)}>{i}</Chip>)}
        </div>
      </Field>
    </div>
  );
}

function StepPersona({ data, update }: StepProps) {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">Give your agent a personality.</h2>
      </header>
      <div className="grid md:grid-cols-2 gap-5">
        <Field label="Agent name">
          <input className={inputClass} value={data.agentName} onChange={(e) => update("agentName", e.target.value)} placeholder="e.g. Anika" />
        </Field>
        <Field label="Voice">
          <div className="flex flex-wrap gap-2">
            {["Female · Warm", "Male · Calm", "Female · Energetic", "Male · Friendly"].map((v) =>
              <Chip key={v} active={data.voice === v} onClick={() => update("voice", v)}>{v}</Chip>
            )}
          </div>
        </Field>
      </div>
      <Field label="Tone">
        <div className="flex flex-wrap gap-2">
          {["Friendly", "Professional", "Empathetic", "Concise"].map((v) =>
            <Chip key={v} active={data.tone === v} onClick={() => update("tone", v)}>{v}</Chip>
          )}
        </div>
      </Field>
      <Field label="Greeting" hint="Use {business} for your business name.">
        <textarea rows={3} className={inputClass} value={data.greeting} onChange={(e) => update("greeting", e.target.value)} />
      </Field>
    </div>
  );
}

function StepLanguages({ data, update }: StepProps) {
  const langs = ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali", "Hinglish", "Tanglish"];
  const toggle = (l: string) =>
    update("languages", data.languages.includes(l) ? data.languages.filter((x) => x !== l) : [...data.languages, l]);
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">Languages your customers speak?</h2>
      </header>
      <div className="flex flex-wrap gap-2">
        {langs.map((l) => <Chip key={l} active={data.languages.includes(l)} onClick={() => toggle(l)}>{l}</Chip>)}
      </div>
    </div>
  );
}

function StepKnowledge({ data, update }: StepProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const onPick = async (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    setFiles((f) => [...f, ...arr]);
    // Read text-ish files and append to knowledge
    const textReads = await Promise.all(arr.map(async (f) => {
      if (/\.(txt|md|csv|json)$/i.test(f.name)) {
        try { return `\n\n--- ${f.name} ---\n${await f.text()}`; } catch { return ""; }
      }
      return "";
    }));
    const extra = textReads.join("");
    if (extra) update("knowledge", data.knowledge + extra);
    toast.success(`${arr.length} file${arr.length > 1 ? "s" : ""} added`);
  };
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">What should your agent know?</h2>
        <p className="text-sm text-ink-soft mt-1">Upload FAQs or describe your business.</p>
      </header>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onPick(e.dataTransfer.files); }}
        className="w-full rounded-2xl border-2 border-dashed border-border bg-muted/50 p-10 text-center hover:bg-muted hover:border-foreground transition cursor-pointer"
      >
        <Upload className="size-6 mx-auto text-ink-soft" />
        <div className="mt-2 font-semibold text-sm">Drop files or click to browse</div>
        <div className="text-xs text-ink-soft">.txt, .md, .csv, .json read directly. PDFs listed for reference.</div>
      </button>
      <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.json"
        className="hidden" onChange={(e) => onPick(e.target.files)} />
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between text-sm surface-card px-4 py-2">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles((arr) => arr.filter((_, idx) => idx !== i))}
                className="text-xs text-ink-soft hover:text-foreground">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <Field label="Or describe what your agent should know">
        <textarea rows={6} className={inputClass} value={data.knowledge} onChange={(e) => update("knowledge", e.target.value)}
          placeholder="e.g. We sell groceries, deliver in 2-4 hours within Chennai, accept UPI and COD..." />
      </Field>
    </div>
  );
}

function StepCapture({ data, update }: StepProps) {
  const opts = ["Name", "Phone", "Order ID", "Issue type", "Satisfaction", "Callback needed", "Sentiment"];
  const toggle = (x: string) =>
    update("collect", data.collect.includes(x) ? data.collect.filter((y) => y !== x) : [...data.collect, x]);
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">What should we capture from every call?</h2>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {opts.map((o) => (
          <button key={o} onClick={() => toggle(o)}
            className={"text-left rounded-2xl border p-4 transition " +
              (data.collect.includes(o) ? "bg-lime-soft border-foreground" : "border-border bg-surface hover:bg-muted")}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{o}</span>
              {data.collect.includes(o) && <Check className="size-4" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepEscalation({ data, update }: StepProps) {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">When should we hand off to a human?</h2>
      </header>
      <Field label="Escalation rules">
        <textarea rows={5} className={inputClass} value={data.escalation} onChange={(e) => update("escalation", e.target.value)}
          placeholder="e.g. If the caller asks for a manager or sounds upset, transfer to +91 ..." />
      </Field>
    </div>
  );
}

function StepDirection({ data, update }: StepProps) {
  const opts: { v: WizardState["direction"]; title: string; icon: typeof Phone; body: string }[] = [
    { v: "inbound", title: "Inbound", icon: PhoneIncoming, body: "Customers call you. The agent picks up." },
    { v: "outbound", title: "Outbound", icon: PhoneOutgoing, body: "We call your contact list." },
    { v: "both", title: "Both", icon: Phone, body: "Inbound + outbound campaigns from one agent." },
  ];
  return (
    <div className="space-y-6">
      <header><h2 className="font-display font-bold text-2xl">Inbound, outbound, or both?</h2></header>
      <div className="grid md:grid-cols-3 gap-4">
        {opts.map(({ v, title, icon: Icon, body }) => (
          <button key={v} onClick={() => update("direction", v)}
            className={"text-left rounded-2xl border p-5 transition " +
              (data.direction === v ? "bg-lime-soft border-foreground" : "border-border bg-surface hover:bg-muted")}>
            <Icon className="size-5" />
            <div className="mt-3 font-display font-bold">{title}</div>
            <div className="text-xs text-ink-soft mt-1">{body}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepLaunch({ data, projectedCost }: StepProps & { projectedCost: number }) {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display font-bold text-2xl">Review & deploy.</h2>
        <p className="text-sm text-ink-soft mt-1">
          Deploy your agent, then test it live in the browser. You'll connect a real phone number
          (Twilio, Exotel, Plivo, Voxbiz, or your own SIP trunk) right after — no telephony account needed to test.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <SummaryRow label="Business" value={data.business || "—"} />
        <SummaryRow label="Agent" value={data.agentName || "—"} />
        <SummaryRow label="Voice" value={data.voice} />
        <SummaryRow label="Tone" value={data.tone} />
        <SummaryRow label="Languages" value={data.languages.join(", ") || "—"} />
        <SummaryRow label="Direction" value={data.direction} />
        <SummaryRow label="Capturing" value={data.collect.join(", ") || "—"} />
        <SummaryRow label="Projected cost" value={`₹${projectedCost.toFixed(2)}/min`} />
      </div>

      <div className="rounded-2xl bg-foreground text-background p-6 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-lime rounded-full opacity-30 blur-3xl" />
        <div className="font-display font-bold text-lg">Next: online test → connect number</div>
        <p className="text-sm text-white/70 mt-1">
          After deploy you'll land on the in-browser voice tester. Talk to {data.agentName || "your agent"} live,
          then plug in the telephony provider of your choice to go live on a real phone line.
        </p>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">{label}</div>
      <div className="mt-1 font-display font-semibold text-sm truncate">{value}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={"pill px-4 py-2 text-sm font-medium border transition " +
        (active ? "bg-foreground text-background border-foreground" : "bg-surface border-border hover:bg-muted")}>
      {children}
    </button>
  );
}

function SidebarSummary({ data, step }: { data: WizardState; step: number }) {
  return (
    <div className="space-y-4 lg:sticky lg:top-28 h-fit">
      <div className="surface-card p-5">
        <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">Live preview</div>
        <div className="mt-2 font-display font-bold text-lg">{data.agentName || "Your agent"}</div>
        <div className="text-xs text-ink-soft">{data.business || "Your business"} · {data.industry}</div>
        <div className="mt-4 rounded-xl bg-lime-soft border border-lime/40 p-3 text-xs">
          "{(data.greeting || "").replace("{business}", data.business || "your business")}"
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {data.languages.slice(0, 4).map((l) => (
            <span key={l} className="chip-outline text-[10px] !py-1">{l}</span>
          ))}
        </div>
      </div>
      <Link to="/dashboard" className="text-xs text-ink-soft hover:text-foreground inline-flex items-center gap-1">
        <ArrowLeft className="size-3" /> Save & exit
      </Link>
      <div className="text-[10px] text-ink-soft">Step {step + 1}/{steps.length}</div>
    </div>
  );
}
