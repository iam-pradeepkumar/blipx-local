import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Naïve HTML → text: strip scripts/styles/tags. Good enough for FAQs/marketing pages.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_CHARS = 40_000; // per doc — enough for a big FAQ, small enough for prompt budget

async function ensureAgent(supabase: any, userId: string, agentId: string) {
  const { data, error } = await supabase.from("agents").select("id").eq("id", agentId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Agent not found");
}

export const addKnowledgeText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { agentId: string; title: string; content: string };
    if (!d?.agentId || !d?.title?.trim() || !d?.content?.trim()) throw new Error("agentId, title, content required");
    return d;
  })
  .handler(async ({ data, context }) => {
    await ensureAgent(context.supabase, context.userId, data.agentId);
    const content = data.content.slice(0, MAX_CHARS);
    const { data: row, error } = await context.supabase.from("knowledge_docs").insert({
      user_id: context.userId,
      agent_id: data.agentId,
      kind: "text",
      title: data.title.slice(0, 200),
      content,
      size_chars: content.length,
    }).select().single();
    if (error) throw error;
    return { doc: row };
  });

export const addKnowledgeUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { agentId: string; url: string; title?: string };
    if (!d?.agentId || !d?.url) throw new Error("agentId, url required");
    try { new URL(d.url); } catch { throw new Error("Invalid URL"); }
    return d;
  })
  .handler(async ({ data, context }) => {
    await ensureAgent(context.supabase, context.userId, data.agentId);
    const res = await fetch(data.url, {
      headers: { "User-Agent": "BlipXBot/1.0 (+https://blipx.ai)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Could not fetch page (${res.status})`);
    const html = await res.text();
    const text = htmlToText(html).slice(0, MAX_CHARS);
    if (!text) throw new Error("The page had no readable text.");
    const title = (data.title?.trim() || new URL(data.url).hostname).slice(0, 200);
    const { data: row, error } = await context.supabase.from("knowledge_docs").insert({
      user_id: context.userId,
      agent_id: data.agentId,
      kind: "url",
      title,
      source_url: data.url,
      content: text,
      size_chars: text.length,
    }).select().single();
    if (error) throw error;
    return { doc: row };
  });

export const deleteKnowledgeDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { docId: string };
    if (!d?.docId) throw new Error("docId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("knowledge_docs").delete()
      .eq("id", data.docId).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
