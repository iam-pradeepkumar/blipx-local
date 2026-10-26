// Mock data layer for BlipX demo. Replace with Dograh + Lovable Cloud reads later.

export type Agent = {
  id: string;
  name: string;
  business: string;
  industry: string;
  direction: "inbound" | "outbound" | "both";
  languages: string[];
  tone: string;
  voice: string;
  greeting: string;
  costPerMin: number; // INR
  status: "live" | "draft" | "paused";
  createdAt: string;
};

export type CallRecord = {
  id: string;
  agentId: string;
  caller: string;
  direction: "inbound" | "outbound";
  durationSec: number;
  outcome: "resolved" | "escalated" | "abandoned" | "no-answer" | "voicemail";
  sentiment: "positive" | "neutral" | "negative";
  language: string;
  summary: string;
  costINR: number;
  startedAt: string;
  fields: Record<string, string>;
};

export type Campaign = {
  id: string;
  agentId: string;
  name: string;
  total: number;
  connected: number;
  completed: number;
  failed: number;
  optedOut: number;
  status: "running" | "scheduled" | "paused" | "done";
  window: string;
  startedAt: string;
};

export const mockAgents: Agent[] = [
  {
    id: "agt_1",
    name: "Anika",
    business: "Saravana Mart",
    industry: "Retail / Grocery",
    direction: "both",
    languages: ["Tamil", "English", "Tanglish"],
    tone: "Friendly",
    voice: "Female · Warm",
    greeting: "Vanakkam! Saravana Mart-il irundhu Anika pesuren. Eppadi help pannalaam?",
    costPerMin: 2.4,
    status: "live",
    createdAt: "2026-06-10",
  },
  {
    id: "agt_2",
    name: "Rohan",
    business: "ZipPay Loans",
    industry: "Fintech",
    direction: "outbound",
    languages: ["Hindi", "English", "Hinglish"],
    tone: "Professional",
    voice: "Male · Calm",
    greeting: "Namaste, main ZipPay se Rohan baat kar raha hoon. Aapke EMI ke baare mein call kiya hai.",
    costPerMin: 2.7,
    status: "live",
    createdAt: "2026-06-18",
  },
  {
    id: "agt_3",
    name: "Priya",
    business: "BlueLeaf Clinic",
    industry: "Healthcare",
    direction: "inbound",
    languages: ["English", "Kannada"],
    tone: "Empathetic",
    voice: "Female · Soft",
    greeting: "Hi, this is Priya at BlueLeaf Clinic. How can I help you today?",
    costPerMin: 2.2,
    status: "paused",
    createdAt: "2026-05-22",
  },
];

const SAMPLE_NAMES = [
  "Karthik R.", "Meera S.", "Suresh P.", "Anjali V.", "Vikram J.",
  "Lakshmi N.", "Arjun M.", "Divya K.", "Rahul T.", "Pooja G.",
];
const SAMPLE_SUMMARIES = [
  "Customer asked about order #4421 delivery date. Agent confirmed shipment tomorrow.",
  "Caller wanted to reschedule appointment. Booked for Friday 4 PM.",
  "Payment reminder accepted. Customer will pay via UPI by EOD.",
  "Complaint about damaged product. Escalated to human support.",
  "FAQ about return policy answered. Caller satisfied.",
  "Voicemail left — caller did not pick up.",
  "Lead qualified: interested in premium plan, callback requested.",
];

export const mockCalls: CallRecord[] = Array.from({ length: 38 }).map((_, i) => {
  const dir: "inbound" | "outbound" = i % 3 === 0 ? "outbound" : "inbound";
  const outcomes: CallRecord["outcome"][] = ["resolved", "resolved", "resolved", "escalated", "abandoned", "no-answer", "voicemail"];
  const out = outcomes[i % outcomes.length];
  const dur = out === "no-answer" ? 0 : out === "voicemail" ? 18 : 60 + (i * 13) % 240;
  return {
    id: `call_${1000 + i}`,
    agentId: mockAgents[i % mockAgents.length].id,
    caller: `+91 9${(800000000 + i * 12345).toString().slice(0, 9)}`,
    direction: dir,
    durationSec: dur,
    outcome: out,
    sentiment: (["positive", "neutral", "negative"] as const)[i % 3],
    language: ["English", "Tamil", "Hindi", "Hinglish"][i % 4],
    summary: SAMPLE_SUMMARIES[i % SAMPLE_SUMMARIES.length],
    costINR: +((dur / 60) * (2.1 + (i % 5) * 0.15)).toFixed(2),
    startedAt: new Date(Date.now() - i * 1000 * 60 * 47).toISOString(),
    fields: {
      Name: SAMPLE_NAMES[i % SAMPLE_NAMES.length],
      "Order ID": `#${4400 + i}`,
      Issue: ["Delivery", "Return", "Payment", "Booking", "General"][i % 5],
    },
  };
});

export const mockCampaigns: Campaign[] = [
  {
    id: "cmp_1",
    agentId: "agt_2",
    name: "June EMI Reminders — Batch 1",
    total: 1240,
    connected: 891,
    completed: 743,
    failed: 248,
    optedOut: 12,
    status: "running",
    window: "10:00 – 19:00 IST",
    startedAt: "2026-06-28",
  },
  {
    id: "cmp_2",
    agentId: "agt_1",
    name: "Diwali pre-orders follow-up",
    total: 480,
    connected: 410,
    completed: 405,
    failed: 70,
    optedOut: 3,
    status: "done",
    window: "11:00 – 18:00 IST",
    startedAt: "2026-06-15",
  },
  {
    id: "cmp_3",
    agentId: "agt_2",
    name: "Weekly feedback NPS",
    total: 320,
    connected: 0,
    completed: 0,
    failed: 0,
    optedOut: 0,
    status: "scheduled",
    window: "14:00 – 17:00 IST",
    startedAt: "2026-07-02",
  },
];

export const insightsTopReasons = [
  { reason: "Order status / delivery date", count: 124 },
  { reason: "Return & refund", count: 88 },
  { reason: "Payment / EMI", count: 71 },
  { reason: "Appointment booking", count: 54 },
  { reason: "Product availability", count: 39 },
];

export const insightsByHour = Array.from({ length: 12 }).map((_, i) => ({
  hour: `${(i + 9).toString().padStart(2, "0")}:00`,
  calls: Math.round(8 + Math.sin(i / 2) * 6 + (i % 3) * 4),
}));

export const insightsCostByDay = Array.from({ length: 14 }).map((_, i) => ({
  day: `D${i + 1}`,
  cost: +(180 + Math.sin(i / 2) * 60 + (i % 4) * 25).toFixed(0),
  minutes: Math.round(80 + Math.sin(i / 2) * 30 + (i % 4) * 10),
}));

export const languageMix = [
  { name: "English", value: 38 },
  { name: "Hindi", value: 26 },
  { name: "Tamil", value: 22 },
  { name: "Hinglish", value: 14 },
];

export function formatDuration(sec: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
