
# Vapi/Retell-style upgrade — edit in place, keep Blipx theme

No files deleted. Every change is an edit to an existing file so nothing you already built is lost.

## 1. Cost guard — the ₹3/min rule (one source of truth)

Edit `src/lib/pricing.ts` and `src/lib/voice-providers.ts`:

- One `PROVIDERS` registry with per-minute INR cost for every STT / LLM / TTS option.
- One helper `estimateCostPerMin({ stt, llm, tts }) → { inr, breakdown, withinBudget }`.
- Locked presets a non-technical user can pick in one click:
  - **Ultra Saver ≈ ₹1.1/min** — Deepgram Nova STT + Gemini Flash (Lovable AI) + Deepgram Aura TTS
  - **Balanced ≈ ₹2.2/min** — Deepgram Nova + Gemini Flash + ElevenLabs Flash
  - **Indian Premium ≈ ₹2.7/min** — Sarvam STT + Gemini Flash + Sarvam TTS
- Any custom combo > ₹3/min is blocked in the UI (save button disabled + red banner).

## 2. Agent Builder — Vapi/Retell-style wizard

Edit `src/routes/_authenticated/agents.new.tsx` and `agents.$agentId.details.tsx`:

Tabs in this order, plain-English labels for non-technical users:

1. **Basics** — name, language, greeting (first sentence caller hears)
2. **Personality** — system prompt with 6 starter templates (Receptionist, Lead Qualifier, Appointment Booker, Support, Survey, Custom)
3. **Voice** — preset picker (three cards above) + advanced dropdowns; live "₹/min" chip that turns red > ₹3
4. **Knowledge** — upload PDFs / paste text / add URLs (uses existing `knowledge.functions.ts`)
5. **Tools** — toggle cards: End Call, Transfer to Human, Send SMS, Book Calendar, Custom Webhook
6. **Test** — reuse existing `agents.$agentId.test.tsx` browser-mic tester

## 3. Inbound calls — Twilio number → agent auto-answers

Edit `src/lib/twilio-voice.server.ts` and `src/lib/realtime-voice.server.ts`:

- Twilio webhook looks up `phone_numbers.agent_id`, streams caller audio into the realtime pipeline (STT → LLM → TTS) chosen on that agent.
- Human-like: barge-in, ~200 ms end-of-turn, greeting spoken immediately on answer.
- Every second of airtime deducts credits via existing `deduct_credits` RPC; call auto-hangs-up when balance hits 0.

## 4. Outbound campaigns

Edit `src/routes/_authenticated/campaigns.new.tsx`, `campaigns.$campaignId.tsx`, `src/lib/campaigns.functions.ts`:

- CSV upload with column mapper (phone, name, custom vars).
- Pick agent + from-number + concurrency (1–10 parallel calls).
- Start / Pause / Resume; live progress bar; per-lead status (queued / dialing / answered / failed / done) with transcript link.

## 5. Web call widget

Edit `src/routes/_authenticated/agents.$agentId.details.tsx` — add a **Share** tab:

- Public URL `/talk/:agentId` (new route, but a small addition — every other change is in-place edits).
- Copy-paste embed snippet (`<script src=".../widget.js" data-agent="…">`).
- One floating "Talk to agent" button, mic permission prompt, live transcript, hang-up. Same realtime pipeline as phone calls.

## 6. UI / theme

Zero changes to design tokens, colors, fonts, or existing components. All new UI uses current shadcn primitives + Blipx dark theme.

---

## Technical notes (safe to skip)

- All server logic stays in `createServerFn` + existing `.server.ts` helpers — no edge functions added.
- Provider routing lives entirely inside `realtime-voice.server.ts`; UI only stores provider IDs on `agents` row (columns already exist from earlier work).
- Cost meter is client-side pure function so the ₹/min chip updates instantly as the user changes dropdowns.
- Sarvam and ElevenLabs need API keys — I'll request them via the secure secret form only when you pick a preset that needs them. Ultra Saver preset needs no extra keys (Deepgram + Lovable AI only, and Deepgram key is already in your secrets list once you add it).

Reply **approve** and I'll start editing.
