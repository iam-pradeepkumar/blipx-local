ALTER TABLE public.phone_numbers
  ADD COLUMN voxbiz_api_key TEXT,
  ADD COLUMN voxbiz_api_url TEXT,
  ADD COLUMN voxbiz_caller_id TEXT;