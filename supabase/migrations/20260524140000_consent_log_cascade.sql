-- Remove orphan rows (if any) before adding FK
DELETE FROM public.consent_log cl
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = cl.profile_id
);

ALTER TABLE public.consent_log
  ADD CONSTRAINT consent_log_profile_id_fkey
  FOREIGN KEY (profile_id)
  REFERENCES public.profiles (id)
  ON DELETE CASCADE;