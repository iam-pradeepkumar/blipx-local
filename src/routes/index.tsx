import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BlipxNav } from "@/components/BlipxNav";
import { ArrowUpRight, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BlipX — Voice AI agents for customer support, in minutes" },
      {
        name: "description",
        content:
          "BlipX builds production-ready, human-sounding voice agents for inbound & outbound calls. ₹2–3 per minute, all-in. No code.",
      },
      { property: "og:title", content: "BlipX — Voice AI agents in minutes" },
      {
        property: "og:description",
        content:
          "Human-sounding multilingual voice agents for support, reminders, and lead follow-up. ₹2–3/min, all-in. No code.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlipxNav />
      <Hero />
      <FeatureRow />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}

function TypingLanguages() {
  const words = [
    "any language",
    "English",
    "हिन्दी",
    "தமிழ்",
    "తెలుగు",
    "मराठी",
    "বাংলা",
    "ಕನ್ನಡ",
    "ગુજરાતી",
    "മലയാളം",
    "Español",
    "Français",
    "العربية",
  ];
  const [wordIdx, setWordIdx] = useState(0);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = words[wordIdx];
    const atFull = !deleting && text === current;
    const atEmpty = deleting && text === "";
    const delay = atFull ? 1400 : atEmpty ? 250 : deleting ? 45 : 85;

    const t = setTimeout(() => {
      if (atFull) {
        setDeleting(true);
      } else if (atEmpty) {
        setDeleting(false);
        setWordIdx((i) => (i + 1) % words.length);
      } else {
        setText(deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1));
      }
    }, delay);
    return () => clearTimeout(t);
  }, [text, deleting, wordIdx]);

  return (
    <span aria-live="polite">
      {text}
      <span className="inline-block w-[2px] md:w-[3px] h-[0.9em] align-[-0.05em] ml-1 bg-ink animate-pulse" />
    </span>
  );
}

/* ── Hero: antigravity.google-style — centered, huge, breathing whitespace ── */
function Hero() {
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-40 pb-20 md:pb-28 text-center">
        {/* Tiny brand chip above headline */}
        <div className="flex items-center justify-center gap-2 text-sm md:text-base font-medium text-ink-soft">
          <span className="relative grid place-items-center w-6 h-6 rounded-lg bg-primary">
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-lime" />
          </span>
          <span className="text-foreground font-semibold">BlipX</span>
          <span className="text-ink-soft">Voice AI</span>
        </div>

        {/* Massive centered headline */}
        <h1 className="display-xl mt-8 max-w-5xl mx-auto">
          Never miss a customer call.{" "}
          <span className="text-ink-soft">Your AI answers in </span>
          <span className="relative inline-block">
            <span className="relative z-10"><TypingLanguages /></span>
            <span className="absolute inset-x-0 bottom-1 h-3 md:h-5 bg-lime -z-0 rounded-sm" />
          </span>
          <span className="text-ink-soft">.</span>
        </h1>

        {/* One clean sentence, non-technical */}
        <p className="mt-8 text-base md:text-lg text-ink-soft max-w-2xl mx-auto leading-relaxed">
          BlipX builds a human-sounding voice agent for your business in under 10 minutes.
          Inbound, outbound, or both. <strong className="text-foreground">₹2–3 per minute, all-in.</strong>
        </p>

        {/* Two pill CTAs, antigravity style */}
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <Link
            to="/agents/new"
            className="inline-flex items-center gap-2 pill bg-primary text-primary-foreground px-6 py-3.5 text-sm md:text-base font-semibold shadow-pill hover:opacity-90 transition"
          >
            Build my agent <ArrowUpRight className="size-4" />
          </Link>
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 pill bg-muted text-foreground px-6 py-3.5 text-sm md:text-base font-semibold hover:bg-secondary transition"
          >
            <PlayCircle className="size-4" /> Try the live demo
          </Link>
        </div>

        {/* Small proof line */}
        <p className="mt-10 text-xs md:text-sm text-ink-soft">
          No code · No credit card · Set up in one sitting
        </p>
      </div>
    </section>
  );
}

/* ── Simple feature row: 3 plain-language pillars ── */
function FeatureRow() {
  const items = [
    {
      title: "Answers every call",
      body: "Your agent picks up 24/7, answers questions, books appointments, and passes tricky calls to you.",
    },
    {
      title: "Speaks like a person",
      body: "Natural voice, real pauses, understands interruptions. Callers won't realise it's AI.",
    },
    {
      title: "₹2–3 per minute, always",
      body: "One promise. Telephony, voice, everything included. We block anything that would cost more.",
    },
  ];
  return (
    <section id="product" className="border-t border-border">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28 grid md:grid-cols-3 gap-10 md:gap-14">
        {items.map((it, i) => (
          <div key={it.title}>
            <div className="font-display font-bold text-lime text-lg">0{i + 1}</div>
            <h3 className="mt-3 font-display font-bold text-2xl tracking-tight">{it.title}</h3>
            <p className="mt-3 text-ink-soft leading-relaxed">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── How it works: 4 quiet steps ── */
function HowItWorks() {
  const steps = [
    ["Describe your business", "In a sentence. That's it."],
    ["Pick a voice & language", "Hindi, Tamil, English, code-switched — you decide."],
    ["Connect a phone number", "Bring your own, or get one in the app."],
    ["Go live in 10 minutes", "Watch calls, transcripts and costs in your dashboard."],
  ];
  return (
    <section id="how" className="border-t border-border bg-muted/40">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <h2 className="display-lg text-center max-w-3xl mx-auto">
          From signup to a live agent — in one sitting.
        </h2>
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map(([t, b], i) => (
            <div key={t} className="text-center md:text-left">
              <div className="font-mono text-xs text-ink-soft">STEP {i + 1}</div>
              <h3 className="mt-2 font-display font-bold text-xl">{t}</h3>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 text-center">
          <Link
            to="/agents/new"
            className="inline-flex items-center gap-2 pill bg-primary text-primary-foreground px-6 py-3.5 text-sm md:text-base font-semibold hover:opacity-90 transition"
          >
            Start building <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Pricing: one number, big and honest ── */
function Pricing() {
  return (
    <section id="pricing" className="border-t border-border">
      <div className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
        <span className="chip-outline">Pricing</span>
        <h2 className="display-lg mt-6">One price. Everything included.</h2>
        <div className="mt-10 flex items-baseline justify-center gap-2">
          <span className="font-display font-bold text-7xl md:text-8xl tracking-tight">₹2–3</span>
          <span className="text-ink-soft text-lg">/ minute</span>
        </div>
        <p className="mt-6 text-ink-soft max-w-xl mx-auto leading-relaxed">
          Telephony, voice, AI, dashboard — all in. No setup fee. If a setting would push you above ₹3/min,
          we simply won't let it go live.
        </p>
        <div className="mt-10">
          <Link
            to="/agents/new"
            className="inline-flex items-center gap-2 pill bg-primary text-primary-foreground px-6 py-3.5 text-sm md:text-base font-semibold hover:opacity-90 transition"
          >
            Build my agent <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ: clean, minimal ── */
function FAQ() {
  const items = [
    {
      q: "Will it actually sound like a real person?",
      a: "Yes. Natural pauses, real intonation, and the ability to be interrupted mid-sentence. Most callers can't tell.",
    },
    {
      q: "What's the catch with ₹2–3/min?",
      a: "None. We picked the exact stack that lands within the ceiling and block anything that would exceed it.",
    },
    {
      q: "Can I use my own phone number?",
      a: "Yes. Connect an existing number, or get a new one inside the app.",
    },
    {
      q: "Does it work in Indian languages?",
      a: "Hindi, Tamil, Telugu, Bengali, Marathi, Kannada, Gujarati, Malayalam, plus English — including mid-call switching.",
    },
  ];
  return (
    <section id="faq" className="border-t border-border">
      <div className="max-w-3xl mx-auto px-6 py-20 md:py-28">
        <h2 className="display-lg text-center">Questions.</h2>
        <div className="mt-10 divide-y divide-border border-y border-border">
          {items.map(({ q, a }) => (
            <details key={q} className="group py-5">
              <summary className="flex items-center justify-between cursor-pointer font-display font-semibold text-lg list-none">
                {q}
                <span className="grid place-items-center w-8 h-8 rounded-full border border-border text-ink-soft group-open:rotate-45 group-open:bg-foreground group-open:text-background group-open:border-foreground transition">
                  +
                </span>
              </summary>
              <p className="mt-3 text-ink-soft leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="border-t border-border">
      <div className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
        <h2 className="display-lg max-w-2xl mx-auto">
          Stop missing calls. Start sounding like the business you meant to build.
        </h2>
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <Link
            to="/agents/new"
            className="inline-flex items-center gap-2 pill bg-primary text-primary-foreground px-6 py-3.5 text-sm md:text-base font-semibold hover:opacity-90 transition"
          >
            Build my agent <ArrowUpRight className="size-4" />
          </Link>
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 pill bg-muted text-foreground px-6 py-3.5 text-sm md:text-base font-semibold hover:bg-secondary transition"
          >
            Try the live demo
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-10 text-sm text-ink-soft">
      <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4">
        <div className="font-display font-bold text-foreground">
          BlipX<span className="text-lime">.</span>
        </div>
        <div>© 2026 BlipX. Voice agents for everyone.</div>
        <div className="flex gap-4">
          <a href="#" className="hover:text-foreground">Privacy</a>
          <a href="#" className="hover:text-foreground">Terms</a>
          <a href="#" className="hover:text-foreground">Contact</a>
        </div>
      </div>
    </footer>
  );
}
