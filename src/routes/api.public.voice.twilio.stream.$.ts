import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const { handleTwilioStreamRoute } = await import("@/lib/twilio-stream-route.server");
  return handleTwilioStreamRoute(request);
}

export const Route = createFileRoute("/api/public/voice/twilio/stream/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});