-- 20260914_email_sync_and_notification_routing.sql
-- Automatic synchronization between Supabase auth.users and public.profiles,
-- backfilling existing user accounts, and adding notification_email columns.

-- 1. Add notification_email column to profiles and leases
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_email TEXT;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS notification_email TEXT;

-- 2. Create trigger function to sync auth.users changes to public.profiles
CREATE OR REPLACE FUNCTION public.handle_auth_user_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.created_at, NOW()),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 3. Attach trigger to auth.users for inserts and email updates
DROP TRIGGER IF EXISTS on_auth_user_sync ON auth.users;
CREATE TRIGGER on_auth_user_sync
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_sync();

-- 4. Backfill existing auth users into public.profiles
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT id, email, created_at, NOW()
FROM auth.users
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    updated_at = NOW();
