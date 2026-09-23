-- 20260923_add_alert_preferences_to_profiles.sql
-- Adds customizable alert timing and scheduling preferences to public.profiles

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS alert_preferences JSONB DEFAULT '{
  "advance_notice_days": 0,
  "remind_on_due": true,
  "followup_grace_period": true,
  "escalation_notice_days": 30
}'::jsonb;

-- Ensure trigger preserves existing alert_preferences if auth user metadata syncs
CREATE OR REPLACE FUNCTION public.handle_auth_user_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, created_at, updated_at, alert_preferences)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.created_at, NOW()),
    NOW(),
    COALESCE(
      (NEW.raw_user_meta_data->>'alert_preferences')::jsonb,
      '{"advance_notice_days": 0, "remind_on_due": true, "followup_grace_period": true, "escalation_notice_days": 30}'::jsonb
    )
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = NOW(),
      alert_preferences = COALESCE(public.profiles.alert_preferences, EXCLUDED.alert_preferences);
  RETURN NEW;
END;
$$;
