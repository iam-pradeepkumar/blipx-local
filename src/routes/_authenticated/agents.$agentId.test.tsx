import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mintGeminiLiveToken } from "@/lib/gemini-live.functions";
import { agentVoiceTurn } from "@/lib/voice-agent.functions";
import { connectPhoneNumber, placeTestCall, type ProviderId } from "@/lib/telephony.functions";
import { saveBrowserTestCall } from "@/lib/agent-test-call.functions";
import { Logo } from "@/components/BlipxNav";
import { Mic, ArrowLeft, Loader2, Volume2, Phone, PhoneCall, Check, Sparkles, PhoneOff, Square } from "lucide-react";


export const Route = createFileRoute("/_authenticated/agents/$agentId/test")({
  head: () => ({ meta: [{ title: "Test agent · BlipX" }] }),
  component: TestAgentPage,
});

type Turn = { role: "user" | "assistant"; content: string };
type CallState = "idle" | "connecting" | "listening" | "thinking" | "playing";

// Half-cascade Live model — lowest first-token latency (~300ms vs ~900ms for native-audio).
const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
const INPUT_SAMPLE_RATE = 16000;   // Gemini expects 16kHz PCM in
const OUTPUT_SAMPLE_RATE = 24000;  // Gemini streams 24kHz PCM out

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

function TestAgentPage() {
  const { agentId } = useParams({ from: "/_authenticated/agents/$agentId/test" });
  const mintToken = useServerFn(mintGeminiLiveToken);
  const saveCall = useServerFn(saveBrowserTestCall);
  const voiceTurn = useServerFn(agentVoiceTurn);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [callState, setCallState] = useState<CallState>("idle");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [inIframe, setInIframe] = useState(false);

  // refs to keep mutable audio state out of React re-renders
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
  const callStartRef = useRef<number>(0);
  const turnsRef = useRef<Turn[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const cascadePlayerRef = useRef<HTMLAudioElement | null>(null);
  const modeRef = useRef<"live" | "cascade">("live");
  const callStateRef = useRef<CallState>("idle");
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    try { setInIframe(window.self !== window.top); } catch { setInIframe(true); }
    return () => { void endCall(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: agent, isLoading: agentLoading, isError: agentError } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("*").eq("id", agentId).maybeSingle();
      if (error) throw error;
      return data;
    },
    retry: false,
  });

  const { data: numbers, refetch: refetchNumbers } = useQuery({
    queryKey: ["phone_numbers", agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("phone_numbers").select("*").eq("agent_id", agentId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!agent,
  });

  useEffect(() => {
    if (agent && turns.length === 0) {
      const greet = agent.greeting || `Hi, this is ${agent.name}. How can I help?`;
      setTurns([{ role: "assistant", content: greet }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    turnsRef.current = turns;
  }, [turns, callState]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  /* -------- PCM helpers -------- */

  // Float32 [-1..1] mono → base64 Int16 LE
  const float32ToBase64Pcm = (f32: Float32Array) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(i16.buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  // Base64 Int16 LE (24kHz) → schedule playback into outputCtx
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

  /* -------- Cascade (Deepgram / Sarvam / ElevenLabs / OpenAI) lifecycle -------- */

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      r.onload = () => {
        const s = String(r.result || "");
        resolve(s.includes(",") ? s.split(",").pop()! : s);
      };
      r.readAsDataURL(blob);
    });

  const encodeWav = (samples: Float32Array, sampleRate: number) => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  const browserRecordingToWav = async (blob: Blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const data = decoded.getChannelData(channel);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
      }
      const sampleRate = 16000;
      return encodeWav(resampleLinear(mono, decoded.sampleRate, sampleRate), sampleRate);
    } finally {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  };

  const stopCascadePlayback = () => {
    const p = cascadePlayerRef.current;
    if (p) { try { p.pause(); } catch { /* ignore */ } p.src = ""; }
    cascadePlayerRef.current = null;
    stopPlayback();
  };

  const base64ToArrayBuffer = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  const ensureCascadeOutputContext = () => {
    const Existing = outputCtxRef.current;
    if (Existing && Existing.state !== "closed") {
      if (Existing.state === "suspended") void Existing.resume().catch(() => undefined);
      return Existing;
    }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor();
    outputCtxRef.current = ctx;
    void ctx.resume().catch(() => undefined);
    return ctx;
  };

  const unlockCascadeAudio = () => {
    try {
      const ctx = ensureCascadeOutputContext();
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => { try { src.disconnect(); } catch { /* ignore */ } };
      src.start();
    } catch (err) {
      console.warn("[cascade] audio unlock failed", err);
    }
  };

  const playCascadeAudio = async (audioBase64: string, myTurn: number, audioMime?: string | null) => {
    if (muted || !activeRef.current || myTurn !== turnIdRef.current) return false;
    const ctx = ensureCascadeOutputContext();
    try { await ctx.resume(); } catch { /* ignore */ }
    const buffer = await ctx.decodeAudioData(base64ToArrayBuffer(audioBase64).slice(0));
    if (muted || !activeRef.current || myTurn !== turnIdRef.current) return false;
    stopCascadePlayback();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    activeSourcesRef.current.push(src);
    cascadePlayerRef.current = null;
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
      try { src.disconnect(); } catch { /* ignore */ }
      if (activeRef.current && myTurn === turnIdRef.current) setCallState("listening");
    };
    setCallState("playing");
    src.start();
    console.log("[cascade] audio scheduled", { seconds: Number(buffer.duration.toFixed(2)), mime: audioMime || "audio" });
    return true;
  };

  // Monotonic turn counter — used to discard stale in-flight responses when
  // the caller barges in on the agent or on a "thinking" turn.
  const turnIdRef = useRef(0);

  const runCascadeTurn = async () => {
    const chunks = recordChunksRef.current;
    recordChunksRef.current = [];
    console.log("[cascade] runTurn chunks:", chunks.length, "bytes:", chunks.reduce((a, c) => a + c.size, 0));
    if (!chunks.length) { if (activeRef.current) setCallState("listening"); return; }
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    if (blob.size < 600) {
      console.log("[cascade] blob too small, skipping", blob.size);
      if (activeRef.current) setCallState("listening");
      return;
    }
    const myTurn = ++turnIdRef.current;
    setCallState("thinking");
    try {
      // Always send a complete WAV. Browser MediaRecorder containers can be
      // valid locally but still decode poorly upstream, which made Deepgram
      // return empty transcripts even though chunks were captured.
      const payloadBlob = await browserRecordingToWav(blob);
      const audioBase64 = await blobToBase64(payloadBlob);
      const history = turnsRef.current.filter((t) => t.content && t.content.trim());
      const res = await voiceTurn({ data: { agentId, history, audioBase64, audioMime: payloadBlob.type } });
      console.log("[cascade] server res:", { transcript: res.transcript, reply: res.reply, noSpeech: (res as any).noSpeech, hasAudio: !!res.audioBase64, ttsError: (res as any).ttsError });
      // Barge-in happened while we were waiting — drop this stale reply.
      if (!activeRef.current || myTurn !== turnIdRef.current) return;
      if ((res as any).noSpeech) { setCallState("listening"); return; }
      if (res.transcript) upsertLastTurn("user", res.transcript);
      if (res.reply) upsertLastTurn("assistant", res.reply);
      if ((res as any).ttsError && !res.audioBase64) {
        const ttsProvider = (res as any).pipeline?.tts ?? (agent as any)?.tts_provider;
        const message = String((res as any).ttsError);
        if (!/elevenlabs/i.test(message) || ttsProvider === "elevenlabs") toast.error(message);
      }
      if (res.audioBase64 && !muted) {
        try {
          const scheduled = await playCascadeAudio(res.audioBase64, myTurn, res.audioMime);
          if (!scheduled && activeRef.current && myTurn === turnIdRef.current) setCallState("listening");
        } catch (err) {
          console.warn("[cascade] web audio playback failed, trying audio element", err);
          if (!activeRef.current || myTurn !== turnIdRef.current) return;
          setCallState("playing");
          const audio = new Audio(`data:${res.audioMime || "audio/mpeg"};base64,${res.audioBase64}`);
          cascadePlayerRef.current = audio;
          audio.onended = () => {
            if (cascadePlayerRef.current === audio) cascadePlayerRef.current = null;
            if (activeRef.current && myTurn === turnIdRef.current) setCallState("listening");
          };
          audio.onerror = () => { if (activeRef.current) setCallState("listening"); };
          await audio.play().catch((playErr) => {
            console.warn("[cascade] audio element playback failed", playErr);
            if (activeRef.current && myTurn === turnIdRef.current) setCallState("listening");
          });
        }
      } else if (activeRef.current) {
        setCallState("listening");
      }
    } catch (err) {
      console.error("[cascade] turn error", err);
      if (!activeRef.current || myTurn !== turnIdRef.current) return;
      const msg = err instanceof Error ? err.message : "Voice turn failed";
      const benign = /hear speech|too short|no speech|Recording too short/i.test(msg);
      if (!benign) toast.error(msg);
      if (activeRef.current) setCallState("listening");
    }
  };


  // VAD state for continuous cascade conversation
  const vadSpeakingRef = useRef(false);
  const vadSilenceStartRef = useRef<number>(0);
  const vadSpeechStartRef = useRef<number>(0);
  const vadAnalyserRafRef = useRef<number | null>(null);

  const startCascadeCall = async () => {
    modeRef.current = "cascade";
    setCallState("connecting");
    unlockCascadeAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (!discardRecordingRef.current && e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        setIsRecording(false);
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          recordChunksRef.current = [];
          return;
        }
        void runCascadeTurn();
      };

      // Continuous VAD via Web Audio analyser
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctor();
      inputCtxRef.current = ctx;
      try { await ctx.resume(); } catch { /* ignore */ }
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      // Lower base threshold + faster silence cutoff = snappier turns.
      // Higher threshold while the agent is speaking so playback bleed
      // (even with AEC) doesn't trigger a false barge-in.
      const BASE_THRESHOLD = 0.006;
      const PLAYBACK_THRESHOLD = 0.05;
      const SILENCE_MS = 320;      // trailing silence that closes a turn — snappier turn-taking
      const MIN_SPEECH_MS = 120;   // minimum voice duration to count as a turn
      let noiseFloor = 0.002;
      let lastLogAt = 0;

      const tick = () => {
        if (!activeRef.current) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);
        const now = performance.now();
        const agentSpeaking = activeSourcesRef.current.length > 0 || (!!cascadePlayerRef.current && !cascadePlayerRef.current.paused);
        if (!agentSpeaking && !vadSpeakingRef.current) noiseFloor = noiseFloor * 0.97 + rms * 0.03;
        const threshold = agentSpeaking ? PLAYBACK_THRESHOLD : Math.max(BASE_THRESHOLD, noiseFloor * 2.5);
        const isSpeech = rms > threshold;

        if (now - lastLogAt > 2000) {
          console.log("[vad] rms:", rms.toFixed(4), "thr:", threshold.toFixed(4), "floor:", noiseFloor.toFixed(4), "speaking:", vadSpeakingRef.current);
          lastLogAt = now;
        }

        if (isSpeech) {
          if (agentSpeaking) {
            stopCascadePlayback();
            turnIdRef.current++;
            setCallState("listening");
          }
          if (!vadSpeakingRef.current && callStateRef.current !== "thinking") {
            const r = recorderRef.current;
            if (r && r.state !== "recording") {
              recordChunksRef.current = [];
              discardRecordingRef.current = false;
              try { r.start(); setIsRecording(true); console.log("[vad] recorder started"); } catch (err) { console.warn("[vad] start failed", err); }
            }
            vadSpeakingRef.current = true;
            vadSpeechStartRef.current = now;
          }
          vadSilenceStartRef.current = 0;
        } else if (vadSpeakingRef.current) {
          if (vadSilenceStartRef.current === 0) vadSilenceStartRef.current = now;
          const silenceElapsed = now - vadSilenceStartRef.current;
          const speechDur = now - vadSpeechStartRef.current;
          if (silenceElapsed >= SILENCE_MS) {
            const actualSpeech = speechDur - silenceElapsed;
            console.log("[vad] silence closed turn — actualSpeech:", actualSpeech.toFixed(0), "ms");
            vadSpeakingRef.current = false;
            vadSilenceStartRef.current = 0;
            const r = recorderRef.current;
            if (r && r.state === "recording") {
              if (actualSpeech >= MIN_SPEECH_MS) {
                try { r.stop(); } catch (err) { console.warn("[vad] stop failed", err); }
              } else {
                // Too short — stop and drop
                discardRecordingRef.current = true;
                try { r.stop(); } catch { /* ignore */ }
                recordChunksRef.current = [];
                setIsRecording(false);
              }
            }
          }
        }
        vadAnalyserRafRef.current = requestAnimationFrame(tick);
      };

      activeRef.current = true;
      callStartRef.current = Date.now();
      setCallState("listening");
      vadAnalyserRafRef.current = requestAnimationFrame(tick);
      toast.success("Live call connected — start speaking");

    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError") toast.error("Microphone blocked. Allow mic access in the browser.");
      else if (name === "NotFoundError") toast.error("No microphone found on this device.");
      else toast.error(err instanceof Error ? err.message : "Could not start call");
      await endCall();
    }
  };


  /* -------- Live call lifecycle -------- */


  const isCascadeAgent = () => {
    const tts = (agent as any)?.tts_provider;
    // Only the Gemini/Live tier uses the realtime bidi socket.
    // Every other TTS provider (deepgram, sarvam, elevenlabs, openai) → cascade STT→LLM→TTS.
    return tts && tts !== "gemini";
  };

  const startCall = async () => {
    if (activeRef.current) return;
    if (isCascadeAgent()) {
      await startCascadeCall();
      return;
    }
    modeRef.current = "live";
    setCallState("connecting");
    try {
      // Create media objects immediately inside the click gesture. Waiting for
      // a server token first can leave browser audio contexts suspended.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
        },
      });
      streamRef.current = stream;

      const InputCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
      let inputCtx: AudioContext;
      try { inputCtx = new InputCtxCtor({ sampleRate: INPUT_SAMPLE_RATE }); }
      catch { inputCtx = new InputCtxCtor(); }
      const outputCtx = new InputCtxCtor({ sampleRate: OUTPUT_SAMPLE_RATE });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      try { await inputCtx.resume(); } catch { /* ignore */ }
      try { await outputCtx.resume(); } catch { /* ignore */ }
      nextPlayTimeRef.current = 0;
      const inputRate = Math.round(inputCtx.sampleRate);

      const source = inputCtx.createMediaStreamSource(stream);
      // Short chunks keep Gemini Live VAD responsive and transcripts flowing.
      const processor = inputCtx.createScriptProcessor(1024, 1, 1);
      sourceNodeRef.current = source;
      processorRef.current = processor;

      // 1. Mint ephemeral token server-side after audio is unlocked.
      const { token, systemInstruction, voiceName } = await mintToken({ data: { agentId } });

      // 2. Import SDK dynamically (keeps it out of the initial bundle)
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: token,
        apiVersion: "v1alpha",
        httpOptions: { apiVersion: "v1alpha" },
      });

      // 4. Open the Live WebSocket session
      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 400, prefixPaddingMs: 60 } },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || "Leda" } },
          },
        },
        callbacks: {
          onopen: () => {
            activeRef.current = true;
            callStartRef.current = Date.now();
            setCallState("listening");
            toast.success("Live call connected — start speaking");
          },
          onmessage: (msg: any) => {
            // Audio chunks
            const parts = msg?.serverContent?.modelTurn?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                const b64 = p?.inlineData?.data;
                if (b64 && typeof b64 === "string") playPcmChunk(b64);
              }
            }
            // Live transcription of what the user said
            const finalInTx = msg?.serverContent?.inputTranscription?.text;
            const interimInTx = msg?.serverContent?.interimInputTranscription?.text;
            const inTx = finalInTx || interimInTx;
            if (inTx) {
              const display = finalInTx ? currentUserRef.current + finalInTx : currentUserRef.current + interimInTx;
              upsertLastTurn("user", display);
              if (finalInTx) currentUserRef.current = display;
              if (finalInTx) setCallState("thinking");
            }
            // Live transcription of the agent's reply
            const outTx = msg?.serverContent?.outputTranscription?.text;
            if (outTx) {
              currentAssistantRef.current += outTx;
              upsertLastTurn("assistant", currentAssistantRef.current);
            }
            // Turn boundary
            if (msg?.serverContent?.turnComplete) {
              currentUserRef.current = "";
              currentAssistantRef.current = "";
              if (activeRef.current) setCallState("listening");
            }
            // Barge-in / interruption
            if (msg?.serverContent?.interrupted) {
              stopPlayback();
            }
          },
          onerror: (e: any) => {
            const message = e?.message || e?.reason || "Live session error";
            console.error("[gemini-live] error", e);
            toast.error(message);
          },
          onclose: (e: any) => {
            const reason = e?.reason || e?.message || "";
            const code = e?.code;
            console.warn("[gemini-live] closed", { code, reason, event: e });
            if (activeRef.current) {
              const friendlyReason = reason.includes("not found") || reason.includes("not supported")
                ? "Gemini Live model was unavailable. Refresh and try again."
                : reason || "Call ended by server";
              toast.error(friendlyReason);
            }
            void endCall();
          },
        },
      });
      sessionRef.current = session;

      // 5. Stream mic → session
      let lastLevelAt = 0;
      processor.onaudioprocess = (e) => {
        if (!activeRef.current || !sessionRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        // compute RMS every frame — cheap, needed for local barge-in
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        const rms = Math.sqrt(sumSq / input.length);
        // Fast local barge-in: cut the agent off immediately when the user speaks,
        // without waiting for the server's `interrupted` event.
        if (rms > 0.04 && activeSourcesRef.current.length > 0) {
          stopPlayback();
          setCallState("listening");
        }
        const now = performance.now();
        if (now - lastLevelAt > 100) { setLevel(rms); lastLevelAt = now; }
        // send PCM (clone — original buffer is reused by the audio thread)
        const copy = resampleLinear(new Float32Array(input), inputRate, INPUT_SAMPLE_RATE);
        const b64 = float32ToBase64Pcm(copy);
        try {
          sessionRef.current.sendRealtimeInput({
            audio: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
          });
        } catch (err) { console.warn("[gemini-live] send failed", err); }
      };
      source.connect(processor);
      // ScriptProcessor needs a destination to fire, but we don't want mic → speakers feedback.
      const sink = inputCtx.createGain();
      sink.gain.value = 0;
      processor.connect(sink);
      sink.connect(inputCtx.destination);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const message = err instanceof Error ? err.message : "Could not start live call";
      if (name === "NotAllowedError") toast.error("Microphone blocked. Allow mic access in the browser.");
      else if (name === "NotFoundError") toast.error("No microphone found on this device.");
      else toast.error(message);
      await endCall();
    }
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

  const endCall = async () => {
    const wasActive = activeRef.current;
    const startedAt = callStartRef.current;
    activeRef.current = false;
    if (vadAnalyserRafRef.current != null) { try { cancelAnimationFrame(vadAnalyserRafRef.current); } catch { /* ignore */ } vadAnalyserRafRef.current = null; }
    vadSpeakingRef.current = false;
    vadSilenceStartRef.current = 0;
    stopPlayback();
    stopCascadePlayback();
    try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ }
    recorderRef.current = null;
    recordChunksRef.current = [];
    setIsRecording(false);
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
    callStartRef.current = 0;
    setLevel(0);
    setCallState("idle");

    // Persist the call so the owner can see collected data on the details page
    if (wasActive && startedAt > 0) {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      const transcript = turnsRef.current.filter((t) => t.content && t.content.trim());
      const hasUser = transcript.some((t) => t.role === "user");
      if (hasUser) {
        try {
          await saveCall({ data: { agentId, transcript, durationSec } });
          toast.success("Call saved", { description: "View captured data on the details page." });
        } catch (err) {
          console.warn("[test-call] save failed", err);
        }
      }
    }
  };

  /* ---------------- render ---------------- */

  if (agentLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-soft">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (!agent || agentError) {
    return (
      <div className="min-h-screen bg-background">
        <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
          <Logo />
          <Link to="/dashboard" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="size-4" /> Dashboard
          </Link>
        </header>
        <main className="max-w-lg mx-auto px-6 py-16 text-center">
          <div className="surface-card p-8">
            <Sparkles className="size-6 mx-auto text-ink-soft" />
            <h1 className="font-display font-bold text-2xl mt-3">Agent not found</h1>
            <p className="text-sm text-ink-soft mt-2">
              This link points to an agent that doesn't exist on your account. Create one in the wizard and you'll land right back here.
            </p>
            <Link to="/wizard" className="mt-6 inline-flex items-center gap-2 pill px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground">
              Build an agent <Sparkles className="size-4" />
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const active = callState !== "idle";
  const statusLabel: Record<CallState, string> = {
    idle: "Tap to start a live conversation",
    connecting: "Connecting to Gemini Live…",
    listening: "Listening… just start speaking",
    thinking: "Thinking…",
    playing: "Agent is speaking…",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Logo />
        <Link to="/dashboard" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-16 space-y-8">
        <div className="surface-card p-6 md:p-8">
          <div className="flex items-center gap-4">
            <span className="grid place-items-center w-14 h-14 rounded-2xl bg-lime text-ink font-display font-bold text-xl">
              {agent.name?.charAt(0) || "A"}
            </span>
            <div className="flex-1">
              <span className="chip-lime">Step 1 · Live test (Gemini Live)</span>
              <h1 className="font-display font-bold text-2xl mt-2">{agent.name}</h1>
              <p className="text-sm text-ink-soft">
                {agent.business_name} · Realtime streaming voice — speak naturally, interrupt any time.
              </p>
            </div>
            <button
              onClick={() => setMuted((m) => !m)}
              className="pill text-xs px-3 py-1.5 border border-border hover:bg-muted inline-flex items-center gap-1.5"
              title="Toggle voice output"
            >
              <Volume2 className="size-3.5" /> {muted ? "Voice off" : "Voice on"}
            </button>
          </div>

          {inIframe && (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display font-semibold">Mic blocked inside the preview?</div>
                <div className="text-ink-soft text-xs mt-1">Open in a full tab for the smoothest live conversation.</div>
              </div>
              <a
                href={typeof window !== "undefined" ? window.location.href : "#"}
                target="_blank" rel="noreferrer"
                className="pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-foreground text-background"
              >Open in new tab</a>
            </div>
          )}

          <div ref={scrollRef} className="mt-8 space-y-3 min-h-[280px] max-h-[420px] overflow-y-auto pr-1">
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
            <div className="flex items-center gap-3">
              <button
                onClick={active ? endCall : startCall}
                disabled={callState === "connecting"}
                className={
                  "relative size-20 rounded-full grid place-items-center transition shadow-pill disabled:opacity-70 " +
                  (active
                    ? "bg-red-500 text-white"
                    : "bg-primary text-primary-foreground hover:opacity-90")
                }
                title={active ? "End call" : "Start live call"}
              >
                {callState === "connecting"
                  ? <Loader2 className="size-7 animate-spin" />
                  : active ? <PhoneOff className="size-7" /> : <Mic className="size-7" />}
                {active && callState !== "connecting" && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full border-2 border-white/60"
                    style={{ transform: `scale(${1 + Math.min(level * 6, 0.8)})`, opacity: 0.55, transition: "transform 60ms linear" }}
                  />
                )}
              </button>
            </div>

            <div className="text-center text-xs text-ink-soft">
              {active && modeRef.current === "cascade"
                ? (callState === "thinking" ? "Thinking…" : callState === "playing" ? "Agent is speaking… (just talk to interrupt)" : isRecording ? "Listening… keep talking" : "Listening… just start speaking")
                : statusLabel[callState]}
            </div>
            {active && (
              <div className="text-[10px] text-ink-soft">
                Pipeline: {(agent as any)?.stt_provider ?? "—"} · {(agent as any)?.llm_provider ?? "—"} · {(agent as any)?.tts_provider ?? "—"}
              </div>
            )}
          </div>

        </div>

        <ConnectNumberSection agentId={agentId} numbers={numbers ?? []} onChanged={refetchNumbers} />
      </main>
    </div>
  );
}


/* --------- Connect number --------- */

const PROVIDERS: {
  id: ProviderId;
  name: string;
  desc: string;
  fields: { key: string; label: string; type?: string; placeholder?: string; hint?: string }[];
}[] = [
  {
    id: "twilio",
    name: "Twilio",
    desc: "Global. Works everywhere. Pay per minute.",
    fields: [
      { key: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxx" },
      { key: "auth_token", label: "Auth Token", type: "password" },
      { key: "from", label: "Twilio phone number (E.164)", placeholder: "+14155551234", hint: "The Twilio DID that will place / receive calls" },
      { key: "answer_url", label: "TwiML answer URL (optional)", placeholder: "https://your.app/twiml" },
    ],
  },
  {
    id: "exotel",
    name: "Exotel",
    desc: "India-first. Great local voice quality.",
    fields: [
      { key: "account_sid", label: "Account SID", placeholder: "your-exotel-sid" },
      { key: "api_key", label: "API Key" },
      { key: "api_token", label: "API Token", type: "password" },
      { key: "subdomain", label: "Cluster subdomain", placeholder: "api.exotel.com" },
      { key: "from", label: "Exophone number (E.164)", placeholder: "+9180xxxxxxxx" },
      { key: "caller_id", label: "Caller ID (optional)" },
    ],
  },
  {
    id: "plivo",
    name: "Plivo",
    desc: "Twilio-alternative with strong APAC + US coverage.",
    fields: [
      { key: "auth_id", label: "Auth ID", placeholder: "MAxxxxxxxx" },
      { key: "auth_token", label: "Auth Token", type: "password" },
      { key: "from", label: "Plivo number (E.164)", placeholder: "+14155551234" },
      { key: "answer_url", label: "Answer URL (optional)" },
    ],
  },
  {
    id: "voxbiz",
    name: "Voxbiz",
    desc: "India Click2Call via Voxbiz API.",
    fields: [
      { key: "api_key", label: "Voxbiz API key", type: "password" },
      { key: "api_url", label: "Voxbiz API URL", placeholder: "https://api.voxbiz.com/v1/click2call" },
      { key: "from", label: "Voxbiz DID (E.164)", placeholder: "+9180xxxxxxxx" },
      { key: "caller_id", label: "Caller ID (optional)" },
    ],
  },
  {
    id: "sip_custom",
    name: "Custom SIP trunk",
    desc: "Bring your own SIP provider / PBX. Inbound routing only from this UI.",
    fields: [
      { key: "sip_username", label: "SIP username" },
      { key: "sip_password", label: "SIP password", type: "password" },
      { key: "sip_host", label: "SIP host / proxy", placeholder: "sip.example.com" },
      { key: "from", label: "Phone number (E.164)", placeholder: "+..." },
    ],
  },
];

type PhoneRow = {
  id: string;
  e164: string;
  label: string | null;
  provider: string;
};

function ConnectNumberSection({
  agentId, numbers, onChanged,
}: { agentId: string; numbers: PhoneRow[]; onChanged: () => void }) {
  const [providerId, setProviderId] = useState<ProviderId>("twilio");
  const [label, setLabel] = useState("Main line");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState<Record<string, string>>({});
  const [calling, setCalling] = useState<string | null>(null);

  const connect = useServerFn(connectPhoneNumber);
  const test = useServerFn(placeTestCall);
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  const submit = async () => {
    const e164 = cfg.from?.trim();
    if (!e164) return toast.error("Phone number (E.164) is required");
    setSaving(true);
    try {
      await connect({ data: { agentId, provider: providerId, e164, label, config: cfg } });
      toast.success("Number connected", { description: `${provider.name} · ${e164}` });
      setCfg({});
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setSaving(false);
    }
  };

  const ring = async (phoneNumberId: string) => {
    const to = testTo[phoneNumberId]?.trim();
    if (!to) return toast.error("Enter a number to ring");
    setCalling(phoneNumberId);
    try {
      await test({ data: { phoneNumberId, to } });
      toast.success("Test call placed", { description: `Ringing ${to}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Call failed");
    } finally {
      setCalling(null);
    }
  };

  return (
    <div className="surface-card p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-11 rounded-2xl bg-foreground text-background">
          <Phone className="size-5" />
        </span>
        <div>
          <span className="chip-outline text-[10px]">Step 2 · Go live on a real number</span>
          <h2 className="font-display font-bold text-xl mt-1">Connect your telephony provider</h2>
          <p className="text-sm text-ink-soft">Pick any provider. Credentials stay on your account.</p>
        </div>
      </div>

      {numbers.length > 0 && (
        <div className="mt-6 space-y-3">
          {numbers.map((n) => (
            <div key={n.id} className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-display font-semibold flex items-center gap-2">
                    <Check className="size-4 text-lime-foreground" /> {n.e164}
                    <span className="chip-outline text-[10px]">{n.provider}</span>
                  </div>
                  <div className="text-xs text-ink-soft mt-0.5">{n.label ?? "—"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={testTo[n.id] ?? ""}
                    onChange={(e) => setTestTo((m) => ({ ...m, [n.id]: e.target.value }))}
                    placeholder="Ring this number +91..."
                    className="rounded-xl border border-input bg-surface px-3 py-2 text-sm w-56"
                  />
                  <button
                    onClick={() => ring(n.id)}
                    disabled={calling === n.id}
                    className="pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-lime text-ink disabled:opacity-60"
                  >
                    {calling === n.id ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
                    Test call
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 border-t border-border pt-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProviderId(p.id); setCfg({}); }}
              className={
                "text-left rounded-2xl border p-3 transition " +
                (providerId === p.id ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted")
              }
            >
              <div className="font-display font-bold text-sm">{p.name}</div>
              <div className={"text-[11px] mt-1 " + (providerId === p.id ? "text-white/70" : "text-ink-soft")}>
                {p.desc}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 grid md:grid-cols-2 gap-4">
          <label className="block">
            <div className="font-display font-semibold text-sm">Label</div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm"
            />
          </label>
          {provider.fields.map((f) => (
            <label key={f.key} className="block">
              <div className="font-display font-semibold text-sm">{f.label}</div>
              {f.hint && <div className="text-xs text-ink-soft mt-0.5">{f.hint}</div>}
              <input
                type={f.type || "text"}
                value={cfg[f.key] ?? ""}
                onChange={(e) => setCfg((m) => ({ ...m, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm"
              />
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={submit}
            disabled={saving}
            className="pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
            Connect {provider.name}
          </button>
        </div>
      </div>
    </div>
  );
}

