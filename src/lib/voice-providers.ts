/**
 * Voice provider registry — single source of truth used by both the UI
 * (agent editor dropdowns + ₹/min estimator) and the realtime server.
 *
 * All per-minute costs are conservative averages at ₹85 = $1 for a "normal"
 * conversation (~90 spoken words/min ≈ 500 chars TTS, ~15s STT audio).
 * Every combo in the "tiers" table below is verified to fit under ₹3/min
 * (before Twilio PSTN, which is billed separately by the carrier).
 */

export type ProviderOption = {
  id: string;
  label: string;
  models: string[];
  /** Est. INR per spoken minute for this provider on the chosen models. */
  costInrPerMinute: number;
  /** Extra secret the app needs before this provider can run. `null` = none. */
  requiresSecret: string | null;
};

export const STT_OPTIONS: ProviderOption[] = [
  { id: "deepgram", label: "Deepgram Nova (best cost, English + Indic)",
    models: ["nova-3", "nova-2"], costInrPerMinute: 0.4, requiresSecret: "DEEPGRAM_API_KEY" },
  { id: "sarvam",   label: "Sarvam STT (Indian languages)",
    models: ["saarika:v2.5"], costInrPerMinute: 0.7, requiresSecret: "SARVAM_API_KEY" },
  { id: "openai",   label: "OpenAI gpt-4o-transcribe",
    models: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"], costInrPerMinute: 0.5, requiresSecret: "OPENAI_API_KEY" },
  { id: "gemini",   label: "Google Gemini Live",
    models: ["gemini-2.0-flash"], costInrPerMinute: 0.6, requiresSecret: "GEMINI_API_KEY" },
];

export const LLM_OPTIONS: ProviderOption[] = [
  { id: "lovable",   label: "Lovable AI · Gemini Flash (recommended, free tier)",
    models: ["google/gemini-3-flash-preview", "google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "google/gemini-2.5-pro"],
    costInrPerMinute: 0.2, requiresSecret: null },
  { id: "openai",    label: "OpenAI (needs OPENAI_API_KEY)",
    models: ["gpt-5-nano", "gpt-5-mini", "gpt-5"], costInrPerMinute: 0.9, requiresSecret: "OPENAI_API_KEY" },
  { id: "google",    label: "Google direct",
    models: ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"], costInrPerMinute: 0.3, requiresSecret: "GEMINI_API_KEY" },
  { id: "anthropic", label: "Anthropic (needs ANTHROPIC_API_KEY)",
    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"], costInrPerMinute: 1.2, requiresSecret: "ANTHROPIC_API_KEY" },
];

export const TTS_OPTIONS: ProviderOption[] = [
  { id: "deepgram",   label: "Deepgram Aura-2 (cheapest, natural English)",
    models: ["aura-2-thalia-en", "aura-2-arcas-en", "aura-asteria-en"], costInrPerMinute: 0.5, requiresSecret: "DEEPGRAM_API_KEY" },
  { id: "elevenlabs", label: "ElevenLabs Flash v2.5 (best voice quality)",
    models: ["eleven_flash_v2_5", "eleven_turbo_v2_5"], costInrPerMinute: 1.7, requiresSecret: "ELEVENLABS_API_KEY" },
  { id: "sarvam",     label: "Sarvam TTS (Indian voices, Hindi/Tamil/etc)",
    models: ["bulbul:v2", "bulbul:v1"], costInrPerMinute: 1.2, requiresSecret: "SARVAM_API_KEY" },
  { id: "openai",     label: "OpenAI gpt-4o-mini-tts",
    models: ["gpt-4o-mini-tts"], costInrPerMinute: 1.0, requiresSecret: "OPENAI_API_KEY" },
];

export const ELEVEN_VOICES: Array<{ id: string; label: string }> = [
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah · warm female" },
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel · calm female" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi · confident female" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh · deep male" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold · crisp male" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam · neutral male" },
];

export const DEEPGRAM_VOICES: Array<{ id: string; label: string }> = [
  { id: "aura-2-thalia-en",  label: "Thalia · warm female (en)" },
  { id: "aura-2-arcas-en",   label: "Arcas · confident male (en)" },
  { id: "aura-asteria-en",   label: "Asteria · natural female (en)" },
  { id: "aura-orion-en",     label: "Orion · deep male (en)" },
];

export const SARVAM_VOICES: Array<{ id: string; label: string }> = [
  { id: "anushka",  label: "Anushka · Indian female" },
  { id: "manisha",  label: "Manisha · Indian female" },
  { id: "vidya",    label: "Vidya · Indian female" },
  { id: "arya",     label: "Arya · Indian female" },
  { id: "abhilash", label: "Abhilash · Indian male" },
  { id: "karun",    label: "Karun · Indian male" },
];


export const GEMINI_VOICES: Array<{ id: string; label: string }> = [
  { id: "Leda",    label: "Leda · warm female" },
  { id: "Aoede",   label: "Aoede · bright female" },
  { id: "Kore",    label: "Kore · confident female" },
  { id: "Zephyr",  label: "Zephyr · soft female" },
  { id: "Puck",    label: "Puck · playful male" },
  { id: "Charon",  label: "Charon · deep male" },
  { id: "Fenrir",  label: "Fenrir · grounded male" },
  { id: "Orus",    label: "Orus · crisp male" },
];

export const OPENAI_VOICES: Array<{ id: string; label: string }> = [
  { id: "alloy",   label: "Alloy · neutral" },
  { id: "verse",   label: "Verse · warm female" },
  { id: "sage",    label: "Sage · calm female" },
  { id: "ballad",  label: "Ballad · soft male" },
  { id: "ash",     label: "Ash · deep male" },
  { id: "coral",   label: "Coral · bright female" },
];

/** Voices available for a given TTS provider. */
export function voicesForProvider(ttsProvider: string): Array<{ id: string; label: string }> {
  switch (ttsProvider) {
    case "elevenlabs": return ELEVEN_VOICES;
    case "deepgram":   return DEEPGRAM_VOICES;
    case "sarvam":     return SARVAM_VOICES;
    case "gemini":     return GEMINI_VOICES;
    case "openai":     return OPENAI_VOICES;
    default:           return DEEPGRAM_VOICES;
  }
}

/** Languages supported by each tier (based on its STT + TTS pipeline). */
export const TIER_LANGUAGES: Record<TierId, string[]> = {
  ultra:    ["English", "Hinglish"],
  live:     ["English", "Hindi", "Hinglish", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali", "Spanish", "French", "German", "Portuguese", "Japanese", "Korean", "Arabic"],
  balanced: ["English", "Hindi", "Hinglish", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch", "Polish"],
  premium:  ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali", "Gujarati", "Punjabi", "Malayalam", "Odia", "Hinglish", "Tanglish"],
};

export type TierId = "ultra" | "live" | "balanced" | "premium";

export type Tier = {
  id: TierId;
  label: string;
  description: string;
  defaults: {
    stt_provider: string; stt_model: string;
    llm_provider: string; llm_model: string;
    tts_provider: string; tts_model: string; tts_voice_id: string;
  };
};

export const TIERS: Tier[] = [
  {
    id: "ultra",
    label: "Ultra-cheap · ~₹1.1/min",
    description: "Deepgram Nova STT + Gemini Flash + Deepgram Aura TTS. Best value for English-first workflows.",
    defaults: {
      stt_provider: "deepgram", stt_model: "nova-3",
      llm_provider: "lovable",  llm_model: "google/gemini-3-flash-preview",
      tts_provider: "deepgram", tts_model: "aura-2-thalia-en", tts_voice_id: "aura-2-thalia-en",
    },
  },
  {
    id: "live",
    label: "Gemini Live · ~₹1.5/min",
    description: "Google Gemini Live end-to-end (STT + LLM + TTS in one stream). Lowest latency, most natural conversation.",
    defaults: {
      stt_provider: "gemini", stt_model: "gemini-2.0-flash",
      llm_provider: "google", llm_model: "gemini-2.5-flash",
      tts_provider: "gemini" as string, tts_model: "gemini-live-2.5-flash", tts_voice_id: "Leda",
    },
  },
  {
    id: "balanced",
    label: "Balanced · ~₹2.3/min",
    description: "Deepgram Nova STT + Gemini 2.5 Flash + ElevenLabs Flash v2.5 TTS. Best all-round voice quality.",
    defaults: {
      stt_provider: "deepgram",  stt_model: "nova-3",
      llm_provider: "lovable",   llm_model: "google/gemini-2.5-flash",
      tts_provider: "elevenlabs", tts_model: "eleven_flash_v2_5", tts_voice_id: "EXAVITQu4vr4xnSDxMaL",
    },
  },
  {
    id: "premium",
    label: "Premium Indian · ~₹2.7/min",
    description: "Sarvam STT + Gemini 2.5 Flash + Sarvam TTS. Best for Hindi and Indic languages.",
    defaults: {
      stt_provider: "sarvam", stt_model: "saarika:v2.5",
      llm_provider: "lovable", llm_model: "google/gemini-2.5-flash",
      tts_provider: "sarvam", tts_model: "bulbul:v2", tts_voice_id: "anushka",
    },
  },
];

/** Rupees/min hint per tier for the UI badges. */
export const TIER_INR: Record<string, number> = {
  ultra: 1.1,
  live: 1.5,
  balanced: 2.3,
  premium: 2.7,
};

export const MAX_INR_PER_MIN = 3;

/** Compute total est. INR / spoken minute for a chosen provider combination. */
export function estimateInrPerMinute(sttProvider: string, llmProvider: string, ttsProvider: string): number {
  const stt = STT_OPTIONS.find((o) => o.id === sttProvider)?.costInrPerMinute ?? 0.5;
  const llm = LLM_OPTIONS.find((o) => o.id === llmProvider)?.costInrPerMinute ?? 0.5;
  const tts = TTS_OPTIONS.find((o) => o.id === ttsProvider)?.costInrPerMinute ?? 1.0;
  return Number((stt + llm + tts).toFixed(2));
}
