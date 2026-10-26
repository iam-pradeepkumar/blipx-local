import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type GenInput = { description: string };

const SPEC_SYS = `You turn a business owner's plain-English description of a voice agent into a structured JSON spec.

Return ONLY a valid JSON object (no prose, no markdown fences) with this exact shape:
{
  "name": string,                    // short human name for the agent, e.g. "Career Guide Anika"
  "business_name": string,
  "industry": string,                // one of: Retail, Healthcare, Fintech, Education, Real estate, Restaurant, Logistics, Other
  "direction": "inbound"|"outbound"|"both",
  "tone": string,                    // one of: Friendly, Professional, Empathetic, Concise
  "languages": string[],             // from: English, Hindi, Tamil, Telugu, Kannada, Marathi, Bengali, Hinglish, Tanglish. Default ["English"]
  "greeting": string,                // 1 sentence opener the agent will say. Use the business name literally.
  "system_prompt": string,           // multi-paragraph runbook for the AI: purpose, step-by-step flow, rules, calculations, what to recommend.
  "capture_fields": string[],        // every data point to collect during the call. Include AI-derived fields (e.g. "Cutoff (calculated)"), plus standard ones like "Name", "Phone". Always include "AI summary" and "Call recording".
  "knowledge_base": string           // any factual info/formulas/rules the agent needs. Empty string if none.
}

Guidelines:
- Infer sensibly when the owner is vague. Never ask questions back.
- If the description implies calling out to people, direction = "outbound".
- Keep greeting under 25 words and natural for voice.`;

function normalizeSpec(parsed: any, fallbackDescription: string) {
  const allowedDir = ["inbound", "outbound", "both"];
  const direction = allowedDir.includes(parsed.direction) ? parsed.direction : "outbound";
  const languages = Array.isArray(parsed.languages) && parsed.languages.length ? parsed.languages : ["English"];
  const capture: string[] = Array.isArray(parsed.capture_fields) ? parsed.capture_fields.map(String) : [];
  for (const must of ["AI summary", "Call recording"]) {
    if (!capture.some((c) => c.toLowerCase().includes(must.toLowerCase().split(" ")[0]))) capture.push(must);
  }
  return {
    name: String(parsed.name || "My Agent").slice(0, 80),
    business_name: String(parsed.business_name || "My Business").slice(0, 120),
    industry: String(parsed.industry || "Other").slice(0, 60),
    direction,
    tone: String(parsed.tone || "Friendly").slice(0, 40),
    languages,
    greeting: String(parsed.greeting || `Hi, this is ${parsed.name || "your agent"}.`).slice(0, 400),
    system_prompt: String(parsed.system_prompt || fallbackDescription),
    knowledge_base: String(parsed.knowledge_base || ""),
    capture_fields: capture,
    voice_name: "Leda",
    // Default voice pipeline = Ultra-cheap tier (~₹1.1/min).
    tier: "ultra" as "ultra" | "live" | "balanced" | "premium",
    stt_provider: "deepgram", stt_model: "nova-3",
    llm_provider: "lovable",  llm_model: "google/gemini-3-flash-preview",
    tts_provider: "deepgram", tts_model: "aura-2-thalia-en", tts_voice_id: "aura-2-thalia-en",
    use_realtime: true,
  };
}

export const draftAgentFromDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as GenInput;
    if (!d || typeof d.description !== "string" || d.description.trim().length < 20) {
      throw new Error("Please describe your agent in at least a couple of sentences.");
    }
    return { description: d.description.trim().slice(0, 4000) };
  })
  .handler(async ({ data }) => {
    const { chatComplete } = await import("./ai-gateway.server");
    const raw = await chatComplete([
      { role: "system", content: SPEC_SYS },
      { role: "user", content: data.description },
    ]);
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Could not parse AI response. Please try again.");
      parsed = JSON.parse(m[0]);
    }
    return { spec: normalizeSpec(parsed, data.description) };
  });

type CreateInput = {
  name: string;
  business_name: string;
  industry: string;
  direction: "inbound" | "outbound" | "both";
  tone: string;
  languages: string[];
  greeting: string;
  system_prompt: string;
  knowledge_base: string;
  capture_fields: string[];
  voice_name?: string;
  // Voice pipeline (chosen at creation time; must stay <= ₹3/min)
  stt_provider?: string; stt_model?: string;
  llm_provider?: string; llm_model?: string;
  tts_provider?: string; tts_model?: string; tts_voice_id?: string;
  use_realtime?: boolean;
};

export const createAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as CreateInput;
    if (!d?.name?.trim() || !d?.business_name?.trim()) throw new Error("Name and business are required");
    return d;
  })
  .handler(async ({ data, context }) => {
    // Enforce the ₹3/min hard cap on the server too.
    const { estimateInrPerMinute, MAX_INR_PER_MIN } = await import("./voice-providers");
    const stt = data.stt_provider || "deepgram";
    const llm = data.llm_provider || "lovable";
    const tts = data.tts_provider || "deepgram";
    const inr = estimateInrPerMinute(stt, llm, tts);
    if (inr > MAX_INR_PER_MIN) throw new Error(`This voice combination costs ₹${inr}/min — over the ₹${MAX_INR_PER_MIN}/min limit.`);

    const insert = {
      user_id: context.userId,
      name: data.name.trim().slice(0, 80),
      business_name: data.business_name.trim().slice(0, 120),
      industry: (data.industry || "Other").slice(0, 60),
      direction: ["inbound", "outbound", "both"].includes(data.direction) ? data.direction : "outbound",
      tone: (data.tone || "Friendly").slice(0, 40),
      languages: data.languages?.length ? data.languages : ["English"],
      greeting: data.greeting.trim().slice(0, 400),
      system_prompt: data.system_prompt || "",
      knowledge_base: data.knowledge_base || "",
      capture_fields: data.capture_fields || [],
      voice_name: data.voice_name || data.tts_voice_id || "Leda",
      status: "live",
      use_realtime: data.use_realtime ?? true,
      stt_provider: stt, stt_model: data.stt_model || "nova-3",
      llm_provider: llm, llm_model: data.llm_model || "google/gemini-3-flash-preview",
      tts_provider: tts, tts_model: data.tts_model || "aura-2-thalia-en",
      tts_voice_id: data.tts_voice_id || "aura-2-thalia-en",
    };
    const { data: agent, error } = await context.supabase.from("agents").insert(insert as never).select().single();
    if (error) throw error;
    return { agent };
  });

export const deleteAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { agentId: string };
    if (!d?.agentId) throw new Error("agentId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agents")
      .delete()
      .eq("id", data.agentId)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
