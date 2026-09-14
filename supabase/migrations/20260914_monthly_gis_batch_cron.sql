-- Migration: 20260914_monthly_gis_batch_cron.sql
-- Description: Scheduled Monthly Batch GIS Synchronization via pg_cron and pg_net / batch-sync-gis Edge Function

-- 1. Create Stored Procedure to Trigger batch-sync-gis Edge Function
CREATE OR REPLACE FUNCTION public.trigger_monthly_gis_sync()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_project_url text := 'https://bgexwcepwbxvhxbpblhd.supabase.co';
BEGIN
  -- Attempt to execute via pg_net if extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    -- Trigger the Edge Function asynchronously via HTTP POST
    SELECT net.http_post(
      url := v_project_url || '/functions/v1/batch-sync-gis',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'source', 'pg_cron_monthly_trigger',
        'triggered_at', now()
      )
    ) INTO v_request_id;

    RETURN jsonb_build_object(
      'success', true,
      'net_request_id', v_request_id,
      'triggered_at', now()
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'message', 'pg_net extension not enabled, fallback to client/edge scheduling',
      'triggered_at', now()
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'triggered_at', now()
  );
END;
$$;

-- 2. Grants
GRANT EXECUTE ON FUNCTION public.trigger_monthly_gis_sync() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_monthly_gis_sync() TO service_role;

-- 3. Register pg_cron schedule if pg_cron is enabled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove prior job if already registered
    PERFORM cron.unschedule('monthly-batch-gis-sync')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'monthly-batch-gis-sync'
    );

    -- Schedule at 03:00 UTC on the 1st of every month
    PERFORM cron.schedule(
      'monthly-batch-gis-sync',
      '0 3 1 * *',
      'SELECT public.trigger_monthly_gis_sync()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron registration skipped: %', SQLERRM;
END;
$$;
