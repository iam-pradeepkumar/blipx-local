// Server-only handler for Twilio Media Stream WebSocket upgrades.
// Twilio can omit query strings on <Stream>, so the realtime endpoint accepts
// signed call identifiers in URL path segments as well as legacy query params.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function extractTwilioStreamAuth(request: Request) {
  const url = new URL(request.url);
  let callId = url.searchParams.get("callId") ?? "";
  let phoneNumberId = url.searchParams.get("phoneNumberId") ?? "";
  let token = url.searchParams.get("token") ?? "";

  if (!callId || !phoneNumberId || !token) {
    const marker = "/api/public/voice/twilio/stream/";
    const [, rawTail = ""] = url.pathname.split(marker);
    const [rawPhoneNumberId = "", rawCallId = "", rawToken = ""] = rawTail.split("/");
    phoneNumberId ||= decodeURIComponent(rawPhoneNumberId);
    callId ||= decodeURIComponent(rawCallId);
    token ||= decodeURIComponent(rawToken);
  }

  return { callId, phoneNumberId, token };
}

export async function handleTwilioStreamRoute(request: Request) {
  const upgrade = request.headers.get("upgrade")?.toLowerCase();
  if (upgrade !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const WSPair = (globalThis as unknown as { WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket } }).WebSocketPair;
  if (!WSPair) return new Response("WebSocket runtime not available", { status: 500 });
  const pair = new WSPair();
  const client = pair[0];
  const server = pair[1] as WebSocket & { accept?: () => void };
  server.accept?.();

  const { callId, phoneNumberId, token } = extractTwilioStreamAuth(request);
  if (callId || phoneNumberId || token) {
    if (!UUID_RE.test(callId) || !UUID_RE.test(phoneNumberId) || !token) {
      server.close(1008, "invalid-stream-auth");
      return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
    }
    const verified = await verifyTwilioStreamToken(phoneNumberId, callId, token);
    if (!verified) {
      server.close(1008, "unauthorized-stream");
      return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
    }
    const { handleTwilioMediaStream } = await import("@/lib/realtime-voice.server");
    void handleTwilioMediaStream(server, callId);
  } else {
    const { handleTwilioMediaStreamWithStartAuth } = await import("@/lib/realtime-voice.server");
    void handleTwilioMediaStreamWithStartAuth(server);
  }

  return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
}

export async function verifyTwilioStreamToken(phoneNumberId: string, callId: string, token: string) {
  if (!UUID_RE.test(callId) || !UUID_RE.test(phoneNumberId) || !token) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: phone } = await supabaseAdmin
    .from("phone_numbers")
    .select("provider_config")
    .eq("id", phoneNumberId)
    .maybeSingle();
  const authToken = (phone?.provider_config as { auth_token?: string } | null)?.auth_token;
  if (!authToken) return false;

  const { createTwilioWebhookToken } = await import("@/lib/twilio-webhook-token");
  const expected = await createTwilioWebhookToken(authToken, phoneNumberId, callId);
  return !!expected && safeEqual(expected, token);
}