
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  careers_url TEXT NOT NULL,
  notes TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name TEXT,
  title TEXT NOT NULL,
  location TEXT,
  remote_ok BOOLEAN NOT NULL DEFAULT false,
  france_ok BOOLEAN NOT NULL DEFAULT false,
  url TEXT NOT NULL UNIQUE,
  description TEXT,
  seniority TEXT,
  is_ai_native BOOLEAN NOT NULL DEFAULT false,
  fit_score INT NOT NULL DEFAULT 0,
  fit_reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_jobs_fit_score ON public.jobs(fit_score DESC);
CREATE INDEX idx_jobs_scraped_at ON public.jobs(scraped_at DESC);

CREATE TYPE public.application_status AS ENUM ('interested','applied','interview','offer','rejected');

CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE,
  status public.application_status NOT NULL DEFAULT 'interested',
  applied_at TIMESTAMPTZ,
  notes TEXT,
  next_action TEXT,
  next_action_at TIMESTAMPTZ,
  contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.preferences (
  id INT PRIMARY KEY DEFAULT 1,
  locations TEXT[] NOT NULL DEFAULT ARRAY['Remote','France'],
  seniorities TEXT[] NOT NULL DEFAULT ARRAY['Senior','Lead','Principal'],
  keywords_include TEXT[] NOT NULL DEFAULT ARRAY['AI','LLM','product manager','PM'],
  keywords_exclude TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_comp INT,
  profile_summary TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT preferences_singleton CHECK (id = 1)
);

INSERT INTO public.preferences (id) VALUES (1);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;

-- Single-user tool: permissive policies
CREATE POLICY "open" ON public.companies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON public.applications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON public.preferences FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER applications_touch BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER preferences_touch BEFORE UPDATE ON public.preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
