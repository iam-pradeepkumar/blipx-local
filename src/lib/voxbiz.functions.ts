import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type TestCallInput = { phoneNumberId: string; to: string };

// Places a real Voxbiz Click2Call. Voxbiz dials the owner's caller-id leg
// and bridges to the customer's `to` number. Each owner brings their own
// Voxbiz API key + endpoint URL, stored on the phone_numbers row.
export const placeVoxbizTestCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as TestCallInput;
    if (!d?.phoneNumberId || !d?.to) throw new Error("phoneNumberId and to required");
    if (!/^\+?[0-9 ()-]{7,20}$/.test(d.to)) throw new Error("Invalid phone number");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: num, error } = await supabase
      .from("phone_numbers")
      .select("id,agent_id,e164,voxbiz_api_key,voxbiz_api_url,voxbiz_caller_id")
      .eq("id", data.phoneNumberId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!num) throw new Error("Phone number not found");
    if (!num.voxbiz_api_key || !num.voxbiz_api_url) {
      throw new Error("Voxbiz credentials are not configured for this number");
    }

    const to = data.to.replace(/[^\d+]/g, "");
    const from = (num.voxbiz_caller_id ?? num.e164).replace(/[^\d+]/g, "");

    // Voxbiz Click2Call: POST x-www-form-urlencoded.
    // Field names follow Voxbiz docs; supports api_key/api_url variations.
    const body = new URLSearchParams({
      api_key: num.voxbiz_api_key,
      apikey: num.voxbiz_api_key,
      from,
      to,
      caller_id: from,
      callerid: from,
      answer_url: "",
    });

    let providerCallId: string | null = null;
    let providerStatus = "queued";
    let providerError: string | null = null;
    try {
      const res = await fetch(num.voxbiz_api_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        providerError = `Voxbiz ${res.status}: ${text.slice(0, 300)}`;
      } else {
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          providerCallId =
            (json.call_id as string) ||
            (json.uuid as string) ||
            (json.id as string) ||
            null;
          providerStatus = (json.status as string) || "initiated";
        } catch {
          providerStatus = "initiated";
        }
      }
    } catch (e) {
      providerError = `Network error: ${e instanceof Error ? e.message : String(e)}`;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("calls")
      .insert({
        user_id: userId,
        agent_id: num.agent_id,
        phone_number_id: num.id,
        provider: "voxbiz",
        provider_call_id: providerCallId,
        direction: "test",
        from_number: from,
        to_number: to,
        status: providerError ? "failed" : providerStatus,
        summary: providerError ?? "Test call placed via Voxbiz Click2Call",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insErr) throw insErr;

    if (providerError) throw new Error(providerError);
    return { call: inserted };
  });
