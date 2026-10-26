/**
 * Vapi/Retell-style realtime voice pipeline for Twilio Media Streams.
 *
 * Flow per call:
 *   Twilio <Stream> WS  ──μ-law 8k──▶  Deepgram streaming STT
 *   Deepgram final txt  ─────────────▶  LLM (OpenAI / Gemini) with streaming
 *   LLM token stream    ──sentence──▶  ElevenLabs streaming TTS (μ-law 8k)
 *   ElevenLabs audio    ─────────────▶  Twilio <Stream> WS  (barge-in via `clear`)
 *
 * Runs on Cloudflare Workers via WebSocketPair. Each Twilio media stream
 * gets its own Worker isolate; state is per-connection in-memory.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Turn = { role: "user" | "assistant"; content: string };

type AgentCfg = {
  id: string;
  user_id: string;
  name: string;
  business_name: string;
  greeting: string;
  system_prompt: string;
  languages: string[] | null;
  tone: string;
  voice_style: string | null;
  knowledge_base: string | null;
  stt_provider: string;
  stt_model: string;
  llm_provider: string;
  llm_model: string;
  llm_temperature: number;
  tts_provider: string;
  tts_voice_id: string;
  tts_model: string;
  first_message_mode: string;
  interruption_threshold_ms: number;
  silence_timeout_ms: number;
  end_call_phrases: string[] | null;
};

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function loadAgentForCall(callId: string) {
  const { data: call } = await supabaseAdmin
    .from("calls")
    .select("agent_id,user_id")
    .eq("id", callId)
    .maybeSingle();
  if (!call?.agent_id) return null;
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("id", call.agent_id)
    .maybeSingle();
  return agent as AgentCfg | null;
}

function buildSystemPrompt(agent: AgentCfg) {
  return `You ARE ${agent.name}, a real human at ${agent.business_name}. Never say you are AI, a bot, or a model.
Tone: ${agent.tone}. Languages: ${(agent.languages ?? ["English"]).join(", ")}.
Business context: ${agent.system_prompt || "Be helpful, concise, friendly."}
Notes: ${agent.knowledge_base || "None"}.
Speak in ONE short sentence, 6–14 words. Ask one question at a time. Sound human.`;
}

/* ─────────── Outbound WebSocket helper (Cloudflare Workers) ─────────── */
// Cloudflare Workers do NOT support `new WebSocket(url)` for outbound
// connections. The runtime-supported pattern is `fetch(url, { headers: {
// Upgrade: 'websocket' } })` then read `response.webSocket` and call
// `accept()`. Without this, the socket throws immediately, which is what
// caused Twilio to play "an application error has occurred" on real calls.
async function openOutboundWs(url: string, opts?: { subprotocols?: string[]; headers?: Record<string, string> }): Promise<WebSocket> {
  const httpUrl = url.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  const headers: Record<string, string> = { Upgrade: "websocket", ...(opts?.headers ?? {}) };
  if (opts?.subprotocols?.length) headers["Sec-WebSocket-Protocol"] = opts.subprotocols.join(", ");
  const res = await fetch(httpUrl, { headers });
  const ws = (res as unknown as { webSocket?: WebSocket }).webSocket;
  if (!ws) throw new Error(`Outbound WS upgrade to ${httpUrl} failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
  (ws as unknown as { accept: () => void }).accept();
  return ws;
}

/* ─────────── Deepgram streaming STT ─────────── */

function pickDeepgramSttModel(agent: AgentCfg): string {
  // nova-3 is English-optimised; for Indic/multilingual agents use nova-2 which
  // supports 30+ languages including hi/ta/te/mr/bn.
  const langs = (agent.languages ?? []).join(" ").toLowerCase();
  const multilingual = /(hindi|tamil|telugu|marathi|bengali|kannada|gujarati|punjabi|malayalam|hinglish|tanglish|indic)/.test(langs);
  if (agent.stt_provider === "deepgram" && agent.stt_model) return agent.stt_model;
  return multilingual ? "nova-2" : "nova-3";
}

async function openDeepgram(agent: AgentCfg, onFinal: (text: string) => void, onInterim: () => void): Promise<WebSocket> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const model = pickDeepgramSttModel(agent);
  const params = new URLSearchParams({
    encoding: "mulaw",
    sample_rate: "8000",
    channels: "1",
    model,
    smart_format: "true",
    interim_results: "true",
    endpointing: "300",
    utterance_end_ms: "1000",
    vad_events: "true",
  });
  if (model === "nova-2") params.set("language", "multi");
  const url = `wss://api.deepgram.com/v1/listen?${params}`;
  // Use the normal auth header for Worker websocket upgrades. The subprotocol
  // token form is less reliable through fetch()+Upgrade and can silently leave
  // the call connected but never transcribing.
  const ws = await openOutboundWs(url, { headers: { Authorization: `Token ${key}` } });

  let finalBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const appendFinal = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (!finalBuffer) finalBuffer = clean;
    else if (!finalBuffer.toLowerCase().endsWith(clean.toLowerCase())) finalBuffer = `${finalBuffer} ${clean}`;
  };
  const flushFinal = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    const text = finalBuffer.trim();
    finalBuffer = "";
    if (text) onFinal(text);
  };
  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushFinal, 650);
  };

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      if (msg.type === "SpeechStarted") {
        onInterim();
        return;
      }
      if (msg.type === "UtteranceEnd") {
        flushFinal();
        return;
      }
      if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript ?? "").trim();
        if (!text) {
          if (!msg.is_final) onInterim();
          return;
        }
        if (msg.is_final) {
          appendFinal(text);
          if (msg.speech_final) flushFinal();
          else scheduleFlush();
        } else {
          onInterim();
        }
      }
    } catch { /* ignore */ }
  });
  ws.addEventListener("close", () => {
    if (flushTimer) clearTimeout(flushTimer);
  });
  return ws;
}

/* ─────────── Streaming LLM (Lovable AI Gateway default, OpenAI optional) ─────────── */

async function* streamLLM(agent: AgentCfg, history: Turn[]): AsyncGenerator<string> {
  // Route selection:
  //  - openai/*  → OpenAI direct (needs OPENAI_API_KEY)
  //  - google/*, or provider "lovable"/"google" → Lovable AI Gateway (free tier)
  const provider = agent.llm_provider || "lovable";
  const useOpenAiDirect = provider === "openai" && !!process.env.OPENAI_API_KEY;

  const endpoint = useOpenAiDirect
    ? "https://api.openai.com/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";

  const apiKey = useOpenAiDirect ? process.env.OPENAI_API_KEY! : process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error(useOpenAiDirect ? "OPENAI_API_KEY missing" : "LOVABLE_API_KEY missing");

  const headers: Record<string, string> = { "content-type": "application/json" };
  headers.authorization = `Bearer ${apiKey}`;

  // Model id: keep vendor/model form for the gateway; strip prefix for direct OpenAI.
  let model = agent.llm_model || (useOpenAiDirect ? "gpt-4o-mini" : "google/gemini-3-flash-preview");
  if (useOpenAiDirect && model.startsWith("openai/")) model = model.slice("openai/".length);
  if (!useOpenAiDirect && !model.includes("/")) model = `google/${model}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: Number(agent.llm_temperature) || 0.6,
      max_tokens: 120,
      stream: true,
      messages: [
        { role: "system", content: buildSystemPrompt(agent) },
        ...history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
      ],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 200));

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch { /* ignore */ }
    }
  }
}

/* ─────────── ElevenLabs streaming TTS → μ-law 8k ─────────── */

async function openElevenLabs(agent: AgentCfg, onAudio: (b64Mulaw: string) => void, onClose: () => void): Promise<WebSocket> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const voice = agent.tts_voice_id || "EXAVITQu4vr4xnSDxMaL";
  const model = agent.tts_model || "eleven_turbo_v2_5";
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voice}/stream-input?model_id=${model}&output_format=ulaw_8000&optimize_streaming_latency=3`;
  const ws = await openOutboundWs(url);
  // Send the init frame right after accept — no need to wait for `open` since
  // Cloudflare's outbound WS is already usable after `accept()`.
  try {
    ws.send(JSON.stringify({
      text: " ",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true },
      xi_api_key: key,
    }));
  } catch (err) {
    console.warn("[elevenlabs] init send failed", err);
  }
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      if (msg.audio) onAudio(msg.audio);
      if (msg.isFinal) onClose();
    } catch { /* ignore */ }
  });
  return ws;
}

/* ─────────── Deepgram Aura REST TTS → μ-law 8k ─────────── */
// Cheapest option (~₹0.5/min) — REST call returns raw μ-law 8k bytes we can
// forward straight to Twilio in 160-byte frames.
function pickDeepgramTtsModel(agent: AgentCfg): string {
  const model = String(agent.tts_model || "");
  return agent.tts_provider === "deepgram" && /^aura[-_]/i.test(model) ? model : "aura-2-thalia-en";
}

function phoneTtsProvider(agent: AgentCfg): "elevenlabs" | "deepgram" | "sarvam" | "openai" {
  const provider = String(agent.tts_provider || "").toLowerCase();
  if (provider === "elevenlabs" || provider === "deepgram" || provider === "sarvam" || provider === "openai") return provider;
  // Gemini Live audio cannot be bridged directly into Twilio Media Streams in
  // this cascade pipeline, so phone calls use a low-latency μ-law provider.
  return "deepgram";
}

async function speakDeepgramAura(agent: AgentCfg, text: string, onFrame: (b64Mulaw: string) => void, shouldAbort?: () => boolean) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const model = pickDeepgramTtsModel(agent);
  const res = await fetch(
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=mulaw&sample_rate=8000&container=none`,
    {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  if (!res.ok) throw new Error(`Deepgram TTS ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let i = 0; i < buf.length; i += 160) {
    if (shouldAbort?.()) return;
    onFrame(bytesToB64(buf.subarray(i, Math.min(i + 160, buf.length))));
    // 20ms per frame — pace so Twilio buffers stay small and barge-in feels instant.
    if ((i / 160) % 5 === 4) await new Promise((r) => setTimeout(r, 90));
  }
}

/* ─────────── Sarvam REST TTS (Indian voices) → μ-law 8k ─────────── */
// Sarvam returns base64 WAV @ 22050. We strip the 44-byte header, downsample
// to 8k PCM16, then μ-law encode for Twilio.
function pcm16ToMulaw(sample: number): number {
  const BIAS = 0x84, CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exp > 0; mask >>= 1) exp--;
  const mantissa = (sample >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mantissa) & 0xff;
}
async function speakSarvam(agent: AgentCfg, text: string, onFrame: (b64Mulaw: string) => void, shouldAbort?: () => boolean) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY missing");
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      inputs: [text.slice(0, 500)],
      target_language_code: (agent.languages ?? ["hi-IN"])[0]?.includes("Hindi") ? "hi-IN" : "en-IN",
      speaker: agent.tts_voice_id || "anushka",
      model: agent.tts_model || "bulbul:v2",
      speech_sample_rate: 8000,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const j = await res.json() as { audios?: string[] };
  const b64 = j.audios?.[0] ?? "";
  if (!b64) return;
  const wav = b64ToBytes(b64);
  const pcm = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44);
  const mulaw = new Uint8Array(pcm.byteLength / 2);
  for (let i = 0, j2 = 0; j2 < mulaw.length; i += 2, j2++) {
    mulaw[j2] = pcm16ToMulaw(pcm.getInt16(i, true));
  }
  for (let i = 0; i < mulaw.length; i += 160) {
    if (shouldAbort?.()) return;
    onFrame(bytesToB64(mulaw.subarray(i, Math.min(i + 160, mulaw.length))));
    if ((i / 160) % 5 === 4) await new Promise((r) => setTimeout(r, 90));
  }
}

/* ─────────── OpenAI REST TTS via Lovable Gateway → PCM → μ-law 8k ─────────── */
async function speakOpenAI(agent: AgentCfg, text: string, onFrame: (b64Mulaw: string) => void, shouldAbort?: () => boolean) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const allowedVoice = /^(alloy|ash|ballad|coral|echo|fable|nova|onyx|sage|shimmer|verse)$/i.test(agent.tts_voice_id || "");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      voice: allowedVoice ? agent.tts_voice_id : "alloy",
      input: text.slice(0, 800),
      response_format: "wav",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const wav = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const sampleRate = view.getUint32(24, true) || 24000;
  const pcmStart = 44;
  const pcmBytes = wav.byteLength - pcmStart;
  const src = new Int16Array(wav.buffer, wav.byteOffset + pcmStart, pcmBytes / 2);
  const ratio = sampleRate / 8000;
  const outLen = Math.floor(src.length / ratio);
  const mulaw = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) mulaw[i] = pcm16ToMulaw(src[Math.floor(i * ratio)]);
  for (let i = 0; i < mulaw.length; i += 160) {
    if (shouldAbort?.()) return;
    onFrame(bytesToB64(mulaw.subarray(i, Math.min(i + 160, mulaw.length))));
    if ((i / 160) % 5 === 4) await new Promise((r) => setTimeout(r, 90));
  }
}

/* ─────────── Local phone STT fallback (Twilio μ-law → WAV → Lovable STT) ─────────── */
function mulawToPcm16Byte(muLaw: number): number {
  muLaw = ~muLaw & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function encodePcm16Wav(samples: Int16Array, sampleRate = 8000) {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return out;
}

async function transcribePhonePcm(samples: Int16Array) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const wav = encodePcm16Wav(samples, 8000);
  const form = new FormData();
  form.append("model", "openai/gpt-4o-transcribe");
  form.append("file", new Blob([wav], { type: "audio/wav" }), "phone-call.wav");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Lovable STT ${res.status}: ${(await res.text().catch(() => "")).slice(0, 180)}`);
  const json = await res.json().catch(() => null) as { text?: string } | null;
  return (json?.text ?? "").replace(/\s+/g, " ").trim();
}


/* ─────────── Twilio Media Streams pipeline ─────────── */

type CallState = {
  streamSid: string | null;
  callId: string;
  agent: AgentCfg;
  history: Turn[];
  dg: WebSocket | null;
  el: WebSocket | null;
  twilio: WebSocket;
  speaking: boolean;
  turnPending: boolean;
  lastUserAt: number;
  turnStartedAt: number;
  // Bumped on barge-in / new turn. In-flight TTS/LLM loops capture the value
  // and abort on next tick if it changed.
  generation: number;
  localPcm: number[];
  localSpeechActive: boolean;
  localLastVoiceAt: number;
  localSttPending: boolean;
  lastFinalAt: number;
};

function sendClear(state: CallState) {
  state.generation++;
  if (!state.streamSid) return;
  if (state.speaking) {
    try { state.twilio.send(JSON.stringify({ event: "clear", streamSid: state.streamSid })); } catch { /* ignore */ }
  }
  state.speaking = false;
  if (state.el) {
    try { state.el.close(); } catch { /* ignore */ }
    state.el = null;
  }
}

function sendMedia(state: CallState, b64Mulaw: string) {
  if (!state.streamSid) return;
  state.speaking = true;
  try {
    state.twilio.send(JSON.stringify({
      event: "media",
      streamSid: state.streamSid,
      media: { payload: b64Mulaw },
    }));
  } catch { /* twilio ws closed */ }
}

async function flushLocalPhoneStt(state: CallState) {
  if (!state.localSpeechActive || state.localSttPending) return;
  state.localSpeechActive = false;
  const pcm = state.localPcm.splice(0);
  const durationMs = (pcm.length / 8000) * 1000;
  if (durationMs < 360) return;

  state.localSttPending = true;
  try {
    if (Date.now() - state.lastFinalAt < 1200) return;
    const text = await transcribePhonePcm(new Int16Array(pcm));
    if (text && Date.now() - state.lastFinalAt >= 1200) {
      state.lastFinalAt = Date.now();
      await runTurn(state, text);
    }
  } catch (err) {
    console.warn("[realtime] local phone STT fallback failed", err);
  } finally {
    state.localSttPending = false;
  }
}

function processLocalPhoneSttFrame(state: CallState, mulaw: Uint8Array) {
  const now = Date.now();
  let sumAbs = 0;
  let peak = 0;
  const pcm = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = mulawToPcm16Byte(mulaw[i]);
    pcm[i] = sample;
    const abs = Math.abs(sample);
    sumAbs += abs;
    if (abs > peak) peak = abs;
  }
  const avg = sumAbs / Math.max(1, pcm.length);
  const voiced = avg > 260 || peak > 1200;

  if (voiced) {
    state.lastUserAt = now;
    state.localLastVoiceAt = now;
    if (!state.localSpeechActive) {
      state.localSpeechActive = true;
      state.localPcm = [];
    }
    if (state.speaking) sendClear(state);
  }

  if (state.localSpeechActive) {
    if (state.localPcm.length < 8000 * 12) state.localPcm.push(...pcm);
    if (!voiced && now - state.localLastVoiceAt > 650) void flushLocalPhoneStt(state);
  }
}

async function speakRestTtsWithFallback(
  state: CallState,
  text: string,
  preferred: "deepgram" | "sarvam" | "openai" | "elevenlabs",
  isStale: () => boolean,
) {
  const providers = Array.from(new Set([preferred, "deepgram", "openai", "sarvam"])).filter((p) => p !== "elevenlabs") as Array<"deepgram" | "sarvam" | "openai">;
  let lastError: unknown;
  for (const provider of providers) {
    if (isStale()) return;
    try {
      if (provider === "deepgram") return await speakDeepgramAura(state.agent, text, (b64) => sendMedia(state, b64), isStale);
      if (provider === "sarvam") return await speakSarvam(state.agent, text, (b64) => sendMedia(state, b64), isStale);
      return await speakOpenAI(state.agent, text, (b64) => sendMedia(state, b64), isStale);
    } catch (err) {
      lastError = err;
      console.warn(`[tts] ${provider} failed, trying fallback`, err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All TTS providers failed");
}

async function runTurn(state: CallState, userText: string) {
  if (state.turnPending) return;
  state.turnPending = true;
  state.turnStartedAt = Date.now();
  state.generation++;
  const gen = state.generation;
  const isStale = () => state.generation !== gen;
  state.history.push({ role: "user", content: userText });

  const phrases = state.agent.end_call_phrases ?? [];
  const lower = userText.toLowerCase();
  if (phrases.some((p) => lower.includes(p.toLowerCase()))) {
    try { await speakSentence(state, "Thanks for calling. Goodbye!"); } catch { /* ignore */ }
    setTimeout(() => { try { state.twilio.close(); } catch { /* ignore */ } }, 1500);
    state.turnPending = false;
    return;
  }

  try {
    const provider = phoneTtsProvider(state.agent);
    if (provider === "elevenlabs") {
      try {
        state.el = await openElevenLabs(
          state.agent,
          (audio) => { if (!isStale()) sendMedia(state, audio); },
          () => { state.speaking = false; },
        );
      } catch (err) {
        console.warn("[elevenlabs] open failed, falling back", err);
        state.el = null;
      }
    }

    let assistantText = "";
    let buffer = "";
    try {
      for await (const token of streamLLM(state.agent, state.history)) {
        if (isStale()) break;
        assistantText += token;
        buffer += token;
        if (provider === "elevenlabs") {
          const m = buffer.match(/^(.*?[.!?،。]\s+)(.*)$/s);
          if (m && state.el?.readyState === 1) {
            try { state.el.send(JSON.stringify({ text: m[1], try_trigger_generation: true })); } catch { /* ignore */ }
            buffer = m[2];
          }
        }
      }
    } catch (err) {
      console.warn("[llm] stream failed", err);
      if (!assistantText) assistantText = "Sorry, could you say that again?";
    }
    if (isStale()) { state.turnPending = false; return; }

    const usedElevenLabs = provider === "elevenlabs" && state.el;
    if (usedElevenLabs) {
      try {
        if (buffer && state.el?.readyState === 1) state.el.send(JSON.stringify({ text: buffer + " ", try_trigger_generation: true }));
        if (state.el?.readyState === 1) state.el.send(JSON.stringify({ text: "" }));
      } catch { /* ignore */ }
    } else {
      const say = assistantText.trim();
      if (say) {
        state.speaking = true;
        try {
          await speakRestTtsWithFallback(state, say, provider, isStale);
        } catch (err) {
          console.warn("[tts] failed", err);
        } finally { state.speaking = false; }
      }
    }

    state.history.push({ role: "assistant", content: assistantText.trim() });
    try {
      await supabaseAdmin.from("calls").update({
        transcript: state.history as unknown as never,
        latency_ms: Date.now() - state.turnStartedAt,
      } as never).eq("id", state.callId);
    } catch { /* ignore */ }
  } catch (err) {
    console.error("[realtime] turn failed", err);
  } finally {
    state.turnPending = false;
  }
}

async function speakSentence(state: CallState, text: string) {
  const provider = phoneTtsProvider(state.agent);
  const gen = state.generation;
  const isStale = () => state.generation !== gen;
  const speakOnce = async (fn: () => Promise<void>) => {
    state.speaking = true;
    try { await fn(); } catch (err) { console.warn("[tts] failed", err); } finally { state.speaking = false; }
  };
  if (provider === "deepgram" || provider === "sarvam" || provider === "openai") {
    return speakOnce(() => speakRestTtsWithFallback(state, text, provider, isStale));
  }
  if (provider === "elevenlabs") {
    try {
      const el = await openElevenLabs(state.agent, (audio) => { if (!isStale()) sendMedia(state, audio); }, () => { state.speaking = false; });
      state.el = el;
      el.send(JSON.stringify({ text: text + " ", try_trigger_generation: true }));
      el.send(JSON.stringify({ text: "" }));
      return;
    } catch (err) {
      console.warn("[elevenlabs] speakSentence failed, falling back", err);
      return speakOnce(() => speakDeepgramAura(state.agent, text, (b64) => sendMedia(state, b64), isStale));
    }
  }
  return speakOnce(() => speakDeepgramAura(state.agent, text, (b64) => sendMedia(state, b64), isStale));
}

/**
 * Handles the Twilio Media Streams WebSocket upgrade.
 * Called from the route with the WebSocketPair server side.
 */
function attachTwilioMediaPipeline(server: WebSocket, callId: string, agent: AgentCfg, firstMessage?: unknown) {
  const state: CallState = {
    streamSid: null,
    callId,
    agent,
    history: [],
    dg: null,
    el: null,
    twilio: server,
    speaking: false,
    turnPending: false,
    lastUserAt: Date.now(),
    turnStartedAt: 0,
    generation: 0,
    localPcm: [],
    localSpeechActive: false,
    localLastVoiceAt: 0,
    localSttPending: false,
    lastFinalAt: 0,
  };

  const onMessage = async (ev: MessageEvent | { data: unknown }) => {
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      switch (msg.event) {
        case "start": {
          state.streamSid = msg.start?.streamSid ?? null;
          try {
            state.dg = await openDeepgram(
              agent,
              (finalText) => {
                state.lastFinalAt = Date.now();
                state.localSpeechActive = false;
                state.localPcm = [];
                void runTurn(state, finalText);
              },
              () => {
                // Interim = user is speaking → barge in
                state.lastUserAt = Date.now();
                if (state.speaking) sendClear(state);
              },
            );
          } catch (err) {
            console.error("[realtime] Deepgram STT open failed", err);
            try { await speakSentence(state, "Sorry, I'm having trouble hearing you. Please try calling again in a moment."); } catch { /* ignore */ }
            setTimeout(() => { try { server.close(1000, "stt-unavailable"); } catch { /* ignore */ } }, 2500);
            return;
          }
          if (agent.first_message_mode === "assistant-speaks-first") {
            const greet = (agent.greeting || `Hi, this is ${agent.name}.`).slice(0, 200);
            state.history.push({ role: "assistant", content: greet });
            void speakSentence(state, greet);
          }
          break;
        }
        case "media": {
          const payload = msg.media?.payload;
          if (payload) processLocalPhoneSttFrame(state, b64ToBytes(payload));
          if (payload && state.dg?.readyState === 1) {
            state.dg.send(b64ToBytes(payload));
          }
          break;
        }
        case "stop": {
          try { state.dg?.close(); } catch { /* ignore */ }
          try { state.el?.close(); } catch { /* ignore */ }
          server.close();
          break;
        }
      }
    } catch (err) {
      console.error("[realtime] twilio msg failed", err);
    }
  };

  server.addEventListener("message", onMessage as unknown as EventListener);
  if (firstMessage) void onMessage({ data: JSON.stringify(firstMessage) });

  server.addEventListener("close", () => {
    try { state.dg?.close(); } catch { /* ignore */ }
    try { state.el?.close(); } catch { /* ignore */ }
  });
}

export async function handleTwilioMediaStream(server: WebSocket, callId: string) {
  const agent = await loadAgentForCall(callId);
  if (!agent) {
    server.close(1011, "Agent not found");
    return;
  }
  attachTwilioMediaPipeline(server, callId, agent);
}

export async function handleTwilioMediaStreamWithStartAuth(server: WebSocket) {
  const authTimer = setTimeout(() => {
    try { server.close(1008, "stream-auth-timeout"); } catch { /* ignore */ }
  }, 5000);

  const onMessage = async (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      if (msg.event !== "start") return;
      clearTimeout(authTimer);

      const params = msg.start?.customParameters ?? msg.start?.custom_parameters ?? {};
      const phoneNumberId = String(params.phoneNumberId ?? "");
      const callId = String(params.callId ?? "");
      const token = String(params.token ?? "");
      const { verifyTwilioStreamToken } = await import("./twilio-stream-route.server");
      const verified = await verifyTwilioStreamToken(phoneNumberId, callId, token);
      if (!verified) {
        console.warn("[realtime] rejected unauthenticated Twilio stream start");
        server.close(1008, "unauthorized-stream");
        return;
      }

      const agent = await loadAgentForCall(callId);
      if (!agent) {
        server.close(1011, "Agent not found");
        return;
      }

      server.removeEventListener("message", onMessage as unknown as EventListener);
      attachTwilioMediaPipeline(server, callId, agent, msg);
    } catch (err) {
      clearTimeout(authTimer);
      console.error("[realtime] start auth failed", err);
      server.close(1008, "invalid-stream-start");
    }
  };

  server.addEventListener("message", onMessage as unknown as EventListener);
  server.addEventListener("close", () => clearTimeout(authTimer));
}
