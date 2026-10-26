import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createTwilioWebhookToken } from "./twilio-webhook-token";

export type ProviderId = "twilio" | "exotel" | "plivo" | "voxbiz" | "sip_custom";

type ConnectInput = {
  agentId?: string | null;
  provider: ProviderId;
  e164: string;
  label?: string;
  config: Record<string, string>;
};

async function getPublicOrigin() {
  // Twilio must be able to fetch our webhooks over the public internet.
  // Preview/lovableproject.com hosts are not reliably reachable and produce
  // "an application error has occurred" on the call. Always prefer the
  // configured public URL (set via the PUBLIC_APP_URL secret) and only fall
  // back to the request origin when it clearly looks like a production host.
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* ignore */ }
  }
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  // Preview hosts are not publicly reachable — refuse rather than silently
  // hand Twilio a URL that will 404 mid-call.
  if (/lovableproject\.com|localhost|127\.0\.0\.1/i.test(origin)) {
    throw new Error(
      "PUBLIC_APP_URL is not configured. Set it to your published domain (e.g. https://your-app.lovable.app) so Twilio can reach the voice webhooks.",
    );
  }
  return origin;
}


async function buildPublicUrl(path: string, params: Record<string, string>) {
  const url = new URL(path, await getPublicOrigin());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function resolveAnswerUrl(customUrl: string | undefined, fallbackUrl: string) {
  const trimmed = customUrl?.trim();
  if (!trimmed || trimmed.includes("demo.twilio.com")) return fallbackUrl;
  if (trimmed.includes("/api/public/voice/twilio")) return fallbackUrl;
  return trimmed;
}

export const connectPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as ConnectInput;
    if (!d?.provider || !d?.e164) throw new Error("provider and e164 required");
    if (!/^\+?[0-9 ()-]{7,20}$/.test(d.e164)) throw new Error("Invalid phone number");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify agent if provided
    if (data.agentId) {
      const { data: agent, error: agErr } = await supabase
        .from("agents").select("id").eq("id", data.agentId).eq("user_id", userId).maybeSingle();
      if (agErr) throw agErr;
      if (!agent) throw new Error("Agent not found");
    }

    const legacy: Record<string, string | null> = {};
    if (data.provider === "voxbiz") {
      legacy.voxbiz_api_key = data.config.api_key ?? null;
      legacy.voxbiz_api_url = data.config.api_url ?? null;
      legacy.voxbiz_caller_id = data.config.caller_id ?? data.e164;
    }
    if (data.provider === "sip_custom") {
      legacy.sip_username = data.config.sip_username ?? null;
      legacy.sip_password = data.config.sip_password ?? null;
      legacy.sip_host = data.config.sip_host ?? null;
      legacy.sip_status = "configured";
    }

    const e164 = data.e164.trim();
    const payload = {
      user_id: userId,
      agent_id: data.agentId ?? null,
      e164,
      label: data.label ?? null,
      provider: data.provider,
      provider_config: data.config,
      is_verified: false,
      ...legacy,
    };
    // If this user already saved this number, update it in place instead of
    // failing the unique (user_id, e164) constraint.
    const { data: existing } = await supabase
      .from("phone_numbers")
      .select("id")
      .eq("user_id", userId)
      .eq("e164", e164)
      .maybeSingle();
    let row;
    if (existing?.id) {
      const { data: updated, error: updErr } = await supabase
        .from("phone_numbers")
        .update(payload)
        .eq("id", existing.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (updErr) throw updErr;
      row = updated;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("phone_numbers")
        .insert(payload)
        .select()
        .single();
      if (insErr) throw insErr;
      row = inserted;
    }
    return { phoneNumber: row };
  });

export const assignPhoneNumberToAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { phoneNumberId: string; agentId: string | null };
    if (!d?.phoneNumberId) throw new Error("phoneNumberId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.agentId) {
      const { data: agent } = await supabase.from("agents").select("id").eq("id", data.agentId).eq("user_id", userId).maybeSingle();
      if (!agent) throw new Error("Agent not found");
    }
    const { error } = await supabase.from("phone_numbers")
      .update({ agent_id: data.agentId }).eq("id", data.phoneNumberId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const deletePhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { phoneNumberId: string };
    if (!d?.phoneNumberId) throw new Error("phoneNumberId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("phone_numbers").delete()
      .eq("id", data.phoneNumberId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });


type TestInput = { phoneNumberId: string; to: string };
const DEMO_ANSWER_URL = "http://demo.twilio.com/docs/voice.xml";

export const placeTestCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as TestInput;
    if (!d?.phoneNumberId || !d?.to) throw new Error("phoneNumberId and to required");
    if (!/^\+?[0-9 ()-]{7,20}$/.test(d.to)) throw new Error("Invalid phone number");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: num, error } = await supabase
      .from("phone_numbers")
      .select("*")
      .eq("id", data.phoneNumberId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!num) throw new Error("Phone number not found");

    const to = data.to.replace(/[^\d+]/g, "");
    const cfg = (num.provider_config ?? {}) as Record<string, string>;
    const from = (cfg.from || cfg.caller_id || num.e164 || "").replace(/[^\d+]/g, "");

    let providerCallId: string | null = null;
    let providerStatus = "queued";
    let providerError: string | null = null;

    const { data: inserted, error: insErr } = await supabase.from("calls").insert({
      user_id: userId,
      agent_id: num.agent_id,
      phone_number_id: num.id,
      provider: num.provider,
      direction: "test",
      from_number: from,
      to_number: to,
      status: "initiating",
      summary: `Starting test call via ${num.provider}`,
      started_at: new Date().toISOString(),
    }).select().single();
    if (insErr) throw insErr;

    try {
      if (num.provider === "twilio") {
        const sid = cfg.account_sid, token = cfg.auth_token;
        if (!sid || !token || !from) throw new Error("Twilio account_sid, auth_token and from required");
        const webhookToken = await createTwilioWebhookToken(token, num.id, inserted.id);
        const webhookParams: Record<string, string> = { phoneNumberId: String(num.id), callId: String(inserted.id) };
        if (webhookToken) webhookParams.token = webhookToken;
        const answerUrl = resolveAnswerUrl(
          cfg.answer_url,
          await buildPublicUrl("/api/public/voice/twilio", webhookParams),
        );
        const statusUrl = await buildPublicUrl("/api/public/voice/twilio/status", webhookParams);
        const body = new URLSearchParams({
          To: to,
          From: from,
          Url: answerUrl,
          StatusCallback: statusUrl,
          StatusCallbackMethod: "POST",
        });
        body.append("StatusCallbackEvent", "initiated");
        body.append("StatusCallbackEvent", "ringing");
        body.append("StatusCallbackEvent", "answered");
        body.append("StatusCallbackEvent", "completed");
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${sid}:${token}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) providerError = `Twilio ${res.status}: ${JSON.stringify(j).slice(0, 300)}`;
        else { providerCallId = j.sid ?? null; providerStatus = j.status ?? "queued"; }
      } else if (num.provider === "exotel") {
        const sid = cfg.account_sid, key = cfg.api_key, tokenX = cfg.api_token;
        const subdomain = cfg.subdomain || "api.exotel.com";
        if (!sid || !key || !tokenX || !from) throw new Error("Exotel account_sid, api_key, api_token and from required");
        const res = await fetch(`https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${key}:${tokenX}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: from, To: to, CallerId: cfg.caller_id || from }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) providerError = `Exotel ${res.status}: ${JSON.stringify(j).slice(0, 300)}`;
        else { providerCallId = j?.Call?.Sid ?? null; providerStatus = j?.Call?.Status ?? "queued"; }
      } else if (num.provider === "plivo") {
        const authId = cfg.auth_id, tokenP = cfg.auth_token;
        if (!authId || !tokenP || !from) throw new Error("Plivo auth_id, auth_token and from required");
        const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${authId}:${tokenP}`),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to, answer_url: cfg.answer_url || DEMO_ANSWER_URL, answer_method: "GET" }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) providerError = `Plivo ${res.status}: ${JSON.stringify(j).slice(0, 300)}`;
        else { providerCallId = j?.request_uuid ?? null; providerStatus = "queued"; }
      } else if (num.provider === "voxbiz") {
        const apiKey = cfg.api_key || num.voxbiz_api_key;
        const apiUrl = cfg.api_url || num.voxbiz_api_url;
        if (!apiKey || !apiUrl || !from) throw new Error("Voxbiz api_key, api_url and from required");
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ api_key: apiKey, apikey: apiKey, from, to, caller_id: from, callerid: from }),
        });
        const text = await res.text();
        if (!res.ok) providerError = `Voxbiz ${res.status}: ${text.slice(0, 300)}`;
        else {
          try {
            const j = JSON.parse(text) as Record<string, unknown>;
            providerCallId = (j.call_id as string) || (j.uuid as string) || (j.id as string) || null;
            providerStatus = (j.status as string) || "initiated";
          } catch { providerStatus = "initiated"; }
        }
      } else if (num.provider === "sip_custom") {
        providerError = "Custom SIP trunks route through your PBX — real test calls aren't supported from the browser. Use the in-browser voice tester above.";
      } else {
        providerError = `Unknown provider: ${num.provider}`;
      }
    } catch (e) {
      providerError = e instanceof Error ? e.message : String(e);
    }

    const callUpdate = {
      provider_call_id: providerCallId,
      status: providerError ? "failed" : providerStatus,
      summary: providerError ?? `Test call placed via ${num.provider}`,
    };
    const { data: updatedCall, error: updErr } = await supabase
      .from("calls")
      .update(callUpdate)
      .eq("id", inserted.id)
      .select()
      .maybeSingle();
    if (updErr) throw updErr;

    if (providerError) throw new Error(providerError);
    const call = updatedCall ?? { ...inserted, ...callUpdate };
    return { call };
  });
