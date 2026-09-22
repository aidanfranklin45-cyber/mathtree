-- Migration: 20260923_fix_cron_auth_and_timeout.sql
-- Fix: Reschedule daily-lease-monitor-job with Authorization header and 30s timeout.
-- Previously: no auth header (likely 401) + 5s pg_net timeout (killed every run).

-- Unschedule broken job
SELECT cron.unschedule('daily-lease-monitor-job');

-- Re-register with correct headers and timeout
SELECT cron.schedule(
  'daily-lease-monitor-job',
  '0 6 * * *',
  $$SELECT net.http_post(
      url := 'https://bgexwcepwbxvhxbpblhd.supabase.co/functions/v1/cron-daily-lease-monitor',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnZXh3Y2Vwd2J4dmh4YnBibGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMTI0NTUsImV4cCI6MjEwMzg4ODQ1NX0._izBzyCJgxsH4ncZ9gaX2KonJsGj5_3v_7R5I9Jxa-U"}'::jsonb,
      timeout_milliseconds := 30000
  );$$
);
