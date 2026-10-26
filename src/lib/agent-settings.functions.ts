import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AgentAutomations = {
  webhook_url?: string;
  webhook_enabled?: boolean;
  email_to?: string;
  email_enabled?: boolean;
};

type Input = {
  agentId: string;
  voice_name?: string;
  voice_style?: string | null;
  auto_detect_language?: boolean;
  languages?: string[];
  tone?: string;
  greeting?: string;
  automations?: AgentAutomations;
  // Realtime pipeline
  use_realtime?: boolean;
  stt_provider?: string;
  stt_model?: string;
  llm_provider?: string;
  llm_model?: string;
  llm_temperature?: number;
  tts_provider?: string;
  tts_voice_id?: string;
  tts_model?: string;
  first_message_mode?: string;
  interruption_threshold_ms?: number;
  silence_timeout_ms?: number;
  max_duration_sec?: number;
  end_call_phrases?: string[];
};

const STT_PROVIDERS = new Set(["deepgram", "openai", "gemini", "sarvam"]);
const LLM_PROVIDERS = new Set(["lovable", "openai", "google", "anthropic"]);
const TTS_PROVIDERS = new Set(["elevenlabs", "openai", "deepgram", "sarvam", "gemini"]);
const FIRST_MSG = new Set(["assistant-speaks-first", "wait-for-user"]);

export const updateAgentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as Input;
    if (!d?.agentId) throw new Error("agentId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.voice_name !== undefined) patch.voice_name = data.voice_name.slice(0, 60);
    if (data.voice_style !== undefined) patch.voice_style = data.voice_style?.slice(0, 200) ?? null;
    if (data.auto_detect_language !== undefined) patch.auto_detect_language = !!data.auto_detect_language;
    if (data.languages !== undefined) patch.languages = data.languages.length ? data.languages : ["English"];
    if (data.tone !== undefined) patch.tone = data.tone.slice(0, 40);
    if (data.greeting !== undefined) patch.greeting = data.greeting.slice(0, 400);
    if (data.automations !== undefined) {
      const a = data.automations || {};
      const rawUrl = a.webhook_url?.slice(0, 500) ?? "";
      let safeUrl: string | null = null;
      if (rawUrl) {
        try {
          const u = new URL(rawUrl);
          if (u.protocol !== "https:") throw new Error("Webhook URL must use https://");
          const host = u.hostname.toLowerCase();
          const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
          const isPrivateIpv4 = !!ipv4 && (() => {
            const [a1, b1] = [Number(ipv4[1]), Number(ipv4[2])];
            return a1 === 10 || a1 === 127 || a1 === 0
              || (a1 === 169 && b1 === 254)
              || (a1 === 172 && b1 >= 16 && b1 <= 31)
              || (a1 === 192 && b1 === 168)
              || (a1 === 100 && b1 >= 64 && b1 <= 127)
              || a1 >= 224;
          })();
          const isInternalHost = host === "localhost"
            || host.endsWith(".localhost")
            || host.endsWith(".internal")
            || host.endsWith(".local")
            || host.endsWith(".lan");
          if (isPrivateIpv4 || isInternalHost) throw new Error("Webhook URL points at a private/internal host");
          safeUrl = u.toString();
        } catch (err) {
          throw new Error(`Invalid webhook URL: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      patch.automations = {
        webhook_url: safeUrl,
        webhook_enabled: !!a.webhook_enabled && !!safeUrl,
        email_to: a.email_to?.slice(0, 200) ?? null,
        email_enabled: !!a.email_enabled,
      };
    }

    if (data.use_realtime !== undefined) patch.use_realtime = !!data.use_realtime;
    if (data.stt_provider && STT_PROVIDERS.has(data.stt_provider)) patch.stt_provider = data.stt_provider;
    if (data.stt_model) patch.stt_model = data.stt_model.slice(0, 60);
    if (data.llm_provider && LLM_PROVIDERS.has(data.llm_provider)) patch.llm_provider = data.llm_provider;
    if (data.llm_model) patch.llm_model = data.llm_model.slice(0, 80);
    if (data.llm_temperature !== undefined) patch.llm_temperature = Math.min(2, Math.max(0, Number(data.llm_temperature) || 0.6));
    if (data.tts_provider && TTS_PROVIDERS.has(data.tts_provider)) patch.tts_provider = data.tts_provider;
    if (data.tts_voice_id) patch.tts_voice_id = data.tts_voice_id.slice(0, 100);
    if (data.tts_model) patch.tts_model = data.tts_model.slice(0, 60);
    if (data.first_message_mode && FIRST_MSG.has(data.first_message_mode)) patch.first_message_mode = data.first_message_mode;
    if (data.interruption_threshold_ms !== undefined) patch.interruption_threshold_ms = Math.min(2000, Math.max(50, Number(data.interruption_threshold_ms) || 150));
    if (data.silence_timeout_ms !== undefined) patch.silence_timeout_ms = Math.min(60000, Math.max(1000, Number(data.silence_timeout_ms) || 8000));
    if (data.max_duration_sec !== undefined) patch.max_duration_sec = Math.min(3600, Math.max(30, Number(data.max_duration_sec) || 600));
    if (data.end_call_phrases !== undefined) patch.end_call_phrases = data.end_call_phrases.slice(0, 20).map((p) => p.slice(0, 60));

    const { data: agent, error } = await context.supabase.from("agents")
      .update(patch as never).eq("id", data.agentId).eq("user_id", context.userId).select().single();
    if (error) throw error;
    return { agent };
  });
