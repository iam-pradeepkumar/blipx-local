ALTER TABLE public.phone_numbers
  ADD COLUMN sip_username TEXT,
  ADD COLUMN sip_password TEXT,
  ADD COLUMN sip_host TEXT,
  ADD COLUMN sip_uri TEXT,
  ADD COLUMN sip_status TEXT NOT NULL DEFAULT 'unconfigured';