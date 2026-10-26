import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatComplete } from "@/lib/ai-gateway.server";

/**
 * Accepts a base64-encoded audio recording (any language) captured in the
 * browser, transcribes it via Lovable AI STT, then normalises the transcript
 * to English so the downstream agent-drafting flow can use it.
 */
type Input = {
  audioBase64: string; // raw base64, no data: prefix
  mimeType: string;    // e.g. "audio/webm", "audio/mp4", "audio/wav"
};

const STT_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const STT_MODEL = "openai/gpt-4o-mini-transcribe";

const extFromMime = (m: string): string => {
  const base = m.split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/aac") return "m4a";
  if (base === "audio/mpeg" || base === "audio/mp3") return "mp3";
  if (base === "audio/wav" || base === "audio/x-wav" || base === "audio/wave") return "wav";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/flac") return "flac";
  return "webm";
};

export const transcribeAgentDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as Partial<Input>;
    if (!d?.audioBase64 || typeof d.audioBase64 !== "string") {
      throw new Error("Missing audio");
    }
    return {
      audioBase64: d.audioBase64,
      mimeType: (d.mimeType && typeof d.mimeType === "string") ? d.mimeType : "audio/webm",
    } as Input;
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Decode base64 → Uint8Array → Blob for FormData upload
    const bin = atob(data.audioBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 1024) throw new Error("Recording was too short. Please try again.");

    const ext = extFromMime(data.mimeType);
    const blob = new Blob([bytes], { type: data.mimeType });

    const form = new FormData();
    form.append("model", STT_MODEL);
    form.append("file", blob, `recording.${ext}`);

    const sttRes = await fetch(STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!sttRes.ok) {
      const text = await sttRes.text().catch(() => "");
      if (sttRes.status === 429) throw new Error("Rate limited — please try again in a moment.");
      if (sttRes.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
      throw new Error(`Transcription failed (${sttRes.status}): ${text.slice(0, 200)}`);
    }
    const sttJson = (await sttRes.json()) as { text?: string };
    const original = (sttJson.text ?? "").trim();
    if (!original) throw new Error("Couldn't hear anything. Please record again.");

    // Translate to English (idempotent if already English).
    const english = await chatComplete([
      {
        role: "system",
        content:
          "You translate voice-agent design briefs into clean, natural English. If the input is already English, return it unchanged but cleaned up (fix disfluencies, punctuation, capitalisation). Never add commentary, quotes, or preface. Output only the translated brief.",
      },
      { role: "user", content: original },
    ]);

    return {
      original,
      english: (english || original).trim(),
    };
  });
