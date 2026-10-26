import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ChatTurn = { role: "user" | "assistant"; content: string };
type TextInput = { agentId: string; history: ChatTurn[]; message: string; includeAudio?: boolean };
type VoiceInput = { agentId: string; history: ChatTurn[]; audioBase64: string; audioMime?: string };

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

type AgentConfig = {
  name: string;
  business_name: string;
  greeting: string;
  system_prompt: string;
  languages: string[] | null;
  tone: string;
  stt_provider: string | null;
  stt_model: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  tts_provider: string | null;
  tts_model: string | null;
  tts_voice_id: string | null;
};

function getLovableKey() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Voice AI is not configured (missing gateway key)");
  return key;
}

function bytesToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const cleaned = base64.includes(",") ? base64.split(",").pop() || "" : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function mimeToExt(mime?: string) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

function normalizeSarvamSttModel(model?: string | null) {
  if (!model || model === "saarika:v2" || model === "saarika:v1") return "saarika:v2.5";
  return model;
}

function normalizeOpenAISttModel(model?: string | null) {
  if (!model) return "openai/gpt-4o-transcribe";
  if (model === "gpt-4o-transcribe" || model === "gpt-4o-mini-transcribe") return `openai/${model}`;
  return model;
}

async function loadAgent(context: { supabase: any; userId: string }, agentId: string): Promise<AgentConfig> {
  const { data, error } = await context.supabase
    .from("agents")
    .select("name,business_name,greeting,system_prompt,languages,tone,stt_provider,stt_model,llm_provider,llm_model,tts_provider,tts_model,tts_voice_id")
    .eq("id", agentId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Agent not found");
  return data as AgentConfig;
}

function systemPrompt(agent: AgentConfig) {
  return `You are ${agent.name}, a warm human-sounding voice receptionist for ${agent.business_name}.
Tone: ${agent.tone}. Languages you can speak: ${(agent.languages ?? ["English"]).join(", ")}.
Greeting reference: ${agent.greeting}
Business context: ${agent.system_prompt || "Be helpful, concise, and friendly."}

You are on a LIVE phone-style voice call. Rules:
- Reply like a real human, never mention AI, models, or prompts.
- Keep replies to ONE short spoken sentence, ideally 4-10 words. Never long-winded.
- Ask only one question at a time. Sound natural, not scripted.
- Use light acknowledgements ("sure", "got it", "okay", "sari", "seri") when appropriate.
- If the caller interrupts you, acknowledge briefly and answer their new point directly.

LANGUAGE MATCHING (very important):
- Detect the caller's language AND script from their last message and mirror it exactly.
- If they speak pure English → reply in English.
- If they speak pure Tamil (Tamil script) → reply in Tamil script.
- If they speak Tanglish (Tamil words written in English letters, or Tamil + English mixed in one sentence) → reply in the SAME Tanglish style using Roman/English letters only. Do NOT switch to Tamil script.
- Same rule applies for Hinglish, Benglish, etc. — always match the caller's script and code-mix ratio.`;
}

/* ---------------- STT providers ---------------- */

async function sttDeepgram(bytes: Uint8Array, mime: string, model: string) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing — add it in project secrets");
  const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model || "nova-3")}&smart_format=true&punctuate=true&detect_language=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": mime || "audio/wav" },
    body: new Blob([bytes as unknown as BlobPart], { type: mime || "audio/wav" }),
  });
  if (!res.ok) throw new Error(`Deepgram STT failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = await res.json() as any;
  return (j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

async function sttSarvam(bytes: Uint8Array, mime: string, model: string) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY missing — add it in project secrets");
  const form = new FormData();
  form.append("file", new Blob([bytes as unknown as BlobPart], { type: mime || "audio/webm" }), `speech.${mimeToExt(mime)}`);
  form.append("model", normalizeSarvamSttModel(model));
  form.append("language_code", "unknown");
  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`Sarvam STT failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = await res.json() as any;
  return (j?.transcript ?? "").trim();
}

async function sttOpenAI(bytes: Uint8Array, mime: string, model: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes as unknown as BlobPart], { type: mime || "audio/webm" }), `speech.${mimeToExt(mime)}`);
  form.append("model", normalizeOpenAISttModel(model));
  const key = getLovableKey();
  const res = await fetch(`${GATEWAY}/audio/transcriptions`, {
    method: "POST",
    headers: { "Lovable-API-Key": key, Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI STT failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = await res.json() as { text?: string };
  return (j.text ?? "").trim();
}

async function transcribeAudio(agent: AgentConfig, audioBase64: string, audioMime?: string) {
  const bytes = base64ToBytes(audioBase64);
  if (bytes.byteLength < 900) return "";
  const mime = audioMime || "audio/webm";
  const provider = agent.stt_provider || "deepgram";
  let text = "";
  if (provider === "deepgram") text = await sttDeepgram(bytes, mime, agent.stt_model || "nova-3");
  else if (provider === "sarvam") text = await sttSarvam(bytes, mime, normalizeSarvamSttModel(agent.stt_model));
  else text = await sttOpenAI(bytes, mime, normalizeOpenAISttModel(agent.stt_model));
  if (!text && provider !== "openai") {
    console.warn(`[stt] ${provider} returned an empty transcript; retrying with fallback STT`);
    text = await sttOpenAI(bytes, mime, "openai/gpt-4o-transcribe");
  }
  if (!text) return "";
  return text;
}

/* ---------------- LLM ---------------- */

async function generateReply(agent: AgentConfig, history: ChatTurn[], userMessage: string) {
  // Default to the fastest flash-lite for lowest first-token latency.
  const model = agent.llm_provider === "lovable" && agent.llm_model
    ? agent.llm_model
    : "google/gemini-3.1-flash-lite";
  const messages = [
    { role: "system", content: systemPrompt(agent) },
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { "Lovable-API-Key": getLovableKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: 60 }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("AI is rate-limited — please retry shortly");
    if (res.status === 402) throw new Error("AI credits exhausted — top up in workspace billing");
    throw new Error(`AI reply failed (${res.status}): ${t.slice(0, 180)}`);
  }
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content?.trim() || "Sure — could you tell me a little more?";
}

/* ---------------- TTS providers ---------------- */

async function ttsDeepgram(text: string, model: string) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model || "aura-2-thalia-en")}&encoding=mp3&bit_rate=48000`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Deepgram TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { audioBase64: bytesToBase64(await res.arrayBuffer()), audioMime: "audio/mpeg" };
}

async function ttsSarvam(text: string, model: string, voice: string) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY missing");
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text.slice(0, 1500)],
      target_language_code: "en-IN",
      speaker: voice || "anushka",
      model: model || "bulbul:v2",
      speech_sample_rate: 22050,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json() as { audios?: string[] };
  const b64 = j.audios?.[0];
  if (!b64) throw new Error("Sarvam TTS returned no audio");
  return { audioBase64: b64, audioMime: "audio/wav" };
}

async function ttsElevenLabs(text: string, model: string, voiceId: string) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId || "EXAVITQu4vr4xnSDxMaL")}?optimize_streaming_latency=3&output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: model || "eleven_turbo_v2_5",
      voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { audioBase64: bytesToBase64(await res.arrayBuffer()), audioMime: "audio/mpeg" };
}

async function ttsOpenAI(text: string, voice: string) {
  const res = await fetch(`${GATEWAY}/audio/speech`, {
    method: "POST",
    headers: { "Lovable-API-Key": getLovableKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      voice: voice || "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { audioBase64: bytesToBase64(await res.arrayBuffer()), audioMime: "audio/mpeg" };
}

async function tryProvider(provider: string, agent: AgentConfig, text: string, useAgentVoice = true) {
  if (provider === "deepgram") {
    return await ttsDeepgram(text, useAgentVoice ? agent.tts_model || "aura-2-thalia-en" : "aura-2-thalia-en");
  }
  if (provider === "sarvam") {
    return await ttsSarvam(
      text,
      useAgentVoice ? agent.tts_model || "bulbul:v2" : "bulbul:v2",
      useAgentVoice ? agent.tts_voice_id || "anushka" : "anushka",
    );
  }
  if (provider === "elevenlabs") {
    return await ttsElevenLabs(
      text,
      useAgentVoice ? agent.tts_model || "eleven_turbo_v2_5" : "eleven_turbo_v2_5",
      useAgentVoice ? agent.tts_voice_id || "EXAVITQu4vr4xnSDxMaL" : "EXAVITQu4vr4xnSDxMaL",
    );
  }
  return await ttsOpenAI(text, useAgentVoice ? agent.tts_voice_id || "alloy" : "alloy");
}

async function synthesizeSpeech(
  agent: AgentConfig,
  text: string,
): Promise<{ audioBase64: string; audioMime: string; ttsError?: string } | null> {
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "").slice(0, 800).trim();
  if (!clean) return null;
  const primary = agent.tts_provider || "deepgram";
  const failures: string[] = [];
  try {
    return await tryProvider(primary, agent, clean);
  } catch (err) {
    const primaryMsg = err instanceof Error ? err.message : String(err);
    failures.push(`${primary}: ${primaryMsg}`);
    console.warn("[tts] primary failed", primaryMsg);
    // Fallback silently so callers still hear audio when the selected provider
    // is misconfigured. Do not try ElevenLabs as a fallback: an invalid key
    // creates noisy alerts and extra latency when another engine is selected.
    const fallbacks = ["deepgram", "openai", "sarvam"].filter((p) => p !== primary);
    for (const fb of fallbacks) {
      try {
        return await tryProvider(fb, agent, clean, false);
      } catch (fbErr) {
        const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
        failures.push(`${fb}: ${fbMsg}`);
        console.warn(`[tts] fallback ${fb} failed`, fbErr);
      }
    }
    const selectedElevenLabs = primary === "elevenlabs";
    const message = selectedElevenLabs
      ? `ElevenLabs TTS failed: ${primaryMsg.slice(0, 200)}`
      : `Voice playback failed for selected engine: ${primaryMsg.slice(0, 200)}`;
    return { audioBase64: "", audioMime: "", ttsError: message };
  }
}

/* ---------------- Server fns ---------------- */

async function assertHasCredits(userId: string) {
  const { getBalanceInr } = await import("./credits.server");
  const { MIN_START_BALANCE_INR } = await import("./pricing");
  const balance = await getBalanceInr(userId);
  if (balance < MIN_START_BALANCE_INR) {
    throw new Error("Out of credits — please recharge to continue testing.");
  }
}

export const agentTextTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as TextInput;
    if (!d || typeof d.agentId !== "string" || typeof d.message !== "string") throw new Error("Invalid input");
    if (!Array.isArray(d.history)) d.history = [];
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertHasCredits(context.userId);
    const agent = await loadAgent(context, data.agentId);
    const reply = await generateReply(agent, data.history, data.message);
    const speech = data.includeAudio !== false ? await synthesizeSpeech(agent, reply) : null;
    return {
      transcript: data.message,
      reply,
      audioBase64: speech?.audioBase64 || null,
      audioMime: speech?.audioMime || null,
      ttsError: speech?.ttsError ?? null,
    };
  });

export const agentVoiceTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as VoiceInput;
    if (!d || typeof d.agentId !== "string" || typeof d.audioBase64 !== "string") throw new Error("Invalid voice input");
    if (!Array.isArray(d.history)) d.history = [];
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertHasCredits(context.userId);
    const agent = await loadAgent(context, data.agentId);
    const transcript = await transcribeAudio(agent, data.audioBase64, data.audioMime);
    if (!transcript) {
      return {
        transcript: "",
        reply: "",
        audioBase64: null,
        audioMime: null,
        ttsError: null,
        noSpeech: true,
        pipeline: {
          stt: agent.stt_provider, llm: agent.llm_provider, tts: agent.tts_provider,
        },
      };
    }
    const reply = await generateReply(agent, data.history, transcript);
    const speech = await synthesizeSpeech(agent, reply);
    return {
      transcript,
      reply,
      audioBase64: speech?.audioBase64 || null,
      audioMime: speech?.audioMime || null,
      ttsError: speech?.ttsError ?? null,
      pipeline: {
        stt: agent.stt_provider, llm: agent.llm_provider, tts: agent.tts_provider,
      },
    };
  });
