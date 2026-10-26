// Server-only helpers that touch credits with elevated privileges.
// Import inside handlers with `await import(...)`, never at module scope of a `.functions.ts` file.

export async function getBalanceInr(userId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_credits")
    .select("balance_inr")
    .eq("user_id", userId)
    .maybeSingle();
  return Number(data?.balance_inr ?? 0);
}

/** Deduct INR from the user, log a ledger row, return the new balance. Never goes below 0. */
export async function deductInr(
  userId: string,
  amount: number,
  opts: { callId?: string | null; note?: string } = {},
): Promise<number> {
  if (amount <= 0) return getBalanceInr(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("deduct_credits", {
    _user_id: userId,
    _amount: amount,
    _call_id: opts.callId ?? undefined,
    _note: opts.note ?? undefined,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
