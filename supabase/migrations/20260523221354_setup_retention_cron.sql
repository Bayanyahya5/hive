-- Retention policy: flag profiles older than 30 days (single cron job)

CREATE OR REPLACE FUNCTION public.flag_expired_profiles()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.profiles
  SET needs_deletion = true
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND needs_deletion = false;
END;
$$;

SELECT cron.schedule(
  'retention-policy-job',
  '0 0 * * *',
  $$ SELECT public.flag_expired_profiles(); $$
);