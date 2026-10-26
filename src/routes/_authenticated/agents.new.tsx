import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BlipxNav } from "@/components/BlipxNav";
import { draftAgentFromDescription, createAgent } from "@/lib/agent-generate.functions";
import { transcribeAgentDescription } from "@/lib/agent-voice-describe.functions";
import { getVoiceSample } from "@/lib/voice-samples.functions";
import { TIERS, TIER_INR, MAX_INR_PER_MIN, TIER_LANGUAGES, voicesForProvider, type TierId } from "@/lib/voice-providers";
import { ArrowLeft, Sparkles, Loader2, Wand2, ArrowRight, Rocket, X, Plus, Mic, Square, Volume2, Zap, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/agents/new")({
  head: () => ({ meta: [{ title: "Describe your agent · BlipX" }] }),
  component: NewAgentPage,
});

const EXAMPLE = `This voice agent is for outbound. It calls students and gives career guidance by asking their 12th marks, calculating their cutoff live, and asking their preferred location, fees, and colleges. Based on those details, it recommends matching colleges. Capture name, marks, calculated cutoff, preferred college, location, fees, plus AI summary and call recording.`;

type Spec = Awaited<ReturnType<typeof draftAgentFromDescription>>["spec"];
type RecState = "idle" | "recording" | "transcribing";

function NewAgentPage() {
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [busy, setBusy] = useState(false);
  const [recState, setRecState] = useState<RecState>("idle");
  const draft = useServerFn(draftAgentFromDescription);
  const create = useServerFn(createAgent);
  const transcribe = useServerFn(transcribeAgentDescription);
  const navigate = useNavigate();

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Pick a mime the browser actually supports
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
      const mimeType = candidates.find((m) => (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder?.isTypeSupported?.(m)) || "";
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size < 1200) {
          setRecState("idle");
          toast.error("That recording was too short — try again.");
          return;
        }
        setRecState("transcribing");
        try {
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
          const audioBase64 = btoa(bin);
          const { english } = await transcribe({ data: { audioBase64, mimeType: blob.type } });
          setDescription((prev) => (prev.trim() ? `${prev.trim()}\n\n${english}` : english));
          toast.success("Transcribed — review and edit if needed.");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setRecState("idle");
        }
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecState("recording");
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError") toast.error("Microphone blocked. Allow mic access in the browser.");
      else if (name === "NotFoundError") toast.error("No microphone found on this device.");
      else toast.error(err instanceof Error ? err.message : "Could not start recording");
      setRecState("idle");
    }
  };

  const stopRecording = () => {
    try { mediaRecRef.current?.stop(); } catch { /* ignore */ }
    mediaRecRef.current = null;
  };



  const onDraft = async () => {
    if (description.trim().length < 20) {
      toast.error("Describe your agent in a few sentences.");
      return;
    }
    setBusy(true);
    try {
      const { spec } = await draft({ data: { description } });
      setSpec(spec);
      toast.success("Draft ready — review and confirm.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to draft agent");
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async () => {
    if (!spec) return;
    setBusy(true);
    try {
      const { agent } = await create({ data: spec });
      toast.success(`${agent.name} is live!`);
      navigate({ to: "/agents/$agentId/test", params: { agentId: agent.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlipxNav />
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/dashboard" className="text-xs text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3" /> Back to dashboard
        </Link>

        {!spec ? (
          <>
            <div className="mt-6">
              <span className="chip-lime inline-flex items-center gap-1.5"><Sparkles className="size-3" /> AI-guided setup</span>
              <h1 className="display-lg mt-3">Describe your agent.</h1>
              <p className="text-ink-soft mt-2">
                Tell us in plain English what this voice agent should do — who it calls, what it asks, and what to capture. We'll draft it for you.
              </p>
            </div>

            <div className="surface-card p-6 md:p-8 mt-8">
              <label className="block">
                <div className="font-display font-semibold text-sm">What should your agent do?</div>
                <div className="text-xs text-ink-soft mt-0.5">The more specific you are, the better it works. Speak any language — we translate to English.</div>
                <div className="relative mt-3">
                  <textarea
                    rows={10}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={EXAMPLE}
                    className="w-full rounded-2xl border border-input bg-surface px-4 py-3 pr-14 text-sm outline-none focus:border-foreground transition"
                  />
                  {recState === "recording" ? (
                    <button
                      type="button"
                      onClick={stopRecording}
                      title="Stop recording"
                      aria-label="Stop recording"
                      className="absolute bottom-3 right-3 grid place-items-center size-10 rounded-full bg-red-500 text-white shadow-md animate-pulse hover:opacity-90"
                    >
                      <Square className="size-4 fill-white" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={recState === "transcribing" || busy}
                      title="Describe by voice"
                      aria-label="Describe by voice"
                      className="absolute bottom-3 right-3 grid place-items-center size-10 rounded-full bg-foreground text-background shadow-md hover:opacity-90 disabled:opacity-60"
                    >
                      {recState === "transcribing" ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
                    </button>
                  )}
                </div>
              </label>

              <button type="button" onClick={() => setDescription(EXAMPLE)}
                className="mt-3 text-xs text-ink-soft hover:text-foreground inline-flex items-center gap-1">
                <Wand2 className="size-3" /> Use example
              </button>



              <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-6">
                <button onClick={onDraft} disabled={busy}
                  className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-lime text-ink hover:opacity-90 disabled:opacity-60">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {busy ? "Drafting..." : "Next: review draft"}
                  {!busy && <ArrowRight className="size-4" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <ReviewStep
            spec={spec}
            onChange={setSpec}
            onBack={() => setSpec(null)}
            onCreate={onCreate}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  spec, onChange, onBack, onCreate, busy,
}: {
  spec: Spec;
  onChange: (s: Spec) => void;
  onBack: () => void;
  onCreate: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof Spec>(k: K, v: Spec[K]) => onChange({ ...spec, [k]: v });
  const [newField, setNewField] = useState("");

  return (
    <>
      <div className="mt-6">
        <span className="chip-lime inline-flex items-center gap-1.5"><Sparkles className="size-3" /> Draft ready</span>
        <h1 className="display-lg mt-3">Review your agent.</h1>
        <p className="text-ink-soft mt-2">
          Tweak anything before it goes live. The greeting is what the caller hears first; the knowledge base is what your agent knows.
        </p>
      </div>

      <div className="surface-card p-6 md:p-8 mt-8 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Agent name">
            <input value={spec.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Business name">
            <input value={spec.business_name} onChange={(e) => set("business_name", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Industry">
            <input value={spec.industry} onChange={(e) => set("industry", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Direction">
            <select value={spec.direction}
              onChange={(e) => set("direction", e.target.value as Spec["direction"])} className={inputCls}>
              <option value="outbound">Outbound (calls out)</option>
              <option value="inbound">Inbound (receives calls)</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <Field label="Tone">
            <input value={spec.tone} onChange={(e) => set("tone", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Languages">
            <LanguageMultiSelect
              tier={((spec as unknown as { tier?: TierId }).tier ?? "ultra")}
              value={spec.languages}
              onChange={(langs) => set("languages", langs)}
            />
          </Field>
        </div>

        <Field label="Greeting (what the caller hears first)">
          <textarea rows={2} value={spec.greeting} onChange={(e) => set("greeting", e.target.value)} className={inputCls} />
        </Field>

        <TierPicker spec={spec} onChange={onChange} />

        <VoicePicker
          ttsProvider={(spec as unknown as { tts_provider?: string }).tts_provider ?? "deepgram"}
          value={(spec as unknown as { tts_voice_id?: string }).tts_voice_id ?? spec.voice_name ?? ""}
          onChange={(voiceId) => onChange({ ...spec, tts_voice_id: voiceId, voice_name: voiceId } as Spec)}
        />



        <Field label="System prompt (agent's runbook)">
          <textarea rows={8} value={spec.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} className={inputCls + " font-mono text-xs"} />
        </Field>

        <Field label="Knowledge base (facts, formulas, rules)">
          <textarea rows={5} value={spec.knowledge_base} onChange={(e) => set("knowledge_base", e.target.value)}
            placeholder="e.g. Cutoff = (Physics + Chemistry)/2 + Maths. Fee ranges by tier..."
            className={inputCls + " text-xs"} />
        </Field>

        <Field label="Data to capture on every call">
          <div className="flex flex-wrap gap-2 mt-2">
            {spec.capture_fields.map((f, i) => (
              <span key={i} className="chip-outline inline-flex items-center gap-1.5 !text-xs">
                {f}
                <button type="button" onClick={() => set("capture_fields", spec.capture_fields.filter((_, idx) => idx !== i))}
                  className="text-ink-soft hover:text-foreground"><X className="size-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <input value={newField} onChange={(e) => setNewField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newField.trim()) {
                  e.preventDefault();
                  set("capture_fields", [...spec.capture_fields, newField.trim()]);
                  setNewField("");
                }
              }}
              placeholder="Add a field, e.g. Phone" className={inputCls} />
            <button type="button" onClick={() => {
              if (!newField.trim()) return;
              set("capture_fields", [...spec.capture_fields, newField.trim()]);
              setNewField("");
            }} className="pill inline-flex items-center gap-1 px-3 py-2 text-xs bg-foreground text-background">
              <Plus className="size-3" /> Add
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
          <button onClick={onBack} disabled={busy} className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="size-3.5" /> Edit description
          </button>
          <button onClick={onCreate} disabled={busy}
            className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-lime text-ink hover:opacity-90 disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            {busy ? "Deploying..." : "Deploy agent"}
          </button>
        </div>
      </div>
    </>
  );
}

const inputCls = "mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:border-foreground transition";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="font-display font-semibold text-sm">{label}</div>
      {children}
    </label>
  );
}

function VoicePicker({ ttsProvider, value, onChange }: { ttsProvider: string; value: string; onChange: (v: string) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Record<string, string>>({});
  const fetchSample = useServerFn(getVoiceSample);
  const voices = voicesForProvider(ttsProvider);

  const preview = async (voice: string) => {
    try {
      audioRef.current?.pause();
      setPlaying(voice);
      const cacheKey = `${ttsProvider}:${voice}`;
      let dataUrl = cacheRef.current[cacheKey];
      if (!dataUrl) {
        const { audioBase64, mimeType } = await fetchSample({ data: { voiceName: voice, provider: ttsProvider } });
        dataUrl = `data:${mimeType};base64,${audioBase64}`;
        cacheRef.current[cacheKey] = dataUrl;
      }
      const audio = new Audio(dataUrl);
      audioRef.current = audio;
      audio.onended = () => setPlaying(null);
      audio.onerror = () => { setPlaying(null); toast.error("Couldn't play sample"); };
      await audio.play();
    } catch (err) {
      setPlaying(null);
      toast.error(err instanceof Error ? err.message : "Preview failed");
    }
  };


  return (
    <div>
      <div className="font-display font-semibold text-sm">Voice</div>
      <div className="text-xs text-ink-soft mt-0.5">
        Voices available on the <b>{ttsProvider}</b> engine. Switch tier above to see other voices.
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
        {voices.map((v) => {
          const active = value === v.id;
          const [name, ...rest] = v.label.split(" · ");
          const hint = rest.join(" · ");
          return (
            <div key={v.id}
              className={"relative rounded-2xl border p-3 transition cursor-pointer " +
                (active ? "border-foreground bg-lime-soft" : "border-border hover:bg-muted")}>
              <button type="button" onClick={() => onChange(v.id)} className="w-full text-left">
                <div className="font-display font-bold text-sm">{name}</div>
                {hint && <div className="text-[11px] text-ink-soft mt-0.5">{hint}</div>}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); preview(v.id); }}
                title={`Preview ${name}`}
                className="absolute top-2 right-2 grid place-items-center size-7 rounded-full bg-foreground text-background hover:opacity-90">
                {playing === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <Volume2 className="size-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LanguageMultiSelect({ tier, value, onChange }: { tier: TierId; value: string[]; onChange: (v: string[]) => void }) {
  const options = TIER_LANGUAGES[tier] ?? TIER_LANGUAGES.ultra;
  const toggle = (lang: string) => {
    if (value.includes(lang)) {
      const next = value.filter((l) => l !== lang);
      onChange(next.length ? next : [lang]); // keep at least one
    } else {
      onChange([...value, lang]);
    }
  };
  return (
    <div>
      <div className="text-[11px] text-ink-soft mt-0.5">
        Supported on the <b>{tier}</b> engine. Tap to toggle — the agent will auto-detect between selected languages.
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((lang) => {
          const active = value.includes(lang);
          return (
            <button key={lang} type="button" onClick={() => toggle(lang)}
              className={"rounded-full border px-3 py-1 text-xs transition " +
                (active ? "border-foreground bg-lime-soft" : "border-border hover:bg-muted")}>
              {lang}
            </button>
          );
        })}
      </div>
    </div>
  );
}


function TierPicker({ spec, onChange }: { spec: Spec; onChange: (s: Spec) => void }) {
  const currentTier = (spec as unknown as { tier?: TierId }).tier ?? "ultra";
  const pick = (id: TierId) => {
    const t = TIERS.find((x) => x.id === id);
    if (!t) return;
    const allowed = TIER_LANGUAGES[id] ?? [];
    const filteredLangs = (spec.languages ?? []).filter((l: string) => allowed.includes(l));
    onChange({
      ...spec,
      ...(t.defaults as object),
      tier: id,
      voice_name: t.defaults.tts_voice_id,
      languages: filteredLangs.length ? filteredLangs : [allowed[0] ?? "English"],
    } as Spec);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-display font-semibold text-sm inline-flex items-center gap-2">
            <Zap className="size-4 text-lime" /> Voice engine
          </div>
          <div className="text-xs text-ink-soft mt-0.5">
            Every option stays under ₹{MAX_INR_PER_MIN}/min. Pick one — you can switch later.
          </div>
        </div>
      </div>
      <div className="mt-3 grid md:grid-cols-2 gap-2">
        {TIERS.map((t) => {
          const active = currentTier === t.id;
          return (
            <button key={t.id} type="button" onClick={() => pick(t.id)}
              className={"text-left rounded-2xl border p-4 transition " +
                (active ? "border-foreground bg-lime-soft" : "border-border hover:bg-muted")}>
              <div className="flex items-center justify-between">
                <div className="font-display font-bold text-sm">{t.label}</div>
                {active && <Check className="size-4" />}
              </div>
              <div className="text-[11px] text-ink-soft mt-1">{t.description}</div>
              <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-background/60 border border-border px-2 py-0.5 text-[11px]">
                ~₹{TIER_INR[t.id]}/min
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
