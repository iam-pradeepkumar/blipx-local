import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Turn = { role: "user" | "assistant"; content: string };
type Input = { agentId: string; transcript: Turn[]; durationSec?: number };

export const saveBrowserTestCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as Input;
    if (!d?.agentId || !Array.isArray(d.transcript)) throw new Error("Invalid input");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: agent, error: aErr } = await supabase
      .from("agents")
      .select("id,name,business_name,capture_fields,system_prompt,automations")
      .eq("id", data.agentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!agent) throw new Error("Agent not found");

    const userTurns = data.transcript.filter((t) => t.role === "user" && t.content.trim());
    if (userTurns.length === 0) {
      // nothing was said — skip recording
      return { skipped: true };
    }

    const captureList: string[] = Array.isArray(agent.capture_fields) ? (agent.capture_fields as string[]) : [];
    // Fields we ask the AI to extract from the transcript (exclude meta ones)
    const extractable = captureList.filter(
      (f) => !/summary|recording/i.test(f),
    );

    const transcriptText = data.transcript
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");

    const sys = `You analyze a voice call transcript and extract structured data.
Return ONLY valid JSON (no prose, no fences) matching:
{
  "summary": string,                    // 2-3 sentence neutral summary of the call
  "sentiment": "positive"|"neutral"|"negative",
  "outcome": string,                    // short label e.g. "info_collected", "not_interested", "callback_requested"
  "fields": { [fieldName: string]: string | null }  // one key per requested field, null if not mentioned
}
Requested fields to extract: ${JSON.stringify(extractable)}`;

    let summary = "";
    let sentiment: string | null = null;
    let outcome: string | null = null;
    let fields: Record<string, string | null> = {};
    try {
      const { chatComplete } = await import("./ai-gateway.server");
      const raw = await chatComplete([
        { role: "system", content: sys },
        { role: "user", content: transcriptText },
      ]);
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
      summary = String(parsed.summary || "");
      sentiment = parsed.sentiment ?? null;
      outcome = parsed.outcome ?? null;
      fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
    } catch (err) {
      summary = "Browser test call (auto-summary failed).";
    }

    // Real Gemini Live cost estimate (INR) — see src/lib/pricing.ts.
    // Do NOT trust the client-supplied durationSec: a browser can under-report
    // or omit it to dodge credit deduction. Compute a server-side floor from
    // the transcript (words × ~2.5 wps average speaking rate + 1s per turn of
    // reaction time) and bill the max of the two.
    const { costForSeconds } = await import("./pricing");
    const clientDur = Math.max(0, Math.round(data.durationSec ?? 0));
    const words = data.transcript.reduce((n, t) => n + (t.content?.trim().split(/\s+/).filter(Boolean).length ?? 0), 0);
    const turns = data.transcript.length;
    const serverFloorSec = Math.ceil(words / 2.5) + turns; // ~150 wpm + 1s/turn overhead
    const durSec = Math.max(clientDur, serverFloorSec);
    const estCost = costForSeconds(durSec);

    const insert = {
      user_id: userId,
      agent_id: agent.id,
      provider: "browser",
      direction: "test" as const,
      to_number: "browser-test",
      status: "completed",
      duration_sec: durSec,
      cost_inr: estCost,
      outcome,
      sentiment,
      summary,
      transcript: data.transcript,
      captured_fields: fields,
      started_at: new Date(Date.now() - durSec * 1000).toISOString(),
      ended_at: new Date().toISOString(),
    };


    const { data: call, error } = await supabase.from("calls").insert(insert).select().single();
    if (error) throw error;

    // Deduct from user credits (server-side, atomic)
    if (estCost > 0) {
      try {
        const { deductInr } = await import("./credits.server");
        await deductInr(userId, estCost, { callId: call.id, note: `Browser test · ${durSec}s` });
      } catch (err) {
        console.warn("[credits] deduct failed", err);
      }
    }

    // Fire post-call automations (webhook/email preview). Don't fail the save if they error.
    try {
      const { runPostCallAutomations } = await import("./automations.server");
      await runPostCallAutomations(agent.automations, {
        event: "call.completed",
        agent: { id: agent.id, name: agent.name, business_name: (agent as any).business_name ?? "" },
        call: {
          id: call.id, direction: "test", provider: "browser",
          to_number: "browser-test", duration_sec: durSec, cost_inr: estCost,
          summary, sentiment, outcome, captured_fields: fields, transcript: data.transcript,
          started_at: insert.started_at, ended_at: insert.ended_at,
        },
      });
    } catch (err) {
      console.warn("[automations] post-call failed", err);
    }
    return { call };
  });
