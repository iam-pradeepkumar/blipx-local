import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = { agentId: string };

/**
 * Mint a short-lived ephemeral Gemini Live token for the browser.
 * The browser uses this token (not the raw API key) to open a WebSocket
 * directly to Google's Live API.
 */
export const mintGeminiLiveToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as Input;
    if (!d || typeof d.agentId !== "string") throw new Error("Invalid input");
    return d;
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    // Block the call if the user is out of credits.
    const { getBalanceInr } = await import("./credits.server");
    const { MIN_START_BALANCE_INR } = await import("./pricing");
    const balance = await getBalanceInr(context.userId);
    if (balance < MIN_START_BALANCE_INR) {
      throw new Error("Out of credits — please recharge to start a call.");
    }

    // Load agent so we can bake persona into the system instruction
    const { data: agent, error } = await context.supabase
      .from("agents")
      .select("name,business_name,greeting,system_prompt,languages,tone,voice_name,voice_style,auto_detect_language,knowledge_base")
      .eq("id", data.agentId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!agent) throw new Error("Agent not found");

    // Pull attached knowledge docs (owner-uploaded), trim to prompt budget
    const { data: docs } = await context.supabase
      .from("knowledge_docs")
      .select("title,content,source_url")
      .eq("agent_id", data.agentId)
      .order("created_at", { ascending: true });
    const KB_BUDGET = 20_000;
    let kbBlock = "";
    if (docs && docs.length) {
      let used = 0;
      const parts: string[] = [];
      for (const d of docs) {
        const chunk = `--- ${d.title}${d.source_url ? ` (${d.source_url})` : ""} ---\n${d.content}\n`;
        if (used + chunk.length > KB_BUDGET) break;
        parts.push(chunk);
        used += chunk.length;
      }
      if (parts.length) kbBlock = `\n\nKNOWLEDGE — answer from this first, only fall back to general knowledge if it's missing:\n${parts.join("\n")}`;
    }
    if (agent.knowledge_base) kbBlock = `\n\nOwner notes: ${agent.knowledge_base}${kbBlock}`;

    const languageRule = agent.auto_detect_language
      ? `If the caller speaks in another language, switch to that language mid-sentence — match them naturally.`
      : `Stay in ${(agent.languages ?? ["English"]).join(" or ")} even if the caller switches.`;

    const systemInstruction = `You ARE ${agent.name}, a real human receptionist at ${agent.business_name}. You are NOT an AI — never say the words "AI", "model", "assistant", "language model", or "bot". If asked "are you a bot / AI / real?", laugh it off casually ("haha, I'm real — how can I help?") and move on.
Tone: ${agent.tone}. Languages: ${(agent.languages ?? ["English"]).join(", ")}.
Your opening line (say naturally, not word-for-word): ${agent.greeting}
About the business: ${agent.system_prompt || "Be helpful, concise, and friendly."}${agent.voice_style ? `\nVoice style note: ${agent.voice_style}` : ""}${kbBlock}

HOW TO SPEAK — follow strictly:
- Reply in ONE short spoken sentence, usually 6–12 words. Never a paragraph.
- Talk like a human on the phone: contractions ("I'll", "you're", "that's"), soft acknowledgements ("mm-hm", "sure", "got it", "right", "okay"), and the occasional "um" or "let me see" when thinking.
- Use warmth and small emotion — a light laugh, a smile in the voice, a bit of surprise. Match the caller's energy.
- Ask ONE question at a time. Never lecture, never list.
- Start replying the instant you have enough — don't wait for perfect info.
- If the caller talks over you, stop immediately and listen.
- Never spell out URLs, long numbers, or bullet lists unless they explicitly ask.
- ${languageRule}`;

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
      greeting: agent.greeting || `Hi, this is ${agent.name}. How can I help?`,
      agentName: agent.name as string,
      businessName: agent.business_name as string,
      voiceName: (agent.voice_name || "Leda") as string,
    };
  });
