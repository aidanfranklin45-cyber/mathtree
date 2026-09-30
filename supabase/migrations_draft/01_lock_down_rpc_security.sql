-- DRAFT 01: lock down SECURITY DEFINER functions.   *** NOT APPLIED. Review with the owner first. ***
--
-- Why: functions marked SECURITY DEFINER run with the owner's rights and bypass row-level security. Every one of them is
-- currently executable by the public `anon` role (the anon key ships in the browser), so anyone on the internet can call
-- them through /rest/v1/rpc/<name>. Four of them never check who is calling:
--   rpc_sync_proforma_to_actuals(deal, rent)      -> anyone can overwrite ANY deal's rent
--   schedule_advance_rent_increase(lease, ...)    -> anyone can schedule a rent increase on ANY lease
--   rpc_evaluate_deal_notifications(user_id)      -> anyone can read/create ANY user's notifications
--   rpc_get_portfolio_operations_summary(user_id) -> anyone can read ANY user's operations summary
-- One more is an obsolete DB-side calculator that also skips every check:
--   rpc_recalculate_deal  (dropped)
-- And rpc_capture_deal_baseline (freezes the pro-forma when a deal becomes Owned) has no caller check and copies stored,
-- DB-computed numbers. It is dropped: baselines are now captured by the app with the shared engine (see 3e).
--
-- What the app really uses (verified by searching src/ and supabase/functions/):
--   React app:   rpc_sync_proforma_to_actuals, rpc_evaluate_deal_notifications,
--                confirm_rent_payment_by_token / snooze_rent_payment_by_token / undo_rent_reconciliation (public by design)
--   Edge fn:     execute_scheduled_rent_escalations (cron, service role)
-- Everything else in the list below is not called by the current app.

BEGIN;

---------------------------------------------------------------------------------------------------------------------
-- 1. Functions that only triggers / cron / the service role call: nobody on the API needs EXECUTE.
--    (A trigger function needs EXECUTE only when the trigger is created, so this cannot stop existing triggers.)
---------------------------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.check_deal_share_mutual_collaborator()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_lease_to_deal()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_sync()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_from_primary_entity()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_on_entity_rename()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_scheduled_rent_escalations()     FROM PUBLIC, anon, authenticated;  -- edge fn uses service_role
REVOKE EXECUTE ON FUNCTION public.trigger_monthly_gis_sync()               FROM PUBLIC, anon, authenticated;  -- pg_cron runs as postgres

---------------------------------------------------------------------------------------------------------------------
-- 2. Email-link functions: intentionally callable without signing in (the one-time token is the credential).
--    Keep anon access. (confirm/snooze are rewritten in 3f; undo only needs its search_path pinned here.)
---------------------------------------------------------------------------------------------------------------------
ALTER FUNCTION public.undo_rent_reconciliation(text)            SET search_path = public;

---------------------------------------------------------------------------------------------------------------------
-- 3. The four functions with no caller check: rewrite so they only ever act for the signed-in user.
---------------------------------------------------------------------------------------------------------------------

-- 3a. Sync pro-forma rent to the actual rent roll: owner or an editor the deal was shared with.
CREATE OR REPLACE FUNCTION public.rpc_sync_proforma_to_actuals(p_deal_id uuid, p_actual_monthly_rent numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_deal RECORD;
  v_updated_inputs JSONB;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Deal not found');
  END IF;

  IF v_deal.user_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.deal_shares s
    WHERE s.deal_id = p_deal_id AND s.shared_with_user_id = v_uid AND s.permission = 'editor'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized for this deal');
  END IF;

  IF p_actual_monthly_rent IS NULL OR p_actual_monthly_rent < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid rent amount');
  END IF;

  v_updated_inputs := COALESCE(v_deal.inputs, '{}'::jsonb);
  v_updated_inputs := jsonb_set(v_updated_inputs, '{grossRentPerMonth}', to_jsonb(p_actual_monthly_rent));
  v_updated_inputs := jsonb_set(v_updated_inputs, '{grossRentAnnual}', to_jsonb(p_actual_monthly_rent * 12.0));
  IF v_updated_inputs ? 'monthlyRent' THEN
    v_updated_inputs := jsonb_set(v_updated_inputs, '{monthlyRent}', to_jsonb(p_actual_monthly_rent));
  END IF;

  UPDATE public.deals SET inputs = v_updated_inputs, updated_at = NOW() WHERE id = p_deal_id;

  UPDATE public.app_notifications
  SET is_dismissed = true, is_read = true, updated_at = NOW()
  WHERE deal_id = p_deal_id AND type = 'revenue_variance';

  RETURN jsonb_build_object(
    'success', true,
    'deal_id', p_deal_id,
    'new_monthly_rent', p_actual_monthly_rent,
    'new_annual_rent', p_actual_monthly_rent * 12.0,
    'message', 'Pro-forma successfully synchronized with actual operational revenue.'
  );
END;
$function$;

-- 3b. Schedule a future rent increase: only for leases on the caller's own deals.
CREATE OR REPLACE FUNCTION public.schedule_advance_rent_increase(
  p_lease_id uuid, p_effective_date date, p_new_rent numeric DEFAULT NULL::numeric,
  p_reason text DEFAULT 'Advance scheduled rent adjustment'::text, p_increase_type text DEFAULT 'percentage'::text,
  p_scheduled_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_lease RECORD;
  v_increase RECORD;
  v_computed_new_rent NUMERIC;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT l.* INTO v_lease FROM public.leases l
  JOIN public.deals d ON d.id = l.deal_id
  WHERE l.id = p_lease_id AND (d.user_id = v_uid OR l.user_id = v_uid)
  FOR UPDATE OF l;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lease not found.');
  END IF;

  v_computed_new_rent := p_new_rent;
  IF v_computed_new_rent IS NULL AND p_scheduled_amount IS NOT NULL THEN
    IF p_increase_type = 'percentage' THEN
      v_computed_new_rent := ROUND(v_lease.monthly_rent * (1 + (p_scheduled_amount / 100.0)), 2);
    ELSIF p_increase_type = 'fixed_step' THEN
      v_computed_new_rent := v_lease.monthly_rent + p_scheduled_amount;
    ELSIF p_increase_type = 'cpi' THEN
      v_computed_new_rent := ROUND(v_lease.monthly_rent * (1 + (p_scheduled_amount / 100.0)), 2);
    END IF;
  END IF;

  INSERT INTO public.rent_increases (
    user_id, lease_id, deal_id, effective_date, old_rent, new_rent, increase_type, scheduled_amount,
    is_applied, reason, notice_sent_date
  ) VALUES (
    v_lease.user_id, v_lease.id, v_lease.deal_id, p_effective_date, v_lease.monthly_rent, v_computed_new_rent,
    COALESCE(p_increase_type, 'percentage'),
    COALESCE(p_scheduled_amount,
      CASE WHEN v_computed_new_rent IS NOT NULL AND v_lease.monthly_rent > 0
           THEN ROUND(((v_computed_new_rent - v_lease.monthly_rent) / v_lease.monthly_rent) * 100, 2) END),
    false, p_reason, CURRENT_DATE
  ) RETURNING * INTO v_increase;

  UPDATE public.leases SET next_escalation_date = p_effective_date, updated_at = now() WHERE id = p_lease_id;

  RETURN jsonb_build_object(
    'success', true, 'increase_id', v_increase.id, 'lease_id', p_lease_id, 'effective_date', p_effective_date,
    'increase_type', v_increase.increase_type, 'scheduled_amount', v_increase.scheduled_amount,
    'old_rent', v_lease.monthly_rent, 'new_rent', v_computed_new_rent, 'is_applied', false
  );
END;
$function$;

-- 3c. Notifications: always the caller's own. The p_user_id parameter is kept so the current client keeps working,
--     but it must equal the caller (otherwise nothing is returned). Also no longer captures a stored-metrics baseline.
--     (Body identical to the current function except: caller check, search_path, and the baseline PERFORM removed.)
CREATE OR REPLACE FUNCTION public.rpc_evaluate_deal_notifications(p_user_id uuid)
 RETURNS TABLE(notification_id uuid, target_deal_id uuid, notif_type text, severity text, title text, message text, action_type text, action_payload jsonb, is_read boolean, is_dismissed boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_deal RECORD;
  v_active_leases_count INT;
  v_active_rent_total NUMERIC;
  v_projected_rent_monthly NUMERIC;
  v_variance_usd NUMERIC;
  v_variance_pct NUMERIC;
  v_lease RECORD;
BEGIN
  -- Only ever act for the signed-in caller; a different p_user_id yields an empty result.
  IF v_uid IS NULL OR p_user_id IS DISTINCT FROM v_uid THEN
    RETURN;
  END IF;

  FOR v_deal IN SELECT * FROM public.deals WHERE user_id = v_uid LOOP
    SELECT COUNT(*), COALESCE(SUM(l.monthly_rent), 0)
    INTO v_active_leases_count, v_active_rent_total
    FROM public.leases l
    WHERE l.deal_id = v_deal.id AND l.is_active = true;

    -- RULE A: Owned deal without active tenant
    IF v_deal.status = 'owned' AND v_active_leases_count = 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.app_notifications n
        WHERE n.user_id = v_uid AND n.deal_id = v_deal.id AND n.type = 'missing_lease' AND n.is_dismissed = false
      ) THEN
        INSERT INTO public.app_notifications (user_id, deal_id, type, severity, title, message, action_type, action_payload)
        VALUES (
          v_uid, v_deal.id, 'missing_lease', 'critical',
          'Missing Tenant of Record · ' || v_deal.title,
          'This property is marked as Owned, but has no active tenant registered. Add your tenant to enable automated rent tracking and real-time equity forecasting.',
          'open_lease_modal', jsonb_build_object('deal_id', v_deal.id, 'deal_title', v_deal.title)
        );
      END IF;
    ELSE
      UPDATE public.app_notifications an
      SET is_dismissed = true, is_read = true, updated_at = NOW()
      WHERE an.user_id = v_uid AND an.deal_id = v_deal.id AND an.type = 'missing_lease' AND an.is_dismissed = false;
    END IF;

    -- RULE B: Owned deal without LLC entity assignment
    IF v_deal.status = 'owned' AND v_deal.entity_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.app_notifications n
        WHERE n.user_id = v_uid AND n.deal_id = v_deal.id AND n.type = 'entity_missing' AND n.is_dismissed = false
      ) THEN
        INSERT INTO public.app_notifications (user_id, deal_id, type, severity, title, message, action_type, action_payload)
        VALUES (
          v_uid, v_deal.id, 'entity_missing', 'info',
          'Assign Entity LLC · ' || v_deal.title,
          'Link this asset to an LLC holding entity to isolate operational liability and track separate banking transactions.',
          'open_entity_modal', jsonb_build_object('deal_id', v_deal.id, 'deal_title', v_deal.title)
        );
      END IF;
    ELSE
      UPDATE public.app_notifications an
      SET is_dismissed = true, is_read = true, updated_at = NOW()
      WHERE an.user_id = v_uid AND an.deal_id = v_deal.id AND an.type = 'entity_missing' AND an.is_dismissed = false;
    END IF;

    -- RULE C: Revenue variance (reported operations vs pro-forma)
    IF v_active_leases_count > 0 THEN
      v_projected_rent_monthly := COALESCE(
        NULLIF(NULLIF(v_deal.inputs->>'grossRentAnnual', '')::numeric, 0) / 12.0,
        NULLIF(v_deal.inputs->>'grossRentPerMonth', '')::numeric,
        NULLIF(v_deal.inputs->>'monthlyRent', '')::numeric,
        0
      );

      IF v_projected_rent_monthly > 0 THEN
        v_variance_usd := v_active_rent_total - v_projected_rent_monthly;
        v_variance_pct := ROUND(((v_variance_usd / v_projected_rent_monthly) * 100.0), 1);

        IF ABS(v_variance_pct) >= 5.0 OR ABS(v_variance_usd) >= 150.0 THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.app_notifications n
            WHERE n.user_id = v_uid AND n.deal_id = v_deal.id AND n.type = 'revenue_variance' AND n.is_dismissed = false
          ) THEN
            INSERT INTO public.app_notifications (user_id, deal_id, type, severity, title, message, action_type, action_payload)
            VALUES (
              v_uid, v_deal.id, 'revenue_variance', 'warning',
              'Revenue Variance Detected · ' || v_deal.title,
              'Actual monthly rent roll ($' || TO_CHAR(v_active_rent_total, 'FM999,999,999') || '/mo) differs from your prospective pro-forma ($' || TO_CHAR(v_projected_rent_monthly, 'FM999,999,999') || '/mo) by ' || (CASE WHEN v_variance_pct > 0 THEN '+' ELSE '' END) || v_variance_pct || '%. Confirm to synchronize your pro-forma model to this real revenue.',
              'sync_proforma_income',
              jsonb_build_object(
                'deal_id', v_deal.id, 'deal_title', v_deal.title,
                'actual_monthly_rent', v_active_rent_total, 'projected_monthly_rent', v_projected_rent_monthly,
                'variance_pct', v_variance_pct
              )
            );
          END IF;
        ELSE
          UPDATE public.app_notifications an
          SET is_dismissed = true, is_read = true, updated_at = NOW()
          WHERE an.user_id = v_uid AND an.deal_id = v_deal.id AND an.type = 'revenue_variance' AND an.is_dismissed = false;
        END IF;
      END IF;
    ELSE
      UPDATE public.app_notifications an
      SET is_dismissed = true, is_read = true, updated_at = NOW()
      WHERE an.user_id = v_uid AND an.deal_id = v_deal.id AND an.type = 'revenue_variance' AND an.is_dismissed = false;
    END IF;

    -- RULE D: Incomplete lease terms (missing start date)
    FOR v_lease IN SELECT * FROM public.leases l WHERE l.deal_id = v_deal.id AND l.is_active = true LOOP
      IF v_lease.lease_start_date IS NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.app_notifications n
          WHERE n.user_id = v_uid AND n.deal_id = v_deal.id AND n.type = 'missing_terms' AND n.is_dismissed = false
        ) THEN
          INSERT INTO public.app_notifications (user_id, deal_id, type, severity, title, message, action_type, action_payload)
          VALUES (
            v_uid, v_deal.id, 'missing_terms', 'warning',
            'Missing Lease Start Date · ' || v_lease.tenant_name,
            'The active lease for ' || v_lease.tenant_name || ' is missing a commencement date. Fill in the date to automate escalation schedules and rent notifications.',
            'open_lease_modal', jsonb_build_object('deal_id', v_deal.id, 'lease_id', v_lease.id)
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY
  SELECT an.id, an.deal_id, an.type, an.severity, an.title, an.message, an.action_type, an.action_payload,
         an.is_read, an.is_dismissed, an.created_at
  FROM public.app_notifications an
  WHERE an.user_id = v_uid
    AND an.is_dismissed = false
    AND (an.snoozed_until IS NULL OR an.snoozed_until <= NOW())
  ORDER BY CASE an.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, an.created_at DESC;
END;
$function$;

-- 3d. Operations summary: ignore any other user's id.
--     Sketch: in rpc_get_portfolio_operations_summary replace
--         v_effective_user_id UUID := p_user_id;   with   v_effective_user_id UUID := auth.uid();
--     and delete the "IF v_effective_user_id IS NULL THEN ... END IF" block.  (Not called by the current React app;
--     alternative is to drop it, see section 5.)

---------------------------------------------------------------------------------------------------------------------
-- 3e. Baselines = "what we expected when we bought it". deal_baselines is a dated, frozen record of the pro-forma at
--     acquisition (inputs + the projected numbers) so actual performance can be compared with the original expectation.
--     Unlike everything else it is deliberately NOT recomputed: re-running a newer engine would quietly rewrite history.
--     * The SQL capture function is dropped (DB math, no caller check). The app captures baselines with the shared
--       engine and inserts them itself; the existing owner-only row policy already allows that.
--     * Append-only: once written, a baseline's snapshot columns cannot be edited (delete + recapture is the only way
--       to re-baseline, and that is an explicit owner action).
---------------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_capture_deal_baseline(uuid);

CREATE OR REPLACE FUNCTION public.fn_deal_baselines_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  IF NEW.inputs_snapshot IS DISTINCT FROM OLD.inputs_snapshot
     OR NEW.metrics_snapshot IS DISTINCT FROM OLD.metrics_snapshot
     OR NEW.projected_gross_rent_annual IS DISTINCT FROM OLD.projected_gross_rent_annual
     OR NEW.projected_noi IS DISTINCT FROM OLD.projected_noi
     OR NEW.projected_cash_flow IS DISTINCT FROM OLD.projected_cash_flow
     OR NEW.projected_irr IS DISTINCT FROM OLD.projected_irr
     OR NEW.projected_cash_on_cash IS DISTINCT FROM OLD.projected_cash_on_cash
     OR NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'A deal baseline is a frozen record and cannot be edited; delete it to re-baseline.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_deal_baselines_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_deal_baselines_immutable ON public.deal_baselines;
CREATE TRIGGER trg_deal_baselines_immutable
  BEFORE UPDATE ON public.deal_baselines
  FOR EACH ROW EXECUTE FUNCTION public.fn_deal_baselines_immutable();

---------------------------------------------------------------------------------------------------------------------
-- 3f. Email-link functions: keep them public (the one-time token is the credential) but tighten them.
--     Reviewed 2026-09-30. Already good: each token is single-purpose (confirm / snooze / undo), expires (30 days for
--     confirm/snooze, 48 h for undo), is single-use (used_at, row locked FOR UPDATE), and can only touch the ONE lease and
--     month it was issued for. Confirm/snooze tokens are 192-bit random values generated by the cron edge function.
--     Fixes here:
--       * the undo token was md5(random() || clock) which is guessable -> 256-bit gen_random_bytes
--       * nobody but the service role needs the token table: drop the excess table privileges from client roles
--     Bodies are unchanged except for the undo-token line.
---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_rent_payment_by_token(p_token text, p_payment_method text DEFAULT '1-Click Direct'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tok RECORD;
  v_lease RECORD;
  v_deal RECORD;
  v_payment RECORD;
  v_undo_token text;
BEGIN
  SELECT * INTO v_tok FROM public.reconciliation_tokens
  WHERE token_hash = p_token AND action = 'confirm' AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired reconciliation link.');
  END IF;
  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This payment has already been reconciled.');
  END IF;

  SELECT * INTO v_lease FROM public.leases WHERE id = v_tok.lease_id;
  SELECT * INTO v_deal FROM public.deals WHERE id = v_tok.deal_id;

  INSERT INTO public.rent_payments (
    user_id, lease_id, deal_id, period_month, due_date, amount_due, amount_paid, paid_date, status, payment_method, reference_note
  ) VALUES (
    v_lease.user_id, v_lease.id, v_lease.deal_id, v_tok.period_month,
    (v_tok.period_month + (COALESCE(v_lease.payment_due_day, 1) - 1)),
    v_lease.monthly_rent, v_lease.monthly_rent, CURRENT_DATE, 'paid', p_payment_method,
    'Reconciled via 1-Click Email Confirmation'
  )
  ON CONFLICT (lease_id, period_month) DO UPDATE SET
    amount_paid = EXCLUDED.amount_due, paid_date = CURRENT_DATE, status = 'paid',
    payment_method = EXCLUDED.payment_method, reference_note = EXCLUDED.reference_note,
    snooze_until = NULL, updated_at = now()
  RETURNING * INTO v_payment;

  UPDATE public.reconciliation_tokens SET used_at = now() WHERE id = v_tok.id;

  v_undo_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.reconciliation_tokens (lease_id, deal_id, user_id, period_month, action, token_hash, expires_at)
  VALUES (v_lease.id, v_deal.id, v_lease.user_id, v_tok.period_month, 'undo', v_undo_token, now() + INTERVAL '48 hours');

  RETURN jsonb_build_object(
    'success', true, 'action', 'confirmed', 'tenant_name', v_lease.tenant_name, 'deal_title', v_deal.title,
    'amount_paid', v_payment.amount_paid, 'period_month', v_payment.period_month, 'paid_date', v_payment.paid_date,
    'undo_token', v_undo_token
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.snooze_rent_payment_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tok RECORD;
  v_lease RECORD;
  v_deal RECORD;
  v_grace_days integer;
  v_snooze_date date;
  v_undo_token text;
BEGIN
  SELECT * INTO v_tok FROM public.reconciliation_tokens
  WHERE token_hash = p_token AND action = 'snooze' AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired snooze link.');
  END IF;
  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This alert has already been snoozed.');
  END IF;

  SELECT * INTO v_lease FROM public.leases WHERE id = v_tok.lease_id;
  SELECT * INTO v_deal FROM public.deals WHERE id = v_tok.deal_id;

  v_grace_days := COALESCE(v_lease.grace_period_days, 5);
  v_snooze_date := CURRENT_DATE + v_grace_days;

  INSERT INTO public.rent_payments (
    user_id, lease_id, deal_id, period_month, due_date, amount_due, amount_paid, status, snooze_until, snoozed_at, reference_note
  ) VALUES (
    v_lease.user_id, v_lease.id, v_lease.deal_id, v_tok.period_month,
    (v_tok.period_month + (COALESCE(v_lease.payment_due_day, 1) - 1)),
    v_lease.monthly_rent, 0, 'snoozed', v_snooze_date, now(),
    'Snoozed by owner: dynamic grace period of ' || v_grace_days || ' days applied'
  )
  ON CONFLICT (lease_id, period_month) DO UPDATE SET
    status = 'snoozed', snooze_until = v_snooze_date, snoozed_at = now(),
    reference_note = 'Snoozed by owner: dynamic grace period of ' || v_grace_days || ' days applied',
    updated_at = now();

  UPDATE public.reconciliation_tokens SET used_at = now() WHERE id = v_tok.id;

  v_undo_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.reconciliation_tokens (lease_id, deal_id, user_id, period_month, action, token_hash, expires_at)
  VALUES (v_lease.id, v_deal.id, v_lease.user_id, v_tok.period_month, 'undo', v_undo_token, now() + INTERVAL '48 hours');

  RETURN jsonb_build_object(
    'success', true, 'action', 'snoozed', 'tenant_name', v_lease.tenant_name, 'deal_title', v_deal.title,
    'grace_period_days', v_grace_days, 'snooze_until', v_snooze_date, 'undo_token', v_undo_token
  );
END;
$function$;

-- Only the service role (edge functions) and the SECURITY DEFINER functions above touch this table.
REVOKE ALL ON public.reconciliation_tokens FROM anon, authenticated;

---------------------------------------------------------------------------------------------------------------------
-- 4. Everything else signed-in users may call: remove anon access, keep authenticated, pin search_path.
--    These already reference auth.uid(); a line-by-line review of each body is still TODO (see README).
---------------------------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_sync_proforma_to_actuals(uuid, numeric)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_advance_rent_increase(uuid, date, numeric, text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_evaluate_deal_notifications(uuid)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_get_portfolio_operations_summary(uuid)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_attach_entity_to_deal(uuid, uuid)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_create_or_update_entity(text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_delete_entity(uuid)                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_get_user_entities(boolean)                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_get_user_profile_with_companies()                    FROM PUBLIC, anon;

ALTER FUNCTION public.rpc_attach_entity_to_deal(uuid, uuid)                    SET search_path = public;
ALTER FUNCTION public.rpc_create_or_update_entity(text, text, text, text, text, text, uuid) SET search_path = public;
ALTER FUNCTION public.rpc_delete_entity(uuid)                                  SET search_path = public;
ALTER FUNCTION public.rpc_get_user_entities(boolean)                           SET search_path = public;
ALTER FUNCTION public.rpc_get_user_profile_with_companies()                    SET search_path = public;
ALTER FUNCTION public.rpc_evaluate_deal_notifications(uuid)                    SET search_path = public;
ALTER FUNCTION public.sync_profile_preferences()                               SET search_path = public;
-- rpc_get_debt_schedule is not SECURITY DEFINER; pin its search_path too:
ALTER FUNCTION public.rpc_get_debt_schedule SET search_path = public;

---------------------------------------------------------------------------------------------------------------------
-- 5. Unused by the current app and by every edge function: drop them (smaller attack surface, less to maintain).
--    Collaboration and scenario history now go through the manage-collaboration edge function and direct table access
--    under row-level security. DECISION NEEDED: confirm nothing outside this repo calls these.
---------------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_recalculate_deal(uuid, jsonb);
DROP FUNCTION IF EXISTS public.rpc_get_deal_shares(uuid);
DROP FUNCTION IF EXISTS public.rpc_share_deal_with_collaborator(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.rpc_revoke_deal_share(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_invite_collaborator(text);
DROP FUNCTION IF EXISTS public.rpc_respond_collaborator_invite(uuid, text);
DROP FUNCTION IF EXISTS public.rpc_get_user_collaborators();
DROP FUNCTION IF EXISTS public.rpc_save_parameter_snapshot(uuid, text, text, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.rpc_restore_parameter_snapshot(uuid);
DROP FUNCTION IF EXISTS public.rpc_delete_parameter_snapshot(uuid);
DROP FUNCTION IF EXISTS public.rpc_get_deal_parameter_history(uuid);

COMMIT;
