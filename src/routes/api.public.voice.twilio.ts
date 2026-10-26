import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const { handleTwilioAnswer } = await import("@/lib/twilio-voice.server");
  return handleTwilioAnswer(request);
}

export const Route = createFileRoute("/api/public/voice/twilio")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});