-- DRAFT 10: transfer a deal (property card) to another existing user.   *** NOT APPLIED. Run by hand after review. ***
--
-- Adds ONE function, public.rpc_transfer_deal_ownership(p_deal_id, p_recipient_email). No table, policy or grant on an
-- existing object changes. Ownership is `user_id = auth.uid()` on every table (RLS), so a transfer is: re-point `user_id`
-- on the deal and on every child row that carries both `deal_id` and `user_id`, in one transaction.
--
-- Rules enforced inside the function (the browser cannot skip them):
--   * caller must be signed in and must be the CURRENT owner (deals.user_id = auth.uid()); collaborators cannot transfer
--   * the recipient is found by email in auth.users (case-insensitive) and must already have an account
--   * not to yourself, and demo deals cannot be transferred
--   * entity_id is cleared (entities belong to the old owner; the new owner re-attaches one of their own)
--   * all deal_shares for the deal are removed (the new owner decides who to share with); the previous owner loses access
-- Rolling back: DROP FUNCTION public.rpc_transfer_deal_ownership(uuid, text);  (data already transferred stays transferred;
-- the new owner can transfer it back with the same function).

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_transfer_deal_ownership(p_deal_id uuid, p_recipient_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller    uuid := auth.uid();
  v_deal      public.deals%ROWTYPE;
  v_recipient uuid;
  v_email     text := lower(btrim(coalesce(p_recipient_email, '')));
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND OR v_deal.user_id IS DISTINCT FROM v_caller THEN
    -- same message for "missing" and "not yours" so ids cannot be probed
    RAISE EXCEPTION 'deal_not_found_or_not_owner' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_deal.is_demo, false) THEN
    RAISE EXCEPTION 'demo_deal' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_recipient FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_recipient IS NULL THEN
    RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_recipient = v_caller THEN
    RAISE EXCEPTION 'cannot_transfer_to_self' USING ERRCODE = '22023';
  END IF;

  UPDATE public.deals SET user_id = v_recipient, entity_id = NULL WHERE id = p_deal_id;

  UPDATE public.units                    SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.leases                   SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.rent_payments            SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.rent_increases           SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.lease_recovery_terms     SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.lease_recovery_items     SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.cam_reconciliations      SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.utility_meters           SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.meter_readings           SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.parcels                  SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.deal_baselines           SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.deal_parameter_history   SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.reconciliation_tokens    SET user_id = v_recipient WHERE deal_id = p_deal_id;
  UPDATE public.app_notifications        SET user_id = v_recipient WHERE deal_id = p_deal_id;

  DELETE FROM public.deal_shares WHERE deal_id = p_deal_id;

  RETURN jsonb_build_object('deal_id', p_deal_id, 'new_owner_id', v_recipient);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_transfer_deal_ownership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_transfer_deal_ownership(uuid, text) TO authenticated;

COMMIT;
