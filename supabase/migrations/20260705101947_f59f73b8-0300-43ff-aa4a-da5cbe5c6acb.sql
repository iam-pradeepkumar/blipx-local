
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS use_realtime boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stt_provider text NOT NULL DEFAULT 'deepgram',
  ADD COLUMN IF NOT EXISTS stt_model text NOT NULL DEFAULT 'nova-3',
  ADD COLUMN IF NOT EXISTS llm_provider text NOT NULL DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS llm_model text NOT NULL DEFAULT 'gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS llm_temperature numeric NOT NULL DEFAULT 0.6,
  ADD COLUMN IF NOT EXISTS tts_provider text NOT NULL DEFAULT 'elevenlabs',
  ADD COLUMN IF NOT EXISTS tts_voice_id text NOT NULL DEFAULT 'EXAVITQu4vr4xnSDxMaL',
  ADD COLUMN IF NOT EXISTS tts_model text NOT NULL DEFAULT 'eleven_turbo_v2_5',
  ADD COLUMN IF NOT EXISTS first_message_mode text NOT NULL DEFAULT 'assistant-speaks-first',
  ADD COLUMN IF NOT EXISTS interruption_threshold_ms integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS silence_timeout_ms integer NOT NULL DEFAULT 8000,
  ADD COLUMN IF NOT EXISTS max_duration_sec integer NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS end_call_phrases text[] NOT NULL DEFAULT ARRAY['goodbye','bye','end call','hang up']::text[];

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS recording_url text;
