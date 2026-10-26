import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { mintDemoGeminiLiveToken } from "@/lib/gemini-live-demo.functions";
import { Logo } from "@/components/BlipxNav";
import { ArrowLeft, Loader2, Volume2, PhoneCall, PhoneOff, Sparkles } from "lucide-react";

export const Route = createFileRoute("/demo")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Try a live voice agent — no signup · BlipX" },
      { name: "description", content: "Configure a temporary AI voice agent and talk to it live in your browser. No signup required." },
      { property: "og:title", content: "Try a live BlipX voice agent — no signup" },
      { property: "og:description", content: "Configure a temporary voice agent and talk to it live. No signup." },
    ],
  }),
  component: DemoPage,
});

type Turn = { role: "user" | "assistant"; content: string };
type CallState = "idle" | "connecting" | "listening" | "thinking" | "playing";

// Half-cascade Live model — lowest first-token latency (~300ms vs ~900ms for native-audio).
const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

function resampleLinear(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

type AgentConfig = {
  id: string;
  label: string;
  name: string;
  businessName: string;
  greeting: string;
  tone: string;
  systemPrompt: string;
  languages: string[];
};

const PRESETS: AgentConfig[] = [
  {
    id: "clinic",
    label: "Dental clinic",
    name: "Priya",
    businessName: "Bright Smile Dental",
    greeting: "Hi, Bright Smile Dental — Priya here. How can I help?",
    tone: "warm, calm, reassuring",
    systemPrompt: "Book cleanings, whitening, root canals. Working hours 9am–7pm Mon–Sat. Take name, phone, preferred day.",
    languages: ["English", "Hindi"],
  },
  {
    id: "mart",
    label: "Grocery mart",
    name: "Anika",
    businessName: "Saravana Mart",
    greeting: "Vanakkam! Saravana Mart-il irundhu Anika pesuren. Eppadi help pannalaam?",
    tone: "friendly and quick",
    systemPrompt: "Handle order status, delivery slots, refunds. Ask for order ID. Delivery next day by 10am.",
    languages: ["Tamil", "English"],
  },
  {
    id: "salon",
    label: "Salon",
    name: "Meera",
    businessName: "Aura Salon & Spa",
    greeting: "Hey! Aura Salon, Meera speaking — how can I help you today?",
    tone: "cheerful, upbeat",
    systemPrompt: "Book haircut, colour, facial, spa. Slots 10am–8pm. Ask for stylist preference.",
    languages: ["English", "Hindi"],
  },
  {
    id: "custom",
    label: "✨ Create your own",
    name: "",
    businessName: "",
    greeting: "",
    tone: "warm and friendly",
    systemPrompt: "",
    languages: ["English"],
  },
];

function DemoPage() {
  const mint = useServerFn(mintDemoGeminiLiveToken);

  const [config, setConfig] = useState({ ...PRESETS[0] });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [callState, setCallState] = useState<CallState>("idle");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [inIframe, setInIframe] = useState(false);

  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentAssistantRef = useRef<string>("");
  const currentUserRef = useRef<string>("");
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    try { setInIframe(window.self !== window.top); } catch { setInIframe(true); }
    return () => { void endCall(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, callState]);

  const float32ToBase64Pcm = (f32: Float32Array) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(i16.buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  };

  const playPcmChunk = (base64: string) => {
    if (muted) return;
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    const buffer = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
    };
    setCallState("playing");
  };

  const stopPlayback = () => {
    for (const s of activeSourcesRef.current) {
      try { s.stop(); } catch { /* ignore */ }
      try { s.disconnect(); } catch { /* ignore */ }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  };

  const upsertLastTurn = (role: "user" | "assistant", text: string) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const copy = prev.slice(0, -1);
        copy.push({ role, content: text });
        return copy;
      }
      return [...prev, { role, content: text }];
    });
  };

  const startCall = async () => {
    if (activeRef.current) return;
    setCallState("connecting");
    setTurns([{ role: "assistant", content: config.greeting }]);
    try {
      // Unlock microphone + audio contexts immediately from the button click.
      // If we wait for the token request first, some browsers keep audio silent.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: INPUT_SAMPLE_RATE },
      });
      streamRef.current = stream;

      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      let inputCtx: AudioContext;
      try { inputCtx = new Ctor({ sampleRate: INPUT_SAMPLE_RATE }); }
      catch { inputCtx = new Ctor(); }
      const outputCtx = new Ctor({ sampleRate: OUTPUT_SAMPLE_RATE });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      try { await inputCtx.resume(); } catch { /* ignore */ }
      try { await outputCtx.resume(); } catch { /* ignore */ }
      nextPlayTimeRef.current = 0;
      const inputRate = Math.round(inputCtx.sampleRate);

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(1024, 1, 1);
      sourceNodeRef.current = source;
      processorRef.current = processor;

      const { token, systemInstruction } = await mint({
        data: {
          name: config.name,
          businessName: config.businessName,
          greeting: config.greeting,
          systemPrompt: config.systemPrompt,
          tone: config.tone,
          languages: [...config.languages],
        },
      });

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: token, apiVersion: "v1alpha", httpOptions: { apiVersion: "v1alpha" } });

      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 400, prefixPaddingMs: 60 } },
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Leda" } } },
        },
        callbacks: {
          onopen: () => {
            activeRef.current = true;
            setCallState("listening");
            toast.success("Connected — start speaking");
          },
          onmessage: (msg: any) => {
            const parts = msg?.serverContent?.modelTurn?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                const b64 = p?.inlineData?.data;
                if (b64 && typeof b64 === "string") playPcmChunk(b64);
              }
            }
            const finalInTx = msg?.serverContent?.inputTranscription?.text;
            const interimInTx = msg?.serverContent?.interimInputTranscription?.text;
            const inTx = finalInTx || interimInTx;
            if (inTx) {
              const display = finalInTx ? currentUserRef.current + finalInTx : currentUserRef.current + interimInTx;
              upsertLastTurn("user", display);
              if (finalInTx) currentUserRef.current = display;
              if (finalInTx) setCallState("thinking");
            }
            const outTx = msg?.serverContent?.outputTranscription?.text;
            if (outTx) { currentAssistantRef.current += outTx; upsertLastTurn("assistant", currentAssistantRef.current); }
            if (msg?.serverContent?.turnComplete) {
              currentUserRef.current = "";
              currentAssistantRef.current = "";
              if (activeRef.current) setCallState("listening");
            }
            if (msg?.serverContent?.interrupted) stopPlayback();
          },
          onerror: (e: any) => {
            const message = e?.message || e?.reason || "Live session error";
            console.error("[gemini-live] error", e);
            toast.error(message.includes("not found") || message.includes("not supported")
              ? "Live voice model is unavailable right now. Please try again."
              : message);
          },
          onclose: (e: any) => {
            const reason = e?.reason || e?.message || "";
            if (activeRef.current) toast.error(reason || "Call ended by server");
            void endCall();
          },
        },
      });
      sessionRef.current = session;

      let lastLevelAt = 0;
      processor.onaudioprocess = (e) => {
        if (!activeRef.current || !sessionRef.current) return;
        const input = e.inputBuffer.getChannelData(0);

        // Fast local barge-in: as soon as the mic picks up meaningful speech
        // while the agent is talking, cut playback locally so the user hears
        // themselves take over instantly (don't wait for the server signal).
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        const rms = Math.sqrt(sumSq / input.length);
        if (rms > 0.04 && activeSourcesRef.current.length > 0) {
          stopPlayback();
          setCallState("listening");
        }

        const now = performance.now();
        if (now - lastLevelAt > 100) { setLevel(rms); lastLevelAt = now; }

        const copy = resampleLinear(new Float32Array(input), inputRate, INPUT_SAMPLE_RATE);
        const b64 = float32ToBase64Pcm(copy);
        try {
          sessionRef.current.sendRealtimeInput({ audio: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` } });
        } catch (err) { console.warn("[gemini-live] send failed", err); }
      };
      source.connect(processor);
      const sink = inputCtx.createGain();
      sink.gain.value = 0;
      processor.connect(sink);
      sink.connect(inputCtx.destination);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const message = err instanceof Error ? err.message : "Could not start demo call";
      if (name === "NotAllowedError") toast.error("Microphone blocked. Allow mic access.");
      else if (name === "NotFoundError") toast.error("No microphone found.");
      else toast.error(message);
      await endCall();
    }
  };

  const endCall = async () => {
    activeRef.current = false;
    stopPlayback();
    try { sessionRef.current?.sendRealtimeInput?.({ audioStreamEnd: true }); } catch { /* ignore */ }
    try { sessionRef.current?.close?.(); } catch { /* ignore */ }
    sessionRef.current = null;
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    sourceNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { await inputCtxRef.current?.close(); } catch { /* ignore */ }
    try { await outputCtxRef.current?.close(); } catch { /* ignore */ }
    inputCtxRef.current = null;
    outputCtxRef.current = null;
    currentAssistantRef.current = "";
    currentUserRef.current = "";
    setLevel(0);
    setCallState("idle");
  };

  const active = callState !== "idle";
  const statusLabel: Record<CallState, string> = {
    idle: "Configure your agent, then tap to talk",
    connecting: "Connecting…",
    listening: "Listening — just speak",
    thinking: "Thinking…",
    playing: "Agent is speaking…",
  };

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) setConfig({ ...p });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Logo />
        <Link to="/" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Home
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 pb-16">
        <div className="max-w-2xl">
          <span className="chip-lime">Live demo · No signup</span>
          <h1 className="display-lg mt-4">Build a voice agent in 30 seconds and talk to it.</h1>
          <p className="mt-3 text-ink-soft">
            Pick a preset or write your own persona. Your browser opens a live conversation with a real, human-sounding agent — right here, no phone number needed.
          </p>
        </div>

        {inIframe && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display font-semibold">Mic blocked in preview?</div>
              <div className="text-ink-soft text-xs mt-1">Open in a full tab for the smoothest live conversation.</div>
            </div>
            <a
              href={typeof window !== "undefined" ? window.location.href : "#"}
              target="_blank" rel="noreferrer"
              className="pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-foreground text-background"
            >Open in new tab</a>
          </div>
        )}

        <div className="mt-10 grid lg:grid-cols-[0.9fr_1.1fr] gap-6">
          {/* CONFIG */}
          <div className="surface-card p-6 space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-soft font-semibold mb-2">Start from a preset</div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    disabled={active}
                    className={
                      "pill text-xs px-3 py-1.5 border " +
                      (config.id === p.id ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted")
                    }
                  >{p.label}</button>
                ))}
              </div>
            </div>

            <Field label="Agent name">
              <input value={config.name} disabled={active}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10" />
            </Field>
            <Field label="Business name">
              <input value={config.businessName} disabled={active}
                onChange={(e) => setConfig({ ...config, businessName: e.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10" />
            </Field>
            <Field label="Opening line">
              <input value={config.greeting} disabled={active}
                onChange={(e) => setConfig({ ...config, greeting: e.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10" />
            </Field>
            <Field label="Tone">
              <input value={config.tone} disabled={active}
                onChange={(e) => setConfig({ ...config, tone: e.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10" />
            </Field>
            <Field label="What the agent handles">
              <textarea value={config.systemPrompt} disabled={active} rows={4}
                onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10 resize-none" />
            </Field>
            <Field label="Languages (comma-separated)">
              <input
                value={config.languages.join(", ")}
                disabled={active}
                onChange={(e) => setConfig({ ...config, languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/10"
              />
            </Field>

            <p className="text-xs text-ink-soft">
              This is a temporary demo agent — nothing is saved. Want to keep it, connect a phone number, and go live?{" "}
              <Link to="/wizard" className="text-foreground font-semibold underline underline-offset-2">Build the real thing →</Link>
            </p>
          </div>

          {/* CALL */}
          <div className="surface-card p-6 md:p-8">
            <div className="flex items-center gap-4">
              <span className="grid place-items-center w-14 h-14 rounded-2xl bg-lime text-ink font-display font-bold text-xl">
                {config.name?.charAt(0) || "A"}
              </span>
              <div className="flex-1">
                <div className="font-display font-bold text-xl">{config.name || "Agent"}</div>
                <div className="text-sm text-ink-soft">{config.businessName}</div>
              </div>
              <button
                onClick={() => setMuted((m) => !m)}
                className="pill text-xs px-3 py-1.5 border border-border hover:bg-muted inline-flex items-center gap-1.5"
              >
                <Volume2 className="size-3.5" /> {muted ? "Voice off" : "Voice on"}
              </button>
            </div>

            <div ref={scrollRef} className="mt-6 space-y-3 min-h-[260px] max-h-[380px] overflow-y-auto pr-1">
              {turns.length === 0 && (
                <div className="text-sm text-ink-soft text-center py-16">
                  <Sparkles className="size-5 mx-auto mb-2" />
                  Tap the button below and start talking.
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className={"flex " + (t.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap " +
                    (t.role === "user" ? "bg-foreground text-background" : "bg-muted")
                  }>{t.content || "…"}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                onClick={active ? endCall : startCall}
                disabled={callState === "connecting"}
                className={
                  "pill inline-flex items-center gap-2 px-6 py-3.5 text-sm font-semibold shadow-pill transition " +
                  (active ? "bg-red-500 text-white hover:bg-red-600" : "bg-primary text-primary-foreground hover:opacity-90")
                }
              >
                {callState === "connecting" ? (
                  <><Loader2 className="size-4 animate-spin" /> Connecting…</>
                ) : active ? (
                  <><PhoneOff className="size-4" /> End call</>
                ) : (
                  <><PhoneCall className="size-4" /> Start live call</>
                )}
              </button>
              <div className="text-xs text-ink-soft">{statusLabel[callState]}</div>
              {active && (
                <div className="w-40 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-lime transition-all" style={{ width: `${Math.min(100, level * 400)}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wide text-ink-soft font-semibold mb-1.5">{label}</div>
      {children}
    </label>
  );
}
