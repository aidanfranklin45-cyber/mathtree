-- MathTree Strict Multi-Tenant Security Migration
-- Restricts deals, portfolios, and profiles tables exclusively to authenticated users.
-- Revokes all public / anon access.

-- 1. Revoke all permissions on deals, portfolios, profiles from anon role
REVOKE ALL ON TABLE public.deals FROM anon;
REVOKE ALL ON TABLE public.portfolios FROM anon;
REVOKE ALL ON TABLE public.profiles FROM anon;

-- 2. Grant table permissions strictly to authenticated users and service_role
GRANT ALL ON TABLE public.deals TO authenticated;
GRANT ALL ON TABLE public.portfolios TO authenticated;
GRANT ALL ON TABLE public.profiles TO authenticated;

GRANT ALL ON TABLE public.deals TO service_role;
GRANT ALL ON TABLE public.portfolios TO service_role;
GRANT ALL ON TABLE public.profiles TO service_role;

-- 3. Enforce Row Level Security (RLS) on all tables
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Recreate strict RLS policies on public.deals (TO authenticated only)
DROP POLICY IF EXISTS "Users can view own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can insert own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can update own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can delete own deals" ON public.deals;

CREATE POLICY "Users can view own deals" ON public.deals
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own deals" ON public.deals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own deals" ON public.deals
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own deals" ON public.deals
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 5. Recreate strict RLS policies on public.portfolios (TO authenticated only)
DROP POLICY IF EXISTS "Users can view own portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Users can insert own portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Users can update own portfolios" ON public.portfolios;
DROP POLICY IF EXISTS "Users can delete own portfolios" ON public.portfolios;

CREATE POLICY "Users can view own portfolios" ON public.portfolios
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolios" ON public.portfolios
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portfolios" ON public.portfolios
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own portfolios" ON public.portfolios
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 6. Recreate strict RLS policies on public.profiles (TO authenticated only)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
