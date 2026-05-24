-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ==========================================
-- 1. TABLES
-- ==========================================

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  age_range text NOT NULL,
  needs_deletion boolean DEFAULT false, -- Required for Part 3 Retention Policy
  created_at timestamptz NOT NULL DEFAULT now()
);

-- MOVED UP: Must be created before classifications
CREATE TABLE public.clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  top_keywords text[] NOT NULL DEFAULT '{}',
  sample_posts text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE CASCADE,
  party text NOT NULL CHECK (party IN ('Ra''am', 'Hadash', 'Balad', 'Ta''al', 'Jewish-sector party', 'unclear')),
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  cluster_id uuid REFERENCES public.clusters (id) ON DELETE SET NULL,
  classified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  scope text NOT NULL,
  source text NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- ==========================================
-- 2. RLS & REALTIME
-- ==========================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

-- Simplified Admin Policy for Assignment
CREATE POLICY "authenticated_all" ON public.profiles FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON public.posts FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON public.classifications FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON public.clusters FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON public.consent_log FOR ALL TO authenticated USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.classifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clusters;