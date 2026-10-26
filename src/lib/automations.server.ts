// Server-only. Fire post-call automations (webhooks, email preview). Never import from route/component modules directly.

export type AutomationPayload = {
  event: "call.completed";
  agent: { id: string; name: string; business_name: string };
  call: {
    id: string;
    direction: string;
    provider: string;
    from_number?: string | null;
    to_number: string;
    duration_sec: number;
    started_at?: string | null;
    ended_at?: string | null;
    cost_inr?: number;
    summary?: string | null;
    sentiment?: string | null;
    outcome?: string | null;
    captured_fields?: Record<string, unknown>;
    transcript?: Array<{ role: string; content: string }>;
  };
  campaign_id?: string | null;
  lead_id?: string | null;
};

// Cap on how many bytes we'll read back from a user-configured webhook. The
// automation ignores the response body — we only need enough to log a hint.
const MAX_WEBHOOK_RESPONSE_BYTES = 8 * 1024;

/**
 * SSRF guard for user-provided webhook URLs. We can't reliably DNS-resolve on
 * Cloudflare Workers, so we reject URLs that already point at private/
 * loopback/link-local hosts by their literal value, require https, and reject
 * suspicious hostnames (localhost, .internal, .local, bare IPs in private
 * ranges). Combined with a short timeout + response-size cap, this prevents
 * the server from being used as a proxy to internal infrastructure.
 */
function assertSafeWebhookUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Webhook URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use https://");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) throw new Error("Webhook URL has no host");

  // Reject well-known internal hostnames.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".cluster.local")
  ) {
    throw new Error("Webhook URL points at an internal host");
  }

  // IPv6 literal in brackets → reject loopback/link-local/unique-local.
  if (host.startsWith("[") && host.endsWith("]")) {
    const ip6 = host.slice(1, -1).toLowerCase();
    if (
      ip6 === "::" ||
      ip6 === "::1" ||
      ip6.startsWith("fe80:") ||
      ip6.startsWith("fc") ||
      ip6.startsWith("fd")
    ) {
      throw new Error("Webhook URL points at a private IPv6 address");
    }
  }

  // IPv4 literal → reject private/loopback/link-local/metadata ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) || // link-local + AWS/GCP metadata (169.254.169.254)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast + reserved
    ) {
      throw new Error("Webhook URL points at a private IPv4 address");
    }
  }

  return parsed;
}

export async function runPostCallAutomations(automations: any, payload: AutomationPayload) {
  const results: Array<{ kind: string; ok: boolean; detail?: string }> = [];
  if (!automations || typeof automations !== "object") return results;

  if (automations.webhook_enabled && typeof automations.webhook_url === "string" && automations.webhook_url) {
    try {
      const safeUrl = assertSafeWebhookUrl(automations.webhook_url);
      const res = await fetch(safeUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BlipX-Event": "call.completed" },
        body: JSON.stringify(payload),
        redirect: "error", // don't follow a 302 into an internal host
        signal: AbortSignal.timeout(6000),
      });
      // Drain (bounded) so the connection can be reused and we don't hold memory.
      try {
        const reader = res.body?.getReader();
        if (reader) {
          let read = 0;
          while (read < MAX_WEBHOOK_RESPONSE_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            read += value?.byteLength ?? 0;
          }
          await reader.cancel().catch(() => {});
        }
      } catch {
        // ignore
      }
      results.push({ kind: "webhook", ok: res.ok, detail: `${res.status}` });
    } catch (err) {
      results.push({ kind: "webhook", ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  // Email is prepared but not sent — no SMTP wired yet. Owner sees the preview in the UI.
  if (automations.email_enabled && automations.email_to) {
    results.push({ kind: "email", ok: true, detail: "queued (preview only)" });
  }

  return results;
}
