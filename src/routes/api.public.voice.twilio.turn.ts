import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const { handleTwilioTurn } = await import("@/lib/twilio-voice.server");
  return handleTwilioTurn(request);
}

export const Route = createFileRoute("/api/public/voice/twilio/turn")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});