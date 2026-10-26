import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Return a short (~3s) audio sample of the requested voice, base64-encoded audio.
 * Routes to the correct TTS engine based on `provider` and caches the WAV/MP3
 * per provider+voice in `voice_samples` so subsequent clicks are instant.
 */
export const getVoiceSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { voiceName: string; provider?: string; model?: string };
    if (!d?.voiceName || typeof d.voiceName !== "string") throw new Error("Invalid input");
    if (!d.provider) d.provider = "gemini";
    return d as { voiceName: string; provider: string; model?: string };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cacheKey = `${data.provider}:${data.voiceName}`;
    const sampleText = "Hi there! This is how I sound. I can't wait to help your callers.";

    // Cache lookup
    const { data: cached } = await supabaseAdmin
      .from("voice_samples")
      .select("audio_base64,mime_type")
      .eq("voice_name", cacheKey)
      .maybeSingle();
    if (cached?.audio_base64) {
      return { audioBase64: cached.audio_base64, mimeType: cached.mime_type };
    }

    let audio_base64 = "";
    let mime = "audio/wav";

    if (data.provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey });
      const res = await client.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ role: "user", parts: [{ text: sampleText }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: data.voiceName } } },
        } as unknown as Record<string, unknown>,
      });
      const parts = (res as unknown as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> })
        .candidates?.[0]?.content?.parts;
      const inline = parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error("No audio returned");
      const pcm = Buffer.from(inline.data, "base64");
      audio_base64 = pcmToWav(pcm, 24000, 1, 16).toString("base64");
    } else if (data.provider === "deepgram") {
      const key = process.env.DEEPGRAM_API_KEY;
      if (!key) throw new Error("DEEPGRAM_API_KEY not configured");
      const model = data.model || data.voiceName;
      const res = await fetch(
        `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=linear16&sample_rate=24000&container=wav`,
        {
          method: "POST",
          headers: { authorization: `Token ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ text: sampleText }),
        },
      );
      if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 160)}`);
      audio_base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    } else if (data.provider === "elevenlabs") {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key) throw new Error("ELEVENLABS_API_KEY not configured");
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${data.voiceName}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            text: sampleText,
            model_id: data.model || "eleven_flash_v2_5",
            voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true },
          }),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`);
      audio_base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      mime = "audio/mpeg";
    } else if (data.provider === "sarvam") {
      const key = process.env.SARVAM_API_KEY;
      if (!key) throw new Error("SARVAM_API_KEY not configured");
      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: { "api-subscription-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          inputs: [sampleText],
          target_language_code: "en-IN",
          speaker: data.voiceName,
          model: data.model || "bulbul:v2",
          speech_sample_rate: 22050,
        }),
      });
      if (!res.ok) throw new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const j = await res.json() as { audios?: string[] };
      const b64 = j.audios?.[0];
      if (!b64) throw new Error("Sarvam returned no audio");
      audio_base64 = b64;
      mime = "audio/wav";
    } else if (data.provider === "openai") {
      const key = process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY;
      if (!key) throw new Error("No key for OpenAI TTS");
      const endpoint = process.env.OPENAI_API_KEY
        ? "https://api.openai.com/v1/audio/speech"
        : "https://ai.gateway.lovable.dev/v1/audio/speech";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (process.env.OPENAI_API_KEY) headers.authorization = `Bearer ${key}`;
      else headers["Lovable-API-Key"] = key;
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: data.model || "gpt-4o-mini-tts",
          voice: data.voiceName,
          input: sampleText,
          response_format: "mp3",
        }),
      });
      if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
      audio_base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      mime = "audio/mpeg";
    } else {
      throw new Error(`Unsupported provider: ${data.provider}`);
    }

    await supabaseAdmin.from("voice_samples").upsert({
      voice_name: cacheKey,
      audio_base64,
      mime_type: mime,
    });

    return { audioBase64: audio_base64, mimeType: mime };
  });

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}
