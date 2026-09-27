-- =========================================================================
-- MATH TREE: Deprecate Collaborator Connections & Introduce Collaborator Groups
-- Migration: 20260927_deprecate_connections_and_add_groups.sql
-- =========================================================================

-- 1. Drop the legacy trigger and function that enforced mutual collaborator_connections
DROP TRIGGER IF EXISTS trg_check_deal_share_collab ON public.deal_shares;
DROP FUNCTION IF EXISTS public.check_deal_share_collab_allowed();

-- 2. Deprecate collaborator_connections table
DROP TABLE IF EXISTS public.collaborator_connections CASCADE;

-- 3. Create Collaborator Groups (User-owned, fully named and editable)
CREATE TABLE IF NOT EXISTS public.collaborator_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Create Collaborator Group Members
CREATE TABLE IF NOT EXISTS public.collaborator_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.collaborator_groups(id) ON DELETE CASCADE NOT NULL,
  member_email text NOT NULL,
  member_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, member_email)
);

-- 5. Update Deal Shares to support direct user, direct email, or group sharing
ALTER TABLE public.deal_shares 
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.collaborator_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS shared_with_email text;

-- Make shared_with_user_id nullable so deals can be shared by email even before account creation
ALTER TABLE public.deal_shares ALTER COLUMN shared_with_user_id DROP NOT NULL;

-- 6. Add scenario diff metadata and auto_run tracking to deal_parameter_history
ALTER TABLE public.deal_parameter_history
  ADD COLUMN IF NOT EXISTS input_diff jsonb,
  ADD COLUMN IF NOT EXISTS metric_diff jsonb,
  ADD COLUMN IF NOT EXISTS is_auto_run boolean DEFAULT false;

-- 7. Row Level Security for Collaborator Groups & Members
ALTER TABLE public.collaborator_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own collaborator groups" ON public.collaborator_groups;
CREATE POLICY "Users manage their own collaborator groups"
  ON public.collaborator_groups
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage their group members" ON public.collaborator_group_members;
CREATE POLICY "Users manage their group members"
  ON public.collaborator_group_members
  FOR ALL
  TO authenticated
  USING (
    group_id IN (SELECT id FROM public.collaborator_groups WHERE user_id = auth.uid())
  )
  WITH CHECK (
    group_id IN (SELECT id FROM public.collaborator_groups WHERE user_id = auth.uid())
  );

-- 8. Update Deal Shares RLS Policy using owner_id
DROP POLICY IF EXISTS "deal_shares_select_policy" ON public.deal_shares;
CREATE POLICY "deal_shares_select_policy"
  ON public.deal_shares
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR shared_with_user_id = auth.uid()
    OR (shared_with_email IS NOT NULL AND LOWER(shared_with_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
    OR group_id IN (
      SELECT gm.group_id FROM public.collaborator_group_members gm
      WHERE gm.member_user_id = auth.uid() 
         OR (gm.member_email IS NOT NULL AND LOWER(gm.member_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
    )
  );

DROP POLICY IF EXISTS "deal_shares_manage_policy" ON public.deal_shares;
CREATE POLICY "deal_shares_manage_policy"
  ON public.deal_shares
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 9. Update Deals RLS for Collaborators & Group Members
DROP POLICY IF EXISTS "Users and collaborators can view deals" ON public.deals;
CREATE POLICY "Users and collaborators can view deals"
  ON public.deals
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR is_demo = true
    OR id IN (
      SELECT deal_id FROM public.deal_shares
      WHERE shared_with_user_id = auth.uid()
         OR (shared_with_email IS NOT NULL AND LOWER(shared_with_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
         OR group_id IN (
           SELECT gm.group_id FROM public.collaborator_group_members gm
           WHERE gm.member_user_id = auth.uid() 
              OR (gm.member_email IS NOT NULL AND LOWER(gm.member_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
         )
    )
  );

DROP POLICY IF EXISTS "deals_update_collaborator_policy" ON public.deals;
CREATE POLICY "deals_update_collaborator_policy"
  ON public.deals
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR id IN (
      SELECT deal_id FROM public.deal_shares
      WHERE permission = 'editor'
        AND (
          shared_with_user_id = auth.uid()
          OR (shared_with_email IS NOT NULL AND LOWER(shared_with_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
          OR group_id IN (
            SELECT gm.group_id FROM public.collaborator_group_members gm
            WHERE gm.member_user_id = auth.uid() 
               OR (gm.member_email IS NOT NULL AND LOWER(gm.member_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
          )
        )
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR id IN (
      SELECT deal_id FROM public.deal_shares
      WHERE permission = 'editor'
        AND (
          shared_with_user_id = auth.uid()
          OR (shared_with_email IS NOT NULL AND LOWER(shared_with_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
          OR group_id IN (
            SELECT gm.group_id FROM public.collaborator_group_members gm
            WHERE gm.member_user_id = auth.uid() 
               OR (gm.member_email IS NOT NULL AND LOWER(gm.member_email) = LOWER(COALESCE(auth.jwt() ->> 'email', '')))
          )
        )
    )
  );

-- Grants
GRANT ALL ON public.collaborator_groups TO authenticated;
GRANT ALL ON public.collaborator_group_members TO authenticated;
GRANT ALL ON public.deal_shares TO authenticated;
GRANT ALL ON public.deal_parameter_history TO authenticated;
