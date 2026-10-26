import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { costForSeconds, MIN_START_BALANCE_INR } from "./pricing";
import { createTwilioWebhookToken } from "./twilio-webhook-token";

type Turn = { role: "user" | "assistant"; content: string };
type AudioTurn = Turn & { audioBase64?: string | null; audioMime?: string | null };
type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  business_name: string;
  greeting: string;
  system_prompt: string;
  languages: string[] | null;
  tone: string;
  voice_style: string | null;
  auto_detect_language: boolean;
  knowledge_base: string | null;
  use_realtime?: boolean;
  stt_provider?: string | null;
  stt_model?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_temperature?: number | null;
  tts_provider?: string | null;
  tts_model?: string | null;
  tts_voice_id?: string | null;
};

type PhoneNumberRow = {
  id: string;
  user_id: string;
  agent_id: string | null;
  e164: string;
  provider: string;
  provider_config: Record<string, string> | null;
};

const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

function xml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

// Amazon Polly neural voices — enabled by default on every Twilio account and
// sound close to a real human. Google Neural2 voices require opt-in in the
// Twilio console and otherwise cause an "application error" on the call.
const NEURAL_VOICE: Record<string, string> = {
  "en-IN": "Polly.Kajal-Neural",
  "hi-IN": "Polly.Kajal-Neural",
  "ta-IN": "Polly.Aditi",
  "te-IN": "Polly.Aditi",
  "mr-IN": "Polly.Aditi",
  "bn-IN": "Polly.Aditi",
};

function sayIn(text: string, language = "en-IN") {
  const voice = NEURAL_VOICE[language] ?? "Polly.Kajal-Neural";
  return `<Say language="${xml(language)}" voice="${xml(voice)}">${xml(text)}</Say>`;
}

function say(text: string) {
  return sayIn(text, "en-IN");
}

function gather(actionUrl: string, prompt: string, language = "en-IN", hints?: string, audioUrl?: string | null) {
  const hintsAttr = hints ? ` hints="${xml(hints)}"` : "";
  const promptVerb = audioUrl
    ? `<Play>${xml(audioUrl)}</Play>`
    : sayIn(prompt, language);
  // Keep Gather attributes to the widely-supported defaults so Twilio never
  // fails the request with an application error (no speechModel opt-ins).
  return `<Gather input="speech" action="${xml(actionUrl)}" method="POST" language="${xml(language)}" speechTimeout="2" timeout="8"${hintsAttr}>${promptVerb}</Gather><Redirect method="POST">${xml(actionUrl)}</Redirect>`;
}


function absoluteUrl(request: Request, path: string, params: Record<string, string | undefined>) {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function requestParams(request: Request) {
  if (request.method === "GET") return new URL(request.url).searchParams;
  const text = await request.text();
  return new URLSearchParams(text);
}

function candidateWebhookUrls(request: Request) {
  const current = new URL(request.url);
  const urls = new Set<string>([current.toString()]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? current.protocol.replace(":", "") ?? "https";
  const firstHost = host?.split(",")[0]?.trim();
  const firstProto = proto.split(",")[0]?.trim() || "https";
  if (firstHost) urls.add(`${firstProto}://${firstHost}${current.pathname}${current.search}`);
  urls.add(`https://${current.host}${current.pathname}${current.search}`);
  return [...urls];
}

async function hmacSha1Base64(secret: string, payload: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyTwilioSignature(request: Request, params: URLSearchParams, authToken?: string) {
  if (!authToken) return true;
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;

  const pairs = request.method === "GET" ? [] : Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const suffix = pairs.map(([key, value]) => `${key}${value}`).join("");
  for (const url of candidateWebhookUrls(request)) {
    const expected = await hmacSha1Base64(authToken, url + suffix);
    if (safeEqual(signature, expected)) return true;
  }
  return false;
}

async function verifyCallSid(phoneNumberId: string, callId: string | null, params: URLSearchParams) {
  const providerCallId = params.get("CallSid");
  if (!callId || !providerCallId) return false;
  const { data, error } = await supabaseAdmin
    .from("calls")
    .select("provider_call_id")
    .eq("id", callId)
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) {
    console.warn("[twilio-voice] CallSid verification lookup failed", error);
    return false;
  }
  if (!data) return false;
  const savedCallSid = String(data.provider_call_id ?? "").trim();
  return !savedCallSid || savedCallSid === providerCallId;
}

async function verifyTwilioWebhook(request: Request, params: URLSearchParams, authToken: string | undefined, phoneNumberId: string, callId: string | null) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token && callId) {
    const expected = await createTwilioWebhookToken(authToken, phoneNumberId, callId);
    if (expected && safeEqual(token, expected)) return true;
  }
  if (await verifyCallSid(phoneNumberId, callId, params)) return true;
  const ok = await verifyTwilioSignature(request, params, authToken);
  if (!ok) {
    console.warn("[twilio-voice] rejected unverified webhook", {
      path: url.pathname,
      method: request.method,
      hasTwilioSignature: !!request.headers.get("x-twilio-signature"),
      hasWebhookToken: !!token,
    });
  }
  return ok;
}

async function loadPhoneAndAgent(phoneNumberId: string, callId?: string | null) {
  const { data: phone, error: pErr } = await supabaseAdmin
    .from("phone_numbers")
    .select("id,user_id,agent_id,e164,provider,provider_config")
    .eq("id", phoneNumberId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!phone) throw new Response("Phone number not found", { status: 404 });
  const num = phone as PhoneNumberRow;

  // Prefer the agent recorded on THIS call (set by placeCall for the specific
  // agent being tested). Fall back to the phone number's default agent.
  let agentId: string | null = null;
  if (callId) {
    const { data: callRow } = await supabaseAdmin
      .from("calls").select("agent_id").eq("id", callId).maybeSingle();
    agentId = (callRow?.agent_id as string | null) ?? null;
  }
  if (!agentId) agentId = num.agent_id;
  if (!agentId) return { phone: num, agent: null };

  const { data: agent, error: aErr } = await supabaseAdmin
    .from("agents")
    .select("id,user_id,name,business_name,greeting,system_prompt,languages,tone,voice_style,auto_detect_language,knowledge_base,use_realtime,stt_provider,stt_model,llm_provider,llm_model,llm_temperature,tts_provider,tts_model,tts_voice_id")
    .eq("id", agentId)
    .eq("user_id", num.user_id)
    .maybeSingle();
  if (aErr) throw aErr;
  return { phone: num, agent: (agent as AgentRow | null) ?? null };
}


function twilioLanguage(agent: AgentRow) {
  const langs = (agent.languages ?? []).join(" ").toLowerCase();
  if (langs.includes("hindi")) return "hi-IN";
  if (langs.includes("tamil")) return "ta-IN";
  if (langs.includes("telugu")) return "te-IN";
  if (langs.includes("marathi")) return "mr-IN";
  if (langs.includes("bengali")) return "bn-IN";
  return "en-IN";
}

function cleanReply(reply: string) {
  return reply
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[*#_`~]/g, "")
    .trim()
    .slice(0, 500) || "Sure, could you tell me a little more?";
}

function bytesToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function pcmToWavBase64(pcmBase64: string, sampleRate = 24000) {
  const pcm = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
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
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return bytesToBase64(out.buffer);
}

function normalizeGatewayModel(agent: AgentRow) {
  const provider = (agent.llm_provider || "lovable").toLowerCase();
  const raw = (agent.llm_model || (provider === "openai" ? "gpt-5-mini" : GEMINI_TEXT_MODEL)).trim();
  if (raw.includes("/")) return raw;
  if (provider === "openai") return `openai/${raw}`;
  if (provider === "anthropic") return `anthropic/${raw}`;
  if (provider === "google" || raw.toLowerCase().startsWith("gemini")) return `google/${raw}`;
  return raw;
}

function normalizeSarvamLanguage(agent: AgentRow) {
  const langs = (agent.languages ?? []).join(" ").toLowerCase();
  if (langs.includes("tamil") || langs.includes("tanglish")) return "ta-IN";
  if (langs.includes("telugu")) return "te-IN";
  if (langs.includes("marathi")) return "mr-IN";
  if (langs.includes("bengali")) return "bn-IN";
  if (langs.includes("kannada")) return "kn-IN";
  if (langs.includes("gujarati")) return "gu-IN";
  if (langs.includes("malayalam")) return "ml-IN";
  if (langs.includes("punjabi")) return "pa-IN";
  if (langs.includes("hindi") || langs.includes("hinglish")) return "hi-IN";
  return "en-IN";
}

async function ttsDeepgram(text: string, model?: string | null) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY missing");
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model || "aura-2-thalia-en")}&encoding=mp3&bit_rate=48000`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Deepgram TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { audioBase64: bytesToBase64(await res.arrayBuffer()), audioMime: "audio/mpeg" };
}

async function ttsElevenLabs(text: string, model?: string | null, voiceId?: string | null) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId || "EXAVITQu4vr4xnSDxMaL")}?optimize_streaming_latency=3&output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: model || "eleven_flash_v2_5",
      voice_settings: { stability: 0.42, similarity_boost: 0.88, style: 0.28, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { audioBase64: bytesToBase64(await res.arrayBuffer()), audioMime: "audio/mpeg" };
}

async function ttsSarvam(agent: AgentRow, text: string) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY missing");
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text.slice(0, 900)],
      target_language_code: normalizeSarvamLanguage(agent),
      speaker: agent.tts_voice_id || "anushka",
      model: agent.tts_model || "bulbul:v2",
      speech_sample_rate: 22050,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = await res.json() as { audios?: string[] };
  const audioBase64 = json.audios?.[0];
  if (!audioBase64) throw new Error("Sarvam returned no audio");
  return { audioBase64, audioMime: "audio/wav" };
}

async function ttsOpenAI(text: string, voice?: string | null) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const allowed = /^(alloy|ash|ballad|coral|echo|fable|nova|onyx|sage|shimmer|verse)$/i.test(voice || "");
  const res = await fetch(`${GATEWAY}/audio/speech`, {
    method: "POST",
    headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-4o-mini-tts", voice: allowed ? voice : "alloy", input: text, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { audioBase64: bytesToBase64(await res.arrayBuffer()), audioMime: "audio/mpeg" };
}

async function ttsGemini(text: string, voice?: string | null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey });
  const res = await client.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Leda" } } },
    } as unknown as Record<string, unknown>,
  });
  const parts = (res as unknown as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> })
    .candidates?.[0]?.content?.parts;
  const inline = parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error("Gemini returned no audio");
  return { audioBase64: pcmToWavBase64(inline.data, 24000), audioMime: "audio/wav" };
}

async function synthesizeAgentSpeech(agent: AgentRow, text: string) {
  const clean = cleanReply(text).slice(0, 800);
  const provider = (agent.tts_provider || "deepgram").toLowerCase();
  if (provider === "elevenlabs") return ttsElevenLabs(clean, agent.tts_model, agent.tts_voice_id);
  if (provider === "sarvam") return ttsSarvam(agent, clean);
  if (provider === "openai") return ttsOpenAI(clean, agent.tts_voice_id);
  if (provider === "gemini") return ttsGemini(clean, agent.tts_voice_id);
  return ttsDeepgram(clean, agent.tts_model || agent.tts_voice_id);
}

async function synthesizeAgentSpeechSafe(agent: AgentRow, text: string) {
  try {
    return await synthesizeAgentSpeech(agent, text);
  } catch (error) {
    console.warn("[twilio-voice] selected TTS failed; falling back", error);
    for (const fallback of ["deepgram", "openai", "sarvam"] as const) {
      if (fallback === (agent.tts_provider || "").toLowerCase()) continue;
      try {
        const fallbackAgent = { ...agent, tts_provider: fallback, tts_model: null, tts_voice_id: null };
        return await synthesizeAgentSpeech(fallbackAgent, text);
      } catch (fbError) {
        console.warn(`[twilio-voice] fallback TTS ${fallback} failed`, fbError);
      }
    }
    return null;
  }
}

async function generateReply(agent: AgentRow, history: Turn[]) {
  const languageRule = agent.auto_detect_language
    ? "If the caller changes language, reply in that language naturally."
    : `Stay in ${(agent.languages ?? ["English"]).join(" or ")}.`;
  const systemInstruction = `You ARE ${agent.name}, a real human receptionist at ${agent.business_name}. Never say you are AI, a bot, or a model.
Tone: ${agent.tone}. Languages: ${(agent.languages ?? ["English"]).join(", ")}.
Business context: ${agent.system_prompt || "Be helpful, concise, and friendly."}
Owner notes: ${agent.knowledge_base || "None"}
${agent.voice_style ? `Voice style: ${agent.voice_style}` : ""}

Phone-call rules:
- Reply with one short spoken sentence, 6–14 words.
- Ask only one question at a time.
- Sound human and natural.
- ${languageRule}`;

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Lovable-API-Key": lovableKey, "content-type": "application/json" },
      body: JSON.stringify({
        model: normalizeGatewayModel(agent),
        temperature: Number(agent.llm_temperature ?? 0.65) || 0.65,
        max_tokens: 80,
        messages: [
          { role: "system", content: systemInstruction },
          ...history.slice(-12).map((turn) => ({ role: turn.role, content: turn.content })),
        ],
      }),
    });
    if (!res.ok) throw new Error(`Gateway reply failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 180)}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return cleanReply(json.choices?.[0]?.message?.content ?? "");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No LLM key is configured");
  const contents = history.slice(-12).map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemInstruction }] }, contents, generationConfig: { temperature: 0.65, maxOutputTokens: 80 } }),
  });
  if (!res.ok) throw new Error(`Gemini reply failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 180)}`);
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return cleanReply(json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(" ") ?? "");
}

async function getTranscript(callId?: string | null): Promise<AudioTurn[]> {
  if (!callId) return [];
  const { data } = await supabaseAdmin.from("calls").select("transcript").eq("id", callId).maybeSingle();
  return Array.isArray(data?.transcript) ? (data.transcript as AudioTurn[]) : [];
}

async function updateCall(callId: string | null | undefined, update: Record<string, unknown>) {
  if (!isUuid(callId)) return;
  const id = callId;
  await supabaseAdmin.from("calls").update(update as any).eq("id", id);
}

function audioUrl(request: Request, phoneNumberId: string, callId: string | null, token: string | undefined, index: number) {
  if (!callId) return null;
  return absoluteUrl(request, "/api/public/voice/twilio/audio", {
    phoneNumberId,
    callId,
    token,
    index: String(index),
  });
}

async function ensureInboundCall(phone: PhoneNumberRow, agent: AgentRow, params: URLSearchParams, callId: string | null) {
  if (callId) return callId;
  const providerCallId = params.get("CallSid");
  const { data, error } = await supabaseAdmin.from("calls").insert({
    user_id: phone.user_id,
    agent_id: agent.id,
    phone_number_id: phone.id,
    provider: phone.provider,
    direction: "inbound",
    from_number: params.get("From") ?? null,
    to_number: params.get("To") ?? phone.e164,
    status: "in-progress",
    provider_call_id: providerCallId,
    summary: "Inbound phone call connected to voice agent",
    started_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function handleTwilioAnswer(request: Request) {
  try {
    const params = await requestParams(request);
    const url = new URL(request.url);
    const phoneNumberId = url.searchParams.get("phoneNumberId") ?? "";
    let callId = isUuid(url.searchParams.get("callId")) ? url.searchParams.get("callId") : null;
    if (!isUuid(phoneNumberId)) return twiml(say("This call link is invalid. Please place a new test call."));

    const { phone, agent } = await loadPhoneAndAgent(phoneNumberId, callId);
    const verified = await verifyTwilioWebhook(request, params, phone.provider_config?.auth_token, phoneNumberId, callId);
    if (!verified) return twiml(say("This call could not be verified. Please place a new test call."));
    if (!agent) return twiml(say("No voice agent is connected to this number yet."));
    callId = await ensureInboundCall(phone, agent, params, callId);

    const { getBalanceInr } = await import("./credits.server");
    const balance = await getBalanceInr(phone.user_id);
    if (balance < MIN_START_BALANCE_INR) return twiml(say("Your credits are over. Please recharge to continue using this voice agent."));

    const providerCallId = params.get("CallSid");
    let webhookToken = url.searchParams.get("token") ?? undefined;
    if (!webhookToken) webhookToken = await createTwilioWebhookToken(phone.provider_config?.auth_token, phoneNumberId, callId) ?? undefined;
    const greeting = cleanReply(agent.greeting || `Hi, this is ${agent.name}. How can I help?`);
    const greetingAudio = await synthesizeAgentSpeechSafe(agent, greeting);
    const transcript: AudioTurn[] = [{ role: "assistant", content: greeting, ...(greetingAudio ?? {}) }];
    await updateCall(callId, {
      status: "in-progress",
      provider_call_id: providerCallId,
      from_number: params.get("From") ?? null,
      to_number: params.get("To") ?? phone.e164,
      summary: "Phone test connected to voice agent",
      transcript,
    });


    // Real phone calls must use Twilio's reliable speech <Gather> loop. The
    // bidirectional WebSocket path is intentionally not used here because any
    // STT/TTS socket failure leaves the caller in silence and prevents replies.
    const action = absoluteUrl(request, "/api/public/voice/twilio/turn", { phoneNumberId, callId: callId ?? undefined, token: webhookToken });
    const hints = [agent.name, agent.business_name].filter(Boolean).join(", ");
    return twiml(gather(action, greeting, twilioLanguage(agent), hints, greetingAudio ? audioUrl(request, phoneNumberId, callId, webhookToken, 0) : null));

  } catch (error) {
    console.error("[twilio-voice] answer failed", error);
    return twiml(say("Sorry, this voice agent had a temporary problem. Please try again soon."));
  }
}

export async function handleTwilioTurn(request: Request) {
  try {
    const params = await requestParams(request);
    const url = new URL(request.url);
    const phoneNumberId = url.searchParams.get("phoneNumberId") ?? "";
    const callId = isUuid(url.searchParams.get("callId")) ? url.searchParams.get("callId") : null;
    if (!isUuid(phoneNumberId)) return twiml(say("This call link is invalid. Please place a new test call."));

    const { phone, agent } = await loadPhoneAndAgent(phoneNumberId, callId);
    const verified = await verifyTwilioWebhook(request, params, phone.provider_config?.auth_token, phoneNumberId, callId);
    if (!verified) return twiml(say("This call could not be verified. Please place a new test call."));
    if (!agent) return twiml(say("No voice agent is connected to this number yet."));

    const speech = (params.get("SpeechResult") ?? "").trim();
    const action = absoluteUrl(request, "/api/public/voice/twilio/turn", { phoneNumberId, callId: callId ?? undefined, token: url.searchParams.get("token") ?? undefined });
    const hints = [agent.name, agent.business_name].filter(Boolean).join(", ");
    if (!speech) return twiml(gather(action, "Sorry, I didn't catch that. Could you say it again?", twilioLanguage(agent), hints));

    const history = await getTranscript(callId);
    const withUser = [...history, { role: "user", content: speech } satisfies Turn];
    let reply = "Sure, could you tell me a little more?";
    try {
      reply = await generateReply(agent, withUser);
    } catch (error) {
      console.error("[twilio-voice] Gemini reply failed", error);
      reply = "Sorry, I had trouble hearing that. Could you repeat it?";
    }
    const speechAudio = await synthesizeAgentSpeechSafe(agent, reply);
    const assistantIndex = withUser.length;
    const transcript: AudioTurn[] = [...withUser, { role: "assistant", content: reply, ...(speechAudio ?? {}) }];
    await updateCall(callId, {
      transcript,
      status: "in-progress",
      summary: transcript.slice(-4).map((t) => `${t.role}: ${t.content}`).join("\n"),
    });

    return twiml(gather(action, reply, twilioLanguage(agent), hints, speechAudio ? audioUrl(request, phoneNumberId, callId, url.searchParams.get("token") ?? undefined, assistantIndex) : null));
  } catch (error) {
    console.error("[twilio-voice] turn failed", error);
    return twiml(say("Sorry, this voice agent had a temporary problem. Please try again soon."));
  }
}

export async function handleTwilioAudio(request: Request) {
  try {
    const url = new URL(request.url);
    const phoneNumberId = url.searchParams.get("phoneNumberId") ?? "";
    const callId = isUuid(url.searchParams.get("callId")) ? url.searchParams.get("callId") : null;
    const index = Math.max(0, Number(url.searchParams.get("index") ?? 0) || 0);
    if (!isUuid(phoneNumberId) || !callId) return new Response("not found", { status: 404 });

    const { phone, agent } = await loadPhoneAndAgent(phoneNumberId, callId);
    if (!agent) return new Response("not found", { status: 404 });
    const token = url.searchParams.get("token");
    const expected = await createTwilioWebhookToken(phone.provider_config?.auth_token, phoneNumberId, callId);
    if (expected && (!token || !safeEqual(expected, token))) return new Response("forbidden", { status: 403 });

    const transcript = await getTranscript(callId);
    const turn = transcript[index] ?? [...transcript].reverse().find((t) => t.role === "assistant");
    if (!turn?.content) return new Response("not found", { status: 404 });
    let audioBase64 = turn.audioBase64 ?? "";
    let audioMime = turn.audioMime ?? "";
    if (!audioBase64) {
      const generated = await synthesizeAgentSpeechSafe(agent, turn.content);
      audioBase64 = generated?.audioBase64 ?? "";
      audioMime = generated?.audioMime ?? "";
    }
    if (!audioBase64 || !audioMime) return new Response("audio unavailable", { status: 503 });
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        "content-type": audioMime,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[twilio-voice] audio failed", error);
    return new Response("audio failed", { status: 500 });
  }
}

export async function handleTwilioStatus(request: Request) {
  try {
    const params = await requestParams(request);
    const url = new URL(request.url);
    const phoneNumberId = url.searchParams.get("phoneNumberId") ?? "";
    const callId = isUuid(url.searchParams.get("callId")) ? url.searchParams.get("callId") : null;
    if (!isUuid(phoneNumberId)) return new Response("ignored", { headers: { "content-type": "text/plain" } });

    const { phone } = await loadPhoneAndAgent(phoneNumberId, callId);
    const verified = await verifyTwilioWebhook(request, params, phone.provider_config?.auth_token, phoneNumberId, callId);
    if (!verified) return new Response("ignored", { headers: { "content-type": "text/plain" } });

    const status = params.get("CallStatus") || "unknown";
    const durationSec = Math.max(0, Number(params.get("CallDuration") ?? 0) || 0);
    let previousCost = 0;
    if (callId && (status === "completed" || durationSec > 0)) {
      const { data: existing } = await supabaseAdmin.from("calls").select("cost_inr").eq("id", callId).maybeSingle();
      previousCost = Number(existing?.cost_inr ?? 0);
    }

    const update: Record<string, unknown> = { status };
    if (params.get("CallSid")) update.provider_call_id = params.get("CallSid");
    if (status === "completed" || durationSec > 0) {
      update.ended_at = new Date().toISOString();
      update.duration_sec = durationSec;
      update.cost_inr = costForSeconds(durationSec);
    }
    await updateCall(callId, update);

    if (callId && (status === "completed" || durationSec > 0)) {
      const cost = costForSeconds(durationSec);
      if (previousCost <= 0 && cost > 0) {
        try {
          const { deductInr } = await import("./credits.server");
          await deductInr(phone.user_id, cost, { callId, note: `Phone call · ${durationSec}s` });
        } catch (error) {
          console.warn("[credits] phone call deduct failed", error);
        }
      }
    }

    return new Response("ok", { headers: { "content-type": "text/plain" } });
  } catch (error) {
    console.error("[twilio-voice] status failed", error);
    return new Response("ok", { headers: { "content-type": "text/plain" } });
  }
}