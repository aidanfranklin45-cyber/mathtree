-- DRAFT 03: give the scheduled jobs a real credential.   *** NOT APPLIED. Follow the rollout order in README.md. ***
--
-- Why: the daily lease monitor and the monthly GIS sync are edge functions with JWT verification off. The daily job
-- authenticated with the public anon key (which ships in every browser), and the monthly job sent nothing, so anyone
-- could trigger a full run: emails to tenants, rent escalations, a county-GIS re-sync of every deal.
-- The functions now require a shared secret in the `x-cron-secret` header and FAIL CLOSED if CRON_SECRET is not set.
-- This file makes the two scheduled jobs send that secret, reading it from Supabase Vault (never stored in SQL text).
--
-- One-time setup (you choose the value; use a long random string, e.g. `openssl rand -hex 32`). The SAME value goes in both:
--   1. Edge function secret:   npx supabase secrets set CRON_SECRET=<value> --project-ref bgexwcepwbxvhxbpblhd
--   2. Vault (run in the SQL editor, do NOT commit the value):
--        select vault.create_secret('<value>', 'cron_secret', 'Shared secret for scheduled edge function calls');
--      (to rotate later: select vault.update_secret((select id from vault.secrets where name='cron_secret'), '<new value>');)

BEGIN;

-- Monthly GIS sync: send the secret instead of nothing.
CREATE OR REPLACE FUNCTION public.trigger_monthly_gis_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id bigint;
  v_project_url text := 'https://bgexwcepwbxvhxbpblhd.supabase.co';
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'cron_secret is not set in Vault', 'triggered_at', now());
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT net.http_post(
      url := v_project_url || '/functions/v1/batch-sync-gis',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('source', 'pg_cron_monthly_trigger', 'triggered_at', now())
    ) INTO v_request_id;

    RETURN jsonb_build_object('success', true, 'net_request_id', v_request_id, 'triggered_at', now());
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'pg_net extension not enabled', 'triggered_at', now());
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'triggered_at', now());
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.trigger_monthly_gis_sync() FROM PUBLIC, anon, authenticated;

-- Daily lease monitor: now carrying the secret instead of the anon key, and moved from 06:00 UTC to 15:00 UTC.
-- (06:00 UTC is 10-11pm Pacific the evening BEFORE, so "rent is due today" reminders arrived a day early for a Yakima
-- portfolio. 15:00 UTC is 7-8am Pacific.)
SELECT cron.unschedule('daily-lease-monitor-job');
SELECT cron.schedule(
  'daily-lease-monitor-job',
  '0 15 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://bgexwcepwbxvhxbpblhd.supabase.co/functions/v1/cron-daily-lease-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    timeout_milliseconds := 30000
  );
  $job$
);

COMMIT;
