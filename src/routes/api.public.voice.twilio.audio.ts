import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/voice/twilio/audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleTwilioAudio } = await import("@/lib/twilio-voice.server");
        return handleTwilioAudio(request);
      },
    },
  },
});