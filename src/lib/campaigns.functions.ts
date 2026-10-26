import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreateInput = {
  name: string;
  agentId: string;
  phoneNumberId: string;
  csv: string; // raw CSV text
  max_attempts?: number;
  retry_delay_min?: number;
  active_hours_start?: string;
  active_hours_end?: string;
  timezone?: string;
  notes?: string;
  scheduled_at?: string | null;
};

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const splitLine = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (quoted) {
        if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else {
        if (ch === '"') quoted = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((l) => {
    const cells = splitLine(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj;
  });
  return { headers, rows };
}

function normalizeE164(raw: string): string | null {
  const s = raw.replace(/[^\d+]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) return /^\+\d{7,15}$/.test(s) ? s : null;
  // Assume Indian numbers if 10 digits (owner-friendly)
  if (/^\d{10}$/.test(s)) return "+91" + s;
  if (/^\d{11,15}$/.test(s)) return "+" + s;
  return null;
}

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as CreateInput;
    if (!d?.name?.trim() || !d?.agentId || !d?.phoneNumberId || !d?.csv?.trim()) {
      throw new Error("name, agent, phone number and CSV are required");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify ownership of agent + phone number
    const { data: agent } = await supabase.from("agents").select("id").eq("id", data.agentId).eq("user_id", userId).maybeSingle();
    if (!agent) throw new Error("Agent not found");
    const { data: pn } = await supabase.from("phone_numbers").select("id").eq("id", data.phoneNumberId).eq("user_id", userId).maybeSingle();
    if (!pn) throw new Error("Phone number not found");

    const { headers, rows } = parseCsv(data.csv);
    if (!rows.length) throw new Error("CSV had no rows");
    const phoneKey = headers.find((h) => ["phone", "mobile", "number", "phone_number"].includes(h)) ?? headers[0];
    const nameKey = headers.find((h) => ["name", "full_name", "customer_name"].includes(h));

    const leads = rows
      .map((r) => {
        const e164 = normalizeE164(r[phoneKey] ?? "");
        if (!e164) return null;
        const variables: Record<string, string> = {};
        for (const h of headers) {
          if (h === phoneKey) continue;
          if (r[h]) variables[h] = r[h];
        }
        return {
          name: nameKey ? r[nameKey] || null : null,
          phone: e164,
          variables,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    if (!leads.length) throw new Error("No valid phone numbers found in CSV");

    // Create campaign
    const { data: camp, error: cErr } = await supabase.from("campaigns").insert({
      user_id: userId,
      agent_id: data.agentId,
      phone_number_id: data.phoneNumberId,
      name: data.name.trim().slice(0, 120),
      status: data.scheduled_at ? "scheduled" : "ready",
      total: leads.length,
      max_attempts: Math.max(1, Math.min(5, data.max_attempts ?? 2)),
      retry_delay_min: Math.max(1, Math.min(1440, data.retry_delay_min ?? 30)),
      active_hours_start: data.active_hours_start ?? "09:00",
      active_hours_end: data.active_hours_end ?? "19:00",
      timezone: data.timezone ?? "Asia/Kolkata",
      scheduled_at: data.scheduled_at ?? null,
      notes: data.notes ?? null,
    }).select().single();
    if (cErr) throw cErr;

    // Bulk insert leads
    const leadRows = leads.map((l) => ({
      user_id: userId,
      campaign_id: camp.id,
      name: l.name,
      phone: l.phone,
      variables: l.variables,
    }));
    const { error: lErr } = await supabase.from("campaign_leads").insert(leadRows);
    if (lErr) throw lErr;

    return { campaign: camp, leadCount: leads.length };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { campaignId: string; status: "ready" | "running" | "paused" | "completed" | "cancelled" };
    if (!d?.campaignId) throw new Error("campaignId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("campaigns")
      .update({ status: data.status })
      .eq("id", data.campaignId).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { campaignId: string };
    if (!d?.campaignId) throw new Error("campaignId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("campaigns").delete()
      .eq("id", data.campaignId).eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// Manually dial the next eligible lead. In production this would run on cron —
// for now the campaign dashboard exposes a button so the owner controls pace.
export const dialNextLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { campaignId: string };
    if (!d?.campaignId) throw new Error("campaignId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: camp } = await supabase.from("campaigns").select("*").eq("id", data.campaignId).eq("user_id", userId).maybeSingle();
    if (!camp) throw new Error("Campaign not found");
    if (camp.status === "paused" || camp.status === "cancelled" || camp.status === "completed") {
      throw new Error(`Campaign is ${camp.status}`);
    }

    // Pick an eligible lead: pending, not scheduled for the future, attempts < max
    const nowIso = new Date().toISOString();
    const { data: lead, error: lErr } = await supabase.from("campaign_leads")
      .select("*")
      .eq("campaign_id", camp.id)
      .eq("status", "pending")
      .or(`next_dial_at.is.null,next_dial_at.lte.${nowIso}`)
      .lt("attempts", camp.max_attempts)
      .order("attempts", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!lead) {
      // If everything is done or waiting, mark campaign complete when done
      const { count } = await supabase.from("campaign_leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", camp.id)
        .eq("status", "pending");
      if ((count ?? 0) === 0 && camp.status !== "completed") {
        await supabase.from("campaigns").update({ status: "completed" }).eq("id", camp.id);
      }
      return { dialed: false, reason: "no-eligible-leads" };
    }

    // Mark dialing
    await supabase.from("campaign_leads").update({
      status: "dialing",
      attempts: lead.attempts + 1,
    }).eq("id", lead.id);
    if (camp.status !== "running") {
      await supabase.from("campaigns").update({ status: "running" }).eq("id", camp.id);
    }

    // Place the actual call via the existing telephony surface
    const { placeCall } = await import("./telephony-dial.server");
    let result;
    try {
      result = await placeCall({ supabase, userId, phoneNumberId: camp.phone_number_id!, to: lead.phone, agentId: camp.agent_id, campaignId: camp.id, leadId: lead.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nextRetry = new Date(Date.now() + (camp.retry_delay_min ?? 30) * 60_000).toISOString();
      const shouldRetry = (lead.attempts + 1) < camp.max_attempts;
      await supabase.from("campaign_leads").update({
        status: shouldRetry ? "pending" : "failed",
        last_error: msg.slice(0, 500),
        next_dial_at: shouldRetry ? nextRetry : null,
      }).eq("id", lead.id);
      await supabase.from("campaigns").update({ failed: (camp.failed ?? 0) + (shouldRetry ? 0 : 1) }).eq("id", camp.id);
      return { dialed: false, reason: msg };
    }

    // Mark connected optimistically — real status callback would refine this
    await supabase.from("campaign_leads").update({
      status: "connected",
      last_call_id: result.callId,
    }).eq("id", lead.id);
    await supabase.from("campaigns").update({
      connected: (camp.connected ?? 0) + 1,
      completed: (camp.completed ?? 0) + 1,
    }).eq("id", camp.id);

    return { dialed: true, callId: result.callId, lead: { id: lead.id, phone: lead.phone } };
  });
