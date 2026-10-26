import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ChatTurn = { role: "user" | "assistant"; content: string };
type Input = { agentId: string; history: ChatTurn[]; message: string };

export const agentChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as Input;
    if (!d || typeof d.agentId !== "string" || typeof d.message !== "string") {
      throw new Error("Invalid input");
    }
    if (!Array.isArray(d.history)) d.history = [];
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: agent, error } = await supabase
      .from("agents")
      .select("name,business_name,greeting,system_prompt,languages,tone")
      .eq("id", data.agentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!agent) throw new Error("Agent not found");

    const { chatComplete } = await import("./ai-gateway.server");
    const sys = `You are ${agent.name}, a voice agent for ${agent.business_name}.
Tone: ${agent.tone}. Languages you can speak: ${(agent.languages ?? []).join(", ")}.
Greeting style: "${agent.greeting}"
Instructions from the business owner:
${agent.system_prompt || "Be helpful, concise, and friendly. Keep replies under 2 sentences for voice."}

Keep every reply short (1-2 sentences) — this is a phone conversation. Never mention you are an AI unless asked directly.`;

    const messages = [
      { role: "system" as const, content: sys },
      ...data.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: data.message },
    ];

    const reply = await chatComplete(messages);
    return { reply };
  });
