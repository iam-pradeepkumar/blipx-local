// Single source of truth for voice call pricing (INR).
// Approximates real Gemini Live cost + small platform margin so what users
// see in the Costs tab matches what actually gets deducted from credits.
//
// Gemini 2.5 Flash Native Audio Live (Nov 2025) is roughly:
//   audio in  ~$0.09/min, audio out ~$0.36/min  → ≈ $0.09/min blended (short replies)
// At ₹85/USD ≈ ₹7.6/min. We charge ₹8/min → tiny margin for compute + AI post-processing.

export const VOICE_INR_PER_MINUTE = 3;

/** Return INR cost for a given call duration in seconds. */
export function costForSeconds(sec: number): number {
  const s = Math.max(0, sec);
  return Number(((s / 60) * VOICE_INR_PER_MINUTE).toFixed(2));
}

/** Minimum balance (INR) required before a call is allowed to start. */
export const MIN_START_BALANCE_INR = 0.5;
