-- Saved Compare studio boards (private to their owner).
-- Stores settings only: which deals and scenarios are on the board, which metrics show, matrix or charts. Never computed numbers;
-- the figures are recomputed from the live model every time a board is opened.

CREATE TABLE IF NOT EXISTS public.compare_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compare_views_user_id ON public.compare_views(user_id, updated_at DESC);

GRANT ALL ON TABLE public.compare_views TO authenticated, service_role;

ALTER TABLE public.compare_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own compare_views" ON public.compare_views;
CREATE POLICY "Users can view own compare_views" ON public.compare_views FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own compare_views" ON public.compare_views;
CREATE POLICY "Users can insert own compare_views" ON public.compare_views FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own compare_views" ON public.compare_views;
CREATE POLICY "Users can update own compare_views" ON public.compare_views FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own compare_views" ON public.compare_views;
CREATE POLICY "Users can delete own compare_views" ON public.compare_views FOR DELETE TO authenticated USING (auth.uid() = user_id);
