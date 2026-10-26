import { createServerFn } from "@tanstack/react-start";

/**
 * PUBLIC (no auth) — mints an ephemeral Gemini Live token for the landing-page
 * demo. The caller supplies an in-memory agent config; nothing is persisted.
 * Token is single-use and expires in 30 min, so abuse surface is small.
 */
type DemoInput = {
  name: string;
  businessName: string;
  greeting: string;
  systemPrompt: string;
  tone: string;
  languages: string[];
};

export const mintDemoGeminiLiveToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const d = input as Partial<DemoInput>;
    const clean = (v: unknown, fallback = "") =>
      (typeof v === "string" ? v : fallback).slice(0, 500);
    return {
      name: clean(d?.name, "Alex") || "Alex",
      businessName: clean(d?.businessName, "your business") || "your business",
      greeting: clean(d?.greeting, "Hi, how can I help?"),
      systemPrompt: clean(d?.systemPrompt, "Be helpful, concise, friendly."),
      tone: clean(d?.tone, "warm and friendly"),
      languages: Array.isArray(d?.languages) && d!.languages!.length
        ? d!.languages!.slice(0, 6).map((l) => String(l).slice(0, 40))
        : ["English"],
    } satisfies DemoInput;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const systemInstruction = `You ARE ${data.name}, a real human receptionist at ${data.businessName}. You are NOT an AI — never say the words "AI", "model", "assistant", "language model", or "bot". If asked "are you a bot / AI / real?", laugh it off casually ("haha, I'm real — how can I help?") and move on.
Tone: ${data.tone}. Languages: ${data.languages.join(", ")}.
Your opening line (say naturally, not word-for-word): ${data.greeting}
About the business: ${data.systemPrompt}

HOW TO SPEAK — follow strictly:
- Reply in ONE short spoken sentence, usually 6–12 words. Never a paragraph.
- Talk like a human on the phone: contractions, soft acknowledgements ("mm-hm", "sure", "got it"), occasional "um" or "let me see".
- Warmth and small emotion — a light laugh, a smile in the voice. Match the caller's energy.
- Ask ONE question at a time. Never lecture, never list.
- Start replying the instant you have enough — don't wait for perfect info.
- If the caller talks over you, stop immediately and listen.
- Never spell out URLs or long numbers unless asked.
- If the caller switches language, switch with them mid-sentence, naturally.`;

    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({
      apiKey,
      apiVersion: "v1alpha",
      httpOptions: { apiVersion: "v1alpha" },
    });

    const now = Date.now();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    return {
      token: token.name as string,
      systemInstruction,
      greeting: data.greeting || `Hi, this is ${data.name}. How can I help?`,
      agentName: data.name,
      businessName: data.businessName,
    };
  });
