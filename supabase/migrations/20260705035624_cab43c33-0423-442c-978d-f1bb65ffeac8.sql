
-- Agent extensions
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS voice_name TEXT NOT NULL DEFAULT 'Leda',
  ADD COLUMN IF NOT EXISTS voice_style TEXT,
  ADD COLUMN IF NOT EXISTS auto_detect_language BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS automations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Knowledge documents
CREATE TABLE IF NOT EXISTS public.knowledge_docs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'text',
  title TEXT NOT NULL,
  source_url TEXT,
  content TEXT NOT NULL DEFAULT '',
  size_chars INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_docs_agent_idx ON public.knowledge_docs(agent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_docs TO authenticated;
GRANT ALL ON public.knowledge_docs TO service_role;
ALTER TABLE public.knowledge_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage knowledge" ON public.knowledge_docs;
CREATE POLICY "Owners manage knowledge" ON public.knowledge_docs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS knowledge_docs_updated_at ON public.knowledge_docs;
CREATE TRIGGER knowledge_docs_updated_at
  BEFORE UPDATE ON public.knowledge_docs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Campaigns extensions
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS phone_number_id UUID REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS retry_delay_min INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS active_hours_start TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS active_hours_end TEXT NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Campaign leads
CREATE TABLE IF NOT EXISTS public.campaign_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | dialing | connected | completed | failed | opted_out | do_not_call
  attempts INTEGER NOT NULL DEFAULT 0,
  next_dial_at TIMESTAMPTZ,
  last_call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  last_error TEXT,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_leads_campaign_idx ON public.campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_leads_next_dial_idx ON public.campaign_leads(next_dial_at) WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_leads TO authenticated;
GRANT ALL ON public.campaign_leads TO service_role;
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage campaign leads" ON public.campaign_leads;
CREATE POLICY "Owners manage campaign leads" ON public.campaign_leads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS campaign_leads_updated_at ON public.campaign_leads;
CREATE TRIGGER campaign_leads_updated_at
  BEFORE UPDATE ON public.campaign_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Calls -> campaign linkage
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.campaign_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS calls_campaign_idx ON public.calls(campaign_id);
