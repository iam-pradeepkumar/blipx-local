
-- 1. user_credits
CREATE TABLE public.user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own credits read" ON public.user_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER user_credits_updated_at BEFORE UPDATE ON public.user_credits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. credit_ledger
CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta_inr NUMERIC(12,2) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signup','recharge','usage','adjustment')),
  note TEXT,
  ref_call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON public.credit_ledger (user_id, created_at DESC);
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ledger read" ON public.credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3. voice_samples (cached preview clips)
CREATE TABLE public.voice_samples (
  voice_name TEXT PRIMARY KEY,
  audio_base64 TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/wav',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.voice_samples TO authenticated;
GRANT ALL ON public.voice_samples TO service_role;
ALTER TABLE public.voice_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice samples read" ON public.voice_samples FOR SELECT TO authenticated USING (true);

-- 4. Update handle_new_user to also grant ₹20 signup credit
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  INSERT INTO public.user_credits (user_id, balance_inr) VALUES (NEW.id, 20.00)
    ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.credit_ledger (user_id, delta_inr, kind, note)
    VALUES (NEW.id, 20.00, 'signup', 'Welcome bonus');
  RETURN NEW;
END;
$$;

-- 5. Backfill existing users
INSERT INTO public.user_credits (user_id, balance_inr)
SELECT id, 20.00 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.credit_ledger (user_id, delta_inr, kind, note)
SELECT uc.user_id, 20.00, 'signup', 'Welcome bonus (backfill)'
FROM public.user_credits uc
LEFT JOIN public.credit_ledger cl ON cl.user_id = uc.user_id AND cl.kind = 'signup'
WHERE cl.id IS NULL;

-- 6. Atomic deduct RPC (SECURITY DEFINER — server-side only usage)
CREATE OR REPLACE FUNCTION public.deduct_credits(
  _user_id UUID,
  _amount NUMERIC,
  _call_id UUID DEFAULT NULL,
  _note TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance NUMERIC;
BEGIN
  IF _amount <= 0 THEN
    SELECT balance_inr INTO _new_balance FROM public.user_credits WHERE user_id = _user_id;
    RETURN COALESCE(_new_balance, 0);
  END IF;
  INSERT INTO public.user_credits (user_id, balance_inr) VALUES (_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_credits
    SET balance_inr = GREATEST(0, balance_inr - _amount), updated_at = now()
    WHERE user_id = _user_id
    RETURNING balance_inr INTO _new_balance;
  INSERT INTO public.credit_ledger (user_id, delta_inr, kind, note, ref_call_id)
    VALUES (_user_id, -_amount, 'usage', COALESCE(_note, 'Call usage'), _call_id);
  RETURN _new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deduct_credits(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, NUMERIC, UUID, TEXT) TO service_role;

-- 7. Recharge RPC — user-initiated top-up (mock; no payment gateway yet)
CREATE OR REPLACE FUNCTION public.recharge_credits(_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _new_balance NUMERIC;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount <= 0 OR _amount > 100000 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  INSERT INTO public.user_credits (user_id, balance_inr) VALUES (_uid, _amount)
    ON CONFLICT (user_id) DO UPDATE SET balance_inr = public.user_credits.balance_inr + EXCLUDED.balance_inr, updated_at = now()
    RETURNING balance_inr INTO _new_balance;
  INSERT INTO public.credit_ledger (user_id, delta_inr, kind, note)
    VALUES (_uid, _amount, 'recharge', 'Manual top-up');
  RETURN _new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recharge_credits(NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recharge_credits(NUMERIC) TO authenticated, service_role;
