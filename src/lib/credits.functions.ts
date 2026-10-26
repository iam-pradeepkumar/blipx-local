import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Read the signed-in user's current balance + recent ledger. */
export const getMyCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: credits }, { data: ledger }] = await Promise.all([
      supabase.from("user_credits").select("balance_inr,updated_at").eq("user_id", userId).maybeSingle(),
      supabase.from("credit_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    ]);
    return {
      balance: Number(credits?.balance_inr ?? 0),
      updated_at: credits?.updated_at ?? null,
      ledger: ledger ?? [],
    };
  });

/** Manual recharge (mock — no payment gateway yet). Amount in INR. */
export const rechargeCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const d = input as { amount: number };
    if (!d || typeof d.amount !== "number" || d.amount <= 0 || d.amount > 100000) {
      throw new Error("Invalid amount");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;
    const { data: row, error: uErr } = await supabaseAdmin
      .from("user_credits")
      .select("balance_inr")
      .eq("user_id", userId)
      .maybeSingle();
    if (uErr) throw uErr;
    const current = Number(row?.balance_inr ?? 0);
    const next = Number((current + data.amount).toFixed(2));
    if (row) {
      const { error: e2 } = await supabaseAdmin.from("user_credits")
        .update({ balance_inr: next }).eq("user_id", userId);
      if (e2) throw e2;
    } else {
      const { error: e2 } = await supabaseAdmin.from("user_credits")
        .insert({ user_id: userId, balance_inr: next });
      if (e2) throw e2;
    }
    await supabaseAdmin.from("credit_ledger").insert({
      user_id: userId, delta_inr: data.amount, kind: "recharge", note: "Manual top-up",
    });
    return { balance: next };
  });
