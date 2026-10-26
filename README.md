<div align="center">

# BlipX

### Voice AI agents for your business, live in under 10 minutes.

Human-sounding, multilingual voice agents for inbound and outbound calls.
**₹2–3 per minute, all-in. No code. No setup fee.**

[**Live site**](https://blipx.axolv.in/) · [**Try the demo**](https://blipx.axolv.in/demo) · [**Build an agent**](https://blipx.axolv.in/agents/new)

![Status](https://img.shields.io/badge/status-live-brightgreen)
![Pricing](https://img.shields.io/badge/pricing-%E2%82%B92--3%2Fmin-blue)
![Languages](https://img.shields.io/badge/languages-9-orange)
![Models](https://img.shields.io/badge/models-API%20%2B%20Open%20Source-purple)
![Code](https://img.shields.io/badge/setup-no--code-lightgrey)

</div>

---

## Table of Contents

- [What is BlipX?](#what-is-blipx)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Supported Languages](#supported-languages)
- [AI Models & Architecture](#ai-models--architecture)
- [Pricing](#pricing)
- [Use Cases](#use-cases)
- [Dashboard & Analytics](#dashboard--analytics)
- [Getting Started](#getting-started)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Contact & Legal](#contact--legal)

---

## What is BlipX?

**BlipX** lets any business put a natural-sounding AI voice agent on its phone line. Describe your business in a sentence, pick a voice and language, connect a number, and your agent starts answering calls, 24/7.

It is built for businesses that lose revenue to missed calls: clinics, salons, real-estate teams, D2C brands, service businesses, and support desks.

> **Never miss a customer call.**

---

## Key Features

| | Feature | Description |
|---|---|---|
| 📞 | **Answers every call** | Picks up 24/7, answers questions, books appointments, and hands tricky calls to a human. |
| 🗣️ | **Speaks like a person** | Natural voice, real pauses, and intonation. Handles interruptions mid-sentence. |
| 🌐 | **Multilingual** | Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Gujarati, Malayalam and English, with mid-call language switching. |
| ↔️ | **Inbound + outbound** | Handle incoming support calls, or place reminder and lead follow-up calls. |
| 🔢 | **Bring your own number** | Connect an existing number or get a new one inside the app. |
| 📊 | **Live dashboard** | Watch calls, transcripts, and costs in real time. |
| 💰 | **Predictable cost** | One flat promise: ₹2–3 per minute, everything included. |
| 🧩 | **No code** | Configure everything from the browser. |

---

## How It Works

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │ 1. Describe  │ → │ 2. Pick a    │ → │ 3. Connect a │ → │ 4. Go live   │
 │ your business│   │ voice & lang │   │ phone number │   │ in 10 minutes│
 └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

1. **Describe your business**: one sentence is enough to start.
2. **Pick a voice and language**: Hindi, Tamil, English, or code-switched.
3. **Connect a phone number**: bring your own or get one in the app.
4. **Go live**: monitor calls, transcripts, and costs from your dashboard.

### Call pipeline

```
Caller ──► Telephony ──► Speech-to-Text ──► LLM (agent brain) ──► Text-to-Speech ──► Caller
                              ▲                    │
                              │                    ├── business knowledge / prompt
                              └── barge-in         ├── tools (booking, handoff, etc.)
                                  detection        └── cost guardrail (≤ ₹3/min)
```

---

## Supported Languages

| | | |
|---|---|---|
| English | Hindi | Tamil |
| Telugu | Bengali | Marathi |
| Kannada | Gujarati | Malayalam |

Agents can switch languages **mid-call** (for example Hinglish or Tanglish) without losing context.

---

## AI Models & Architecture

BlipX uses a **hybrid model strategy**, combining **hosted API-based models** with **open-source models**. Each layer of the voice stack is matched to the model that gives the best quality inside the price ceiling.

### Why hybrid?

| Approach | Used for | Why |
|---|---|---|
| **API-based models** (hosted, proprietary) | Layers where quality, latency, or language coverage matters most | State-of-the-art accuracy, no infrastructure to run, fast to upgrade |
| **Open-source models** (self-hosted or open-weight) | Layers where cost, control, and customisation matter most | Lower per-minute cost, tunable for Indian languages, no vendor lock-in |

The ₹2–3/min price is possible because BlipX picks the exact stack that lands within the ceiling and **blocks any configuration that would exceed it**.

### Model layers

| Layer | Role | API-based option(s) | Open-source option(s) |
|---|---|---|---|
| 🎙️ **Speech-to-Text (ASR)** | Transcribes the caller's speech in real time | _Add your hosted STT provider(s)_ | _Add your open-source ASR model(s)_ |
| 🧠 **Language Model (LLM)** | Understands intent, reasons, decides the reply and tool calls | _Add your hosted LLM provider(s)_ | _Add your open-weight LLM(s)_ |
| 🔊 **Text-to-Speech (TTS)** | Generates the natural-sounding voice | _Add your hosted TTS provider(s)_ | _Add your open-source TTS model(s)_ |
| ⏸️ **Voice Activity / Turn detection** | Detects interruptions and end-of-turn | _Optional_ | _Add your VAD model_ |
| ☎️ **Telephony** | Carries the call (PSTN / SIP) | _Add your telephony provider_ | N/A |

> **Note:** Replace the placeholders above with the exact models and providers you run in production. The site does not publicly name them, so they are left for you to fill in rather than guessed.

### Model routing (optional section to keep or remove)

- **Per-language routing**: different ASR/TTS models for different Indian languages.
- **Cost guardrail**: every agent configuration is priced before going live; anything above ₹3/min is rejected.
- **Fallbacks**: if a hosted API is slow or unavailable, calls can fail over to an open-source model.

---

## Pricing

<div align="center">

### ₹2–3 per minute, all-in

</div>

Includes:

- ✅ Telephony
- ✅ Voice (TTS)
- ✅ AI (speech recognition + language model)
- ✅ Dashboard and transcripts
- ✅ **No setup fee**
- ✅ **No credit card to start**

If a setting would push your cost above **₹3/min**, BlipX simply won't let it go live.

---

## Use Cases

- 🏥 **Customer support**: answer FAQs, hours, pricing, and status checks around the clock.
- 📅 **Appointment booking**: clinics, salons, consultants, and service providers.
- ⏰ **Reminders**: appointment, payment, and renewal reminders by outbound call.
- 📈 **Lead follow-up**: call new leads within seconds of enquiry and qualify them.
- 🛎️ **After-hours coverage**: never send a caller to voicemail again.

---

## Dashboard & Analytics

From the dashboard you can:

- Watch **live and past calls**
- Read full **transcripts**
- Track **cost per call and per minute**
- Review agent performance and handoffs

---

## Getting Started

1. Go to **[blipx.axolv.in](https://blipx.axolv.in/)**
2. Click **Build my agent** (or [sign in](https://blipx.axolv.in/auth))
3. Describe your business in a sentence
4. Choose a voice and language
5. Connect or get a phone number
6. Go live

Want to hear it first? **[Try the live demo →](https://blipx.axolv.in/demo)**

---

## FAQ

**Will it actually sound like a real person?**
Yes. Natural pauses, real intonation, and the ability to be interrupted mid-sentence.

**What's the catch with ₹2–3/min?**
None. BlipX picks the exact stack that lands within the ceiling and blocks anything that would exceed it.

**Can I use my own phone number?**
Yes. Connect an existing number, or get a new one inside the app.

**Does it work in Indian languages?**
Yes: Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Gujarati, Malayalam, plus English, including mid-call switching.

**Does BlipX use open-source or proprietary models?**
Both. BlipX combines hosted API models with open-source models, choosing per layer for quality and cost.

---

## Roadmap

- [ ] More Indian and international languages
- [ ] CRM and calendar integrations
- [ ] WhatsApp and SMS follow-ups after calls
- [ ] Custom voice cloning
- [ ] Advanced analytics and sentiment tracking

_Edit this list to match your real plans._

---

## Contributing

Feedback and ideas are welcome. Open an issue or reach out through the contact link on the site.

---

## Contact & Legal

- 🌐 Website: [blipx.axolv.in](https://blipx.axolv.in/)
- ✉️ Contact: hello@axolv.in

---

<div align="center">

**© 2026 BlipX. Voice agents for everyone.**

Stop missing calls. Start sounding like the business you meant to build.

</div>
