-- Migration: 20260927_parameter_history_and_collaboration.sql
-- Description: Parameter History (scenario versioning) and Mutual Collaborator Deal Sharing

-- ============================================================================
-- 1. PARAMETER HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.deal_parameter_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'financing' CHECK (category IN ('financing', 'valuation', 'operations', 'full_scenario')),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_param_history_deal ON public.deal_parameter_history(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_param_history_user ON public.deal_parameter_history(user_id);

ALTER TABLE public.deal_parameter_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. COLLABORATOR CONNECTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.collaborator_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  CONSTRAINT unique_collaborator_connection UNIQUE (requester_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_collab_conn_requester ON public.collaborator_connections(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_conn_recipient ON public.collaborator_connections(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_conn_email ON public.collaborator_connections(recipient_email, status);

ALTER TABLE public.collaborator_connections ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. DEAL SHARES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.deal_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'editor')),
  can_view_scenarios BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_deal_share UNIQUE (deal_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_shares_deal ON public.deal_shares(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_shares_user ON public.deal_shares(shared_with_user_id);

ALTER TABLE public.deal_shares ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. ENFORCE MUTUAL COLLABORATOR ACCEPTANCE TRIGGER ON DEAL_SHARES
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_deal_share_mutual_collaborator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.collaborator_connections
    WHERE status = 'accepted'
      AND (
        (requester_id = NEW.owner_id AND recipient_id = NEW.shared_with_user_id)
        OR
        (requester_id = NEW.shared_with_user_id AND recipient_id = NEW.owner_id)
      )
  ) THEN
    RAISE EXCEPTION 'Cannot share deal: Owner and recipient must have an accepted mutual collaborator connection.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_deal_share_collab ON public.deal_shares;
CREATE TRIGGER trg_check_deal_share_collab
BEFORE INSERT OR UPDATE ON public.deal_shares
FOR EACH ROW
EXECUTE FUNCTION public.check_deal_share_mutual_collaborator();

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- A. Grants
GRANT ALL ON TABLE public.deal_parameter_history TO authenticated;
GRANT ALL ON TABLE public.deal_parameter_history TO service_role;
GRANT ALL ON TABLE public.collaborator_connections TO authenticated;
GRANT ALL ON TABLE public.collaborator_connections TO service_role;
GRANT ALL ON TABLE public.deal_shares TO authenticated;
GRANT ALL ON TABLE public.deal_shares TO service_role;

-- B. deals Table Policy Extension: Allow collaborators to view/edit shared deals
DROP POLICY IF EXISTS "deals_select_collaborator_policy" ON public.deals;
CREATE POLICY "deals_select_collaborator_policy"
ON public.deals
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR is_demo = true
  OR id IN (
    SELECT deal_id FROM public.deal_shares WHERE shared_with_user_id = auth.uid()
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
    WHERE shared_with_user_id = auth.uid() AND permission = 'editor'
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR id IN (
    SELECT deal_id FROM public.deal_shares 
    WHERE shared_with_user_id = auth.uid() AND permission = 'editor'
  )
);

-- C. deal_parameter_history Policies
DROP POLICY IF EXISTS "param_hist_select_policy" ON public.deal_parameter_history;
CREATE POLICY "param_hist_select_policy"
ON public.deal_parameter_history
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR deal_id IN (
    SELECT deal_id FROM public.deal_shares 
    WHERE shared_with_user_id = auth.uid() AND can_view_scenarios = true
  )
);

DROP POLICY IF EXISTS "param_hist_insert_policy" ON public.deal_parameter_history;
CREATE POLICY "param_hist_insert_policy"
ON public.deal_parameter_history
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR deal_id IN (
    SELECT deal_id FROM public.deal_shares 
    WHERE shared_with_user_id = auth.uid() AND permission = 'editor'
  )
);

DROP POLICY IF EXISTS "param_hist_update_policy" ON public.deal_parameter_history;
CREATE POLICY "param_hist_update_policy"
ON public.deal_parameter_history
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "param_hist_delete_policy" ON public.deal_parameter_history;
CREATE POLICY "param_hist_delete_policy"
ON public.deal_parameter_history
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- D. collaborator_connections Policies
DROP POLICY IF EXISTS "collab_conn_select_policy" ON public.collaborator_connections;
CREATE POLICY "collab_conn_select_policy"
ON public.collaborator_connections
FOR SELECT
TO authenticated
USING (
  auth.uid() = requester_id
  OR auth.uid() = recipient_id
  OR LOWER(COALESCE(auth.jwt()->>'email', '')) = LOWER(recipient_email)
);

DROP POLICY IF EXISTS "collab_conn_insert_policy" ON public.collaborator_connections;
CREATE POLICY "collab_conn_insert_policy"
ON public.collaborator_connections
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "collab_conn_update_policy" ON public.collaborator_connections;
CREATE POLICY "collab_conn_update_policy"
ON public.collaborator_connections
FOR UPDATE
TO authenticated
USING (
  auth.uid() = requester_id 
  OR auth.uid() = recipient_id 
  OR LOWER(COALESCE(auth.jwt()->>'email', '')) = LOWER(recipient_email)
)
WITH CHECK (
  auth.uid() = requester_id 
  OR auth.uid() = recipient_id 
  OR LOWER(COALESCE(auth.jwt()->>'email', '')) = LOWER(recipient_email)
);

DROP POLICY IF EXISTS "collab_conn_delete_policy" ON public.collaborator_connections;
CREATE POLICY "collab_conn_delete_policy"
ON public.collaborator_connections
FOR DELETE
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

-- E. deal_shares Policies
DROP POLICY IF EXISTS "deal_shares_select_policy" ON public.deal_shares;
CREATE POLICY "deal_shares_select_policy"
ON public.deal_shares
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id OR auth.uid() = shared_with_user_id);

DROP POLICY IF EXISTS "deal_shares_insert_policy" ON public.deal_shares;
CREATE POLICY "deal_shares_insert_policy"
ON public.deal_shares
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "deal_shares_update_policy" ON public.deal_shares;
CREATE POLICY "deal_shares_update_policy"
ON public.deal_shares
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "deal_shares_delete_policy" ON public.deal_shares;
CREATE POLICY "deal_shares_delete_policy"
ON public.deal_shares
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);


-- ============================================================================
-- 6. RPC: PARAMETER HISTORY OPERATIONS
-- ============================================================================

-- A. Save Parameter Snapshot
CREATE OR REPLACE FUNCTION public.rpc_save_parameter_snapshot(
  p_deal_id UUID,
  p_name TEXT,
  p_category TEXT DEFAULT 'financing',
  p_inputs JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_is_baseline BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deal RECORD;
  v_snapshot_inputs JSONB;
  v_snapshot_metrics JSONB;
  v_new_id UUID;
  v_cat TEXT := LOWER(COALESCE(p_category, 'financing'));
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Verify deal ownership or editor permission
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found.');
  END IF;

  IF v_deal.user_id <> v_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.deal_shares
      WHERE deal_id = p_deal_id AND shared_with_user_id = v_user_id AND permission = 'editor'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions to save scenario snapshot.');
    END IF;
  END IF;

  -- Use passed inputs or deal current inputs
  v_snapshot_inputs := COALESCE(p_inputs, v_deal.inputs, '{}'::jsonb);
  v_snapshot_metrics := COALESCE(v_deal.metrics, '{}'::jsonb);

  -- If this is marked baseline, unset prior baselines for this deal
  IF p_is_baseline THEN
    UPDATE public.deal_parameter_history
    SET is_baseline = false
    WHERE deal_id = p_deal_id;
  END IF;

  INSERT INTO public.deal_parameter_history (
    deal_id,
    user_id,
    name,
    category,
    inputs,
    metrics,
    notes,
    is_baseline
  ) VALUES (
    p_deal_id,
    v_user_id,
    TRIM(p_name),
    v_cat,
    v_snapshot_inputs,
    v_snapshot_metrics,
    p_notes,
    COALESCE(p_is_baseline, false)
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_new_id,
    'name', TRIM(p_name),
    'category', v_cat,
    'message', 'Parameter scenario snapshot saved successfully.'
  );
END;
$$;

-- B. Get Deal Parameter History
CREATE OR REPLACE FUNCTION public.rpc_get_deal_parameter_history(p_deal_id UUID)
RETURNS TABLE (
  id UUID,
  deal_id UUID,
  user_id UUID,
  user_name TEXT,
  name TEXT,
  category TEXT,
  inputs JSONB,
  metrics JSONB,
  notes TEXT,
  is_baseline BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Check access
  IF NOT EXISTS (
    SELECT 1 FROM public.deals WHERE id = p_deal_id AND user_id = v_user_id
    UNION
    SELECT 1 FROM public.deal_shares WHERE deal_id = p_deal_id AND shared_with_user_id = v_user_id AND can_view_scenarios = true
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    h.id,
    h.deal_id,
    h.user_id,
    COALESCE(p.full_name, p.company_name, 'Analyst')::text AS user_name,
    h.name,
    h.category,
    h.inputs,
    h.metrics,
    h.notes,
    h.is_baseline,
    h.created_at,
    h.updated_at
  FROM public.deal_parameter_history h
  LEFT JOIN public.profiles p ON p.id = h.user_id
  WHERE h.deal_id = p_deal_id
  ORDER BY h.is_baseline DESC, h.created_at DESC;
END;
$$;

-- C. Restore Parameter Snapshot to Deal
CREATE OR REPLACE FUNCTION public.rpc_restore_parameter_snapshot(p_history_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hist RECORD;
  v_deal RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT * INTO v_hist FROM public.deal_parameter_history WHERE id = p_history_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parameter snapshot not found.');
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = v_hist.deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Associated deal not found.');
  END IF;

  -- Ensure ownership or editor role
  IF v_deal.user_id <> v_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.deal_shares
      WHERE deal_id = v_deal.id AND shared_with_user_id = v_user_id AND permission = 'editor'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions to restore parameter configuration.');
    END IF;
  END IF;

  -- Overwrite deal inputs with snapshot inputs; trigger will recalculate metrics automatically
  UPDATE public.deals
  SET
    inputs = v_hist.inputs,
    purchase_price = COALESCE((v_hist.inputs->>'purchasePrice')::numeric, purchase_price),
    updated_at = now()
  WHERE id = v_deal.id;

  RETURN jsonb_build_object(
    'success', true,
    'deal_id', v_deal.id,
    'snapshot_id', v_hist.id,
    'name', v_hist.name,
    'message', 'Parameter configuration restored successfully to active deal model.'
  );
END;
$$;

-- D. Delete Parameter Snapshot
CREATE OR REPLACE FUNCTION public.rpc_delete_parameter_snapshot(p_history_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hist RECORD;
  v_deal RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT * INTO v_hist FROM public.deal_parameter_history WHERE id = p_history_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parameter snapshot not found.');
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = v_hist.deal_id;

  -- Only snapshot creator or deal owner can delete
  IF v_hist.user_id <> v_user_id AND v_deal.user_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  DELETE FROM public.deal_parameter_history WHERE id = p_history_id;

  RETURN jsonb_build_object('success', true, 'message', 'Snapshot deleted.');
END;
$$;


-- ============================================================================
-- 7. RPC: MUTUAL COLLABORATOR OPERATIONS
-- ============================================================================

-- A. Invite Collaborator (by email)
CREATE OR REPLACE FUNCTION public.rpc_invite_collaborator(p_recipient_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_clean_email TEXT := LOWER(TRIM(p_recipient_email));
  v_target_user_id UUID;
  v_conn_id UUID;
  v_existing RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF v_clean_email = '' OR v_clean_email IS NULL OR v_clean_email NOT LIKE '%@%.%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid email address required.');
  END IF;

  -- Cannot invite oneself
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id AND LOWER(email) = v_clean_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot invite yourself as a collaborator.');
  END IF;

  -- Look up target user ID if they are already registered in auth.users
  SELECT id INTO v_target_user_id FROM auth.users WHERE LOWER(email) = v_clean_email LIMIT 1;

  -- Check if connection already exists in either direction
  SELECT * INTO v_existing FROM public.collaborator_connections
  WHERE (requester_id = v_user_id AND LOWER(recipient_email) = v_clean_email)
     OR (v_target_user_id IS NOT NULL AND requester_id = v_target_user_id AND recipient_id = v_user_id);

  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      RETURN jsonb_build_object('success', false, 'error', 'You are already connected as accepted collaborators.');
    ELSIF v_existing.status = 'pending' THEN
      -- If the other person invited this user first, automatically accept!
      IF v_existing.requester_id <> v_user_id THEN
        UPDATE public.collaborator_connections
        SET status = 'accepted', recipient_id = v_user_id, accepted_at = now(), updated_at = now()
        WHERE id = v_existing.id;
        RETURN jsonb_build_object('success', true, 'status', 'accepted', 'message', 'Reciprocal invitation accepted! You are now mutual collaborators.');
      ELSE
        RETURN jsonb_build_object('success', false, 'error', 'An invitation is already pending for this email.');
      END IF;
    ELSE
      -- Was declined or revoked; re-activate as pending
      UPDATE public.collaborator_connections
      SET status = 'pending', recipient_id = v_target_user_id, updated_at = now()
      WHERE id = v_existing.id
      RETURNING id INTO v_conn_id;
      RETURN jsonb_build_object('success', true, 'status', 'pending', 'message', 'Collaborator invitation re-sent.');
    END IF;
  END IF;

  -- Create new invitation
  INSERT INTO public.collaborator_connections (
    requester_id,
    recipient_email,
    recipient_id,
    status
  ) VALUES (
    v_user_id,
    v_clean_email,
    v_target_user_id,
    'pending'
  ) RETURNING id INTO v_conn_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_conn_id,
    'status', 'pending',
    'message', 'Invitation sent successfully. Once accepted, you will be able to share deals and parameter histories.'
  );
END;
$$;

-- B. Respond to Collaborator Invitation (accept or decline)
CREATE OR REPLACE FUNCTION public.rpc_respond_collaborator_invite(
  p_invitation_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_conn RECORD;
  v_act TEXT := LOWER(TRIM(p_action));
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_conn FROM public.collaborator_connections WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invitation not found.');
  END IF;

  -- Ensure caller is recipient
  IF v_conn.recipient_id IS NOT NULL AND v_conn.recipient_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the designated recipient of this invitation.');
  END IF;

  IF v_conn.recipient_id IS NULL AND LOWER(v_conn.recipient_email) <> LOWER(v_user_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invitation email mismatch.');
  END IF;

  IF v_act = 'accept' THEN
    UPDATE public.collaborator_connections
    SET
      status = 'accepted',
      recipient_id = v_user_id,
      accepted_at = now(),
      updated_at = now()
    WHERE id = p_invitation_id;

    RETURN jsonb_build_object('success', true, 'status', 'accepted', 'message', 'Collaborator invitation accepted.');
  ELSIF v_act = 'decline' THEN
    UPDATE public.collaborator_connections
    SET
      status = 'declined',
      recipient_id = v_user_id,
      updated_at = now()
    WHERE id = p_invitation_id;

    RETURN jsonb_build_object('success', true, 'status', 'declined', 'message', 'Collaborator invitation declined.');
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action. Must be accept or decline.');
  END IF;
END;
$$;

-- C. Get User Collaborators Hub Payload
CREATE OR REPLACE FUNCTION public.rpc_get_user_collaborators()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_active JSONB;
  v_incoming JSONB;
  v_outgoing JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'active', '[]'::jsonb,
      'incoming', '[]'::jsonb,
      'outgoing', '[]'::jsonb
    );
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- 1. Active Accepted Mutual Collaborators
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'connection_id', c.id,
        'collaborator_id', peer.id,
        'email', peer.email,
        'full_name', COALESCE(p.full_name, 'Real Estate Partner'),
        'company_name', COALESCE(p.company_name, 'Investment Group'),
        'shared_deals_count', (
          SELECT COUNT(*) FROM public.deal_shares ds
          WHERE (ds.owner_id = v_user_id AND ds.shared_with_user_id = peer.id)
             OR (ds.owner_id = peer.id AND ds.shared_with_user_id = v_user_id)
        ),
        'connected_at', c.accepted_at
      ) ORDER BY COALESCE(p.full_name, peer.email) ASC
    ),
    '[]'::jsonb
  ) INTO v_active
  FROM public.collaborator_connections c
  CROSS JOIN LATERAL (
    SELECT 
      CASE WHEN c.requester_id = v_user_id THEN c.recipient_id ELSE c.requester_id END AS id,
      CASE WHEN c.requester_id = v_user_id THEN c.recipient_email ELSE (SELECT email FROM auth.users WHERE id = c.requester_id) END AS email
  ) peer
  LEFT JOIN public.profiles p ON p.id = peer.id
  WHERE c.status = 'accepted'
    AND (c.requester_id = v_user_id OR c.recipient_id = v_user_id OR LOWER(c.recipient_email) = LOWER(v_user_email));

  -- 2. Incoming Pending Invitations (awaiting caller response)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'invitation_id', c.id,
        'requester_id', c.requester_id,
        'requester_email', req.email,
        'requester_name', COALESCE(p.full_name, req.email),
        'requester_company', COALESCE(p.company_name, 'Capital Sponsor'),
        'sent_at', c.created_at
      ) ORDER BY c.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_incoming
  FROM public.collaborator_connections c
  JOIN auth.users req ON req.id = c.requester_id
  LEFT JOIN public.profiles p ON p.id = c.requester_id
  WHERE c.status = 'pending'
    AND c.requester_id <> v_user_id
    AND (c.recipient_id = v_user_id OR LOWER(c.recipient_email) = LOWER(v_user_email));

  -- 3. Outgoing Pending Invitations (sent by caller)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'invitation_id', c.id,
        'recipient_email', c.recipient_email,
        'sent_at', c.created_at,
        'status', c.status
      ) ORDER BY c.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_outgoing
  FROM public.collaborator_connections c
  WHERE c.status = 'pending'
    AND c.requester_id = v_user_id;

  RETURN jsonb_build_object(
    'active', v_active,
    'incoming', v_incoming,
    'outgoing', v_outgoing
  );
END;
$$;

-- D. Share Deal with Collaborator
CREATE OR REPLACE FUNCTION public.rpc_share_deal_with_collaborator(
  p_deal_id UUID,
  p_collaborator_id UUID,
  p_permission TEXT DEFAULT 'viewer',
  p_can_view_scenarios BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deal RECORD;
  v_perm TEXT := LOWER(COALESCE(p_permission, 'viewer'));
  v_share_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF v_perm NOT IN ('viewer', 'editor') THEN
    v_perm := 'viewer';
  END IF;

  -- Ensure deal exists and caller is owner
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found.');
  END IF;

  IF v_deal.user_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the deal owner can grant collaborator access.');
  END IF;

  IF p_collaborator_id = v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot share deal with yourself.');
  END IF;

  -- Verify mutual accepted collaborator relationship
  IF NOT EXISTS (
    SELECT 1 FROM public.collaborator_connections
    WHERE status = 'accepted'
      AND (
        (requester_id = v_user_id AND recipient_id = p_collaborator_id)
        OR
        (requester_id = p_collaborator_id AND recipient_id = v_user_id)
      )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Users must be mutual accepted collaborators before sharing deals.');
  END IF;

  INSERT INTO public.deal_shares (
    deal_id,
    owner_id,
    shared_with_user_id,
    permission,
    can_view_scenarios,
    updated_at
  ) VALUES (
    p_deal_id,
    v_user_id,
    p_collaborator_id,
    v_perm,
    COALESCE(p_can_view_scenarios, true),
    now()
  )
  ON CONFLICT (deal_id, shared_with_user_id)
  DO UPDATE SET
    permission = EXCLUDED.permission,
    can_view_scenarios = EXCLUDED.can_view_scenarios,
    updated_at = now()
  RETURNING id INTO v_share_id;

  RETURN jsonb_build_object(
    'success', true,
    'share_id', v_share_id,
    'deal_id', p_deal_id,
    'collaborator_id', p_collaborator_id,
    'permission', v_perm,
    'message', 'Deal shared successfully with collaborator.'
  );
END;
$$;

-- E. Revoke Deal Share
CREATE OR REPLACE FUNCTION public.rpc_revoke_deal_share(
  p_deal_id UUID,
  p_collaborator_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deal RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found.');
  END IF;

  -- Allow deal owner OR the shared collaborator (to un-share themselves)
  IF v_deal.user_id <> v_user_id AND p_collaborator_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  DELETE FROM public.deal_shares
  WHERE deal_id = p_deal_id AND shared_with_user_id = p_collaborator_id;

  RETURN jsonb_build_object('success', true, 'message', 'Deal access revoked.');
END;
$$;

-- F. Get Deal Shares
CREATE OR REPLACE FUNCTION public.rpc_get_deal_shares(p_deal_id UUID)
RETURNS TABLE (
  share_id UUID,
  collaborator_id UUID,
  collaborator_name TEXT,
  collaborator_email TEXT,
  collaborator_company TEXT,
  permission TEXT,
  can_view_scenarios BOOLEAN,
  shared_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Only deal owner or users with share access can query
  IF NOT EXISTS (
    SELECT 1 FROM public.deals WHERE id = p_deal_id AND user_id = v_user_id
    UNION
    SELECT 1 FROM public.deal_shares WHERE deal_id = p_deal_id AND shared_with_user_id = v_user_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ds.id AS share_id,
    ds.shared_with_user_id AS collaborator_id,
    COALESCE(p.full_name, u.email)::text AS collaborator_name,
    u.email::text AS collaborator_email,
    COALESCE(p.company_name, 'Partner')::text AS collaborator_company,
    ds.permission,
    ds.can_view_scenarios,
    ds.created_at AS shared_at
  FROM public.deal_shares ds
  JOIN auth.users u ON u.id = ds.shared_with_user_id
  LEFT JOIN public.profiles p ON p.id = ds.shared_with_user_id
  WHERE ds.deal_id = p_deal_id
  ORDER BY ds.created_at DESC;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.rpc_save_parameter_snapshot TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_deal_parameter_history TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_restore_parameter_snapshot TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_delete_parameter_snapshot TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_invite_collaborator TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_respond_collaborator_invite TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_user_collaborators TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_share_deal_with_collaborator TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_deal_share TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_deal_shares TO authenticated, service_role;
