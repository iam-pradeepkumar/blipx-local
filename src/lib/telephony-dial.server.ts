// Server-only helper: place an outbound call via the connected provider and record it in `calls`.
// Extracted so campaigns can reuse the same dial logic without going through placeTestCall.

import { getRequest } from "@tanstack/react-start/server";
import { createTwilioWebhookToken } from "./twilio-webhook-token";

const DEMO_ANSWER_URL = "http://demo.twilio.com/docs/voice.xml";

function getPublicOrigin() {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* ignore */ }
  }
  const request = getRequest();
  const origin = request.headers.get("origin");
  if (origin) return origin;
  return new URL(request.url).origin;
}

function buildPublicUrl(path: string, params: Record<string, string>) {
  const url = new URL(path, getPublicOrigin());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function resolveAnswerUrl(customUrl: string | undefined, fallbackUrl: string) {
  const trimmed = customUrl?.trim();
  if (!trimmed || trimmed.includes("demo.twilio.com")) return fallbackUrl;
  if (trimmed.includes("/api/public/voice/twilio")) return fallbackUrl;
  return trimmed;
}

type Args = {
  supabase: any;
  userId: string;
  phoneNumberId: string;
  to: string;
  agentId?: string | null;
  campaignId?: string | null;
  leadId?: string | null;
};

export async function placeCall(args: Args) {
  const { supabase, userId, phoneNumberId, to } = args;
  const { data: num, error } = await supabase
    .from("phone_numbers").select("*")
    .eq("id", phoneNumberId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!num) throw new Error("Phone number not found");

  const cleanTo = to.replace(/[^\d+]/g, "");
  const cfg = (num.provider_config ?? {}) as Record<string, string>;
  const from = (cfg.from || cfg.caller_id || num.e164 || "").replace(/[^\d+]/g, "");

  let providerCallId: string | null = null;
  let providerStatus = "queued";

  const { data: inserted, error: insErr } = await supabase.from("calls").insert({
    user_id: userId,
    agent_id: args.agentId ?? num.agent_id ?? null,
    phone_number_id: num.id,
    provider: num.provider,
    direction: "outbound",
    from_number: from,
    to_number: cleanTo,
    status: "initiating",
    summary: `Starting outbound call via ${num.provider}`,
    started_at: new Date().toISOString(),
    campaign_id: args.campaignId ?? null,
    lead_id: args.leadId ?? null,
  }).select("id").single();
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
        buildPublicUrl("/api/public/voice/twilio", webhookParams),
      );
      const statusUrl = buildPublicUrl("/api/public/voice/twilio/status", webhookParams);
      const body = new URLSearchParams({
        To: cleanTo,
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
        headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      providerCallId = j.sid ?? null;
      providerStatus = j.status ?? "queued";
    } else if (num.provider === "plivo") {
      const authId = cfg.auth_id, tokenP = cfg.auth_token;
      if (!authId || !tokenP || !from) throw new Error("Plivo auth_id, auth_token and from required");
      const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Call/`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${authId}:${tokenP}`), "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: cleanTo, answer_url: resolveAnswerUrl(cfg.answer_url, DEMO_ANSWER_URL), answer_method: "GET" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Plivo ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      providerCallId = j?.request_uuid ?? null;
    } else if (num.provider === "exotel") {
      const sid = cfg.account_sid, key = cfg.api_key, tokenX = cfg.api_token;
      const subdomain = cfg.subdomain || "api.exotel.com";
      if (!sid || !key || !tokenX || !from) throw new Error("Exotel account_sid, api_key, api_token and from required");
      const res = await fetch(`https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${key}:${tokenX}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: from, To: cleanTo, CallerId: cfg.caller_id || from }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Exotel ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      providerCallId = j?.Call?.Sid ?? null;
      providerStatus = j?.Call?.Status ?? "queued";
    } else if (num.provider === "voxbiz") {
      const apiKey = cfg.api_key || num.voxbiz_api_key;
      const apiUrl = cfg.api_url || num.voxbiz_api_url;
      if (!apiKey || !apiUrl || !from) throw new Error("Voxbiz api_key, api_url and from required");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ api_key: apiKey, apikey: apiKey, from, to: cleanTo, caller_id: from, callerid: from }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Voxbiz ${res.status}: ${text.slice(0, 300)}`);
      try { const j = JSON.parse(text); providerCallId = j.call_id || j.uuid || j.id || null; } catch { /* ignore */ }
    } else if (num.provider === "sip_custom") {
      throw new Error("Custom SIP trunks can't be dialed from the browser — route via your PBX.");
    } else {
      throw new Error(`Unknown provider: ${num.provider}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("calls").update({ status: "failed", summary: message }).eq("id", inserted.id);
    throw error;
  }

  await supabase.from("calls").update({
    provider_call_id: providerCallId,
    status: providerStatus,
    summary: `Outbound call placed via ${num.provider}`,
  }).eq("id", inserted.id);

  return { callId: inserted.id as string, providerCallId, providerStatus };
}
