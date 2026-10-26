import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const { handleTwilioStatus } = await import("@/lib/twilio-voice.server");
  return handleTwilioStatus(request);
}

export const Route = createFileRoute("/api/public/voice/twilio/status")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});