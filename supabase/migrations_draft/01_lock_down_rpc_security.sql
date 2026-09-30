-- DRAFT 01: lock down SECURITY DEFINER functions.   *** NOT APPLIED. Review with the owner first. ***
--
-- Why: functions marked SECURITY DEFINER run with the owner's rights and bypass row-level security. Every one of them is
-- currently executable by the public `anon` role (the anon key ships in the browser), so anyone on the internet can call
-- them through /rest/v1/rpc/<name>. Four of them never check who is calling:
--   rpc_sync_proforma_to_actuals(deal, rent)      -> anyone can overwrite ANY deal's rent
--   schedule_advance_rent_increase(lease, ...)    -> anyone can schedule a rent increase on ANY lease   (unused: dropped)
--   rpc_evaluate_deal_notifications(user_id)      -> anyone can read/create ANY user's notifications
--   rpc_get_portfolio_operations_summary(user_id) -> anyone can read ANY user's operations summary   (unused: dropped)
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
--
-- Line-by-line audit results (2026-09-30), beyond the above:
--   * fn_sync_lease_to_deal (trigger on leases) called rpc_recalculate_deal: dropping the calculator would have made every
--     lease change fail. Rewritten (3g).
--   * execute_scheduled_rent_escalations recomputed stored analysis for touched deals: removed (3h).
--   * sync_profile_from_primary_entity let a user link another user's entity and copy its name: fixed (3i).
--   * handle_auth_user_sync failed signup on a malformed metadata field: fixed (3j).
--   * rpc_get_user_entities read deals.total_equity (would break when the column is dropped) and
--     rpc_get_user_profile_with_companies nests an aggregate inside an aggregate (errors at runtime): both unused, dropped.
--   * Entity RPCs, check_deal_share_mutual_collaborator, sync_profile_*: scoped correctly (owner checks present).
--   * Edge functions are a separate layer (verify_jwt is off on all of them); see README.

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
-- 3. Functions with no caller check: rewrite the two the app uses so they only act for the signed-in user; the rest are dropped (5).
---------------------------------------------------------------------------------------------------------------------

-- 3a. rpc_sync_proforma_to_actuals is DROPPED (section 5), not repaired. Owner decision 2026-09-30: the transactions and leases
--     are the record of what actually happened; nothing may one-click rewrite the underwriting to match them. The gap
--     between the underwriting / frozen baseline and reality is what the app reports, so it must stay visible.

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

    -- (Revenue-variance alerts were retired: they existed only to prompt a pro-forma sync.)

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


-- Retire existing revenue-variance alerts (they prompted a sync that no longer exists).
UPDATE public.app_notifications SET is_dismissed = true, is_read = true, updated_at = now()
WHERE type = 'revenue_variance' AND is_dismissed = false;

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
-- 3g. Lease -> deal rent trigger: DROPPED. AUDIT FINDING: fn_sync_lease_to_deal called rpc_recalculate_deal (dropping the
--     calculator would have made every lease change fail) and silently rewrote the deal's rent inputs on every lease edit.
--     Owner decision: real-world events never rewrite the underwriting. (The Operations lease forms and the lease edge
--     function no longer write to the deal either.)
---------------------------------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_lease_to_deal ON public.leases;
DROP FUNCTION IF EXISTS public.fn_sync_lease_to_deal();

---------------------------------------------------------------------------------------------------------------------
-- 3h. Daily rent escalations (called by the cron edge function with the service role). AUDIT FINDING: its last block
--     recomputed stored analysis for every touched deal (metrics, valuation, total_equity) and rewrote the deal's rent
--     inputs, with its own copy of the math; it would also break when those columns are dropped. Removed: escalations now
--     only update the LEASE (and rent_increases). The escalation logic itself is unchanged.
---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_scheduled_rent_escalations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r_lease RECORD;
  v_new_rent NUMERIC;
  v_updated_leases_count INTEGER := 0;
BEGIN
  FOR r_lease IN
    SELECT l.*, ri.id AS pending_inc_id, ri.new_rent AS scheduled_new_rent, ri.increase_type AS ri_type, ri.scheduled_amount AS ri_amount
    FROM public.leases l
    LEFT JOIN LATERAL (
      SELECT id, new_rent, increase_type, scheduled_amount
      FROM public.rent_increases
      WHERE lease_id = l.id
        AND effective_date <= CURRENT_DATE
        AND is_applied = false
      ORDER BY effective_date DESC
      LIMIT 1
    ) ri ON true
    WHERE l.is_active = true
      AND (
        ri.id IS NOT NULL
        OR (l.next_escalation_date IS NOT NULL AND l.next_escalation_date <= CURRENT_DATE)
      )
  LOOP
    IF r_lease.scheduled_new_rent IS NOT NULL THEN
      v_new_rent := r_lease.scheduled_new_rent;
    ELSIF r_lease.ri_amount IS NOT NULL THEN
      IF r_lease.ri_type = 'percentage' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.ri_amount / 100.0), 2);
      ELSIF r_lease.ri_type = 'fixed_step' THEN
        v_new_rent := r_lease.monthly_rent + r_lease.ri_amount;
      ELSIF r_lease.ri_type = 'cpi' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.ri_amount / 100.0), 2);
      ELSE
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.ri_amount / 100.0), 2);
      END IF;
    ELSIF r_lease.escalation_rate IS NOT NULL AND r_lease.escalation_rate > 0 THEN
      IF r_lease.escalation_type ILIKE '%percent%' THEN
        v_new_rent := ROUND(r_lease.monthly_rent * (1 + r_lease.escalation_rate / 100.0), 2);
      ELSE
        v_new_rent := r_lease.monthly_rent + r_lease.escalation_rate;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    IF r_lease.pending_inc_id IS NOT NULL THEN
      UPDATE public.rent_increases
      SET is_applied = true,
          old_rent = COALESCE(old_rent, r_lease.monthly_rent),
          new_rent = COALESCE(new_rent, v_new_rent)
      WHERE id = r_lease.pending_inc_id;
    ELSE
      INSERT INTO public.rent_increases (
        user_id, lease_id, deal_id, effective_date, old_rent, new_rent, increase_type, scheduled_amount, is_applied, reason
      ) VALUES (
        r_lease.user_id, r_lease.id, r_lease.deal_id, CURRENT_DATE, r_lease.monthly_rent, v_new_rent,
        CASE
          WHEN r_lease.escalation_type ILIKE '%percent%' THEN 'percentage'
          WHEN r_lease.escalation_type ILIKE '%step%' OR r_lease.escalation_type ILIKE '%fixed%' OR r_lease.escalation_type ILIKE '%$%' THEN 'fixed_step'
          WHEN r_lease.escalation_type ILIKE '%cpi%' THEN 'cpi'
          ELSE 'percentage'
        END,
        r_lease.escalation_rate,
        true,
        'Contractual ' || COALESCE(r_lease.escalation_frequency, 'Annual') || ' escalation executed'
      );
    END IF;

    UPDATE public.leases
    SET previous_rent_amount = r_lease.monthly_rent,
        monthly_rent = v_new_rent,
        last_rent_increase_date = CURRENT_DATE,
        next_escalation_date = CASE
          WHEN r_lease.escalation_frequency ILIKE '%annual%' THEN (CURRENT_DATE + INTERVAL '1 year')::date
          WHEN r_lease.escalation_frequency ILIKE '%month%' THEN (CURRENT_DATE + INTERVAL '1 month')::date
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = r_lease.id;

    v_updated_leases_count := v_updated_leases_count + 1;
  END LOOP;

  -- deals_recalculated is kept (always 0 now) so the edge function's log line keeps working
  RETURN jsonb_build_object(
    'success', true,
    'leases_escalated', v_updated_leases_count,
    'deals_recalculated', 0,
    'executed_at', now()
  );
END;
$function$;

---------------------------------------------------------------------------------------------------------------------
-- 3i. Profile <-> entity triggers. AUDIT FINDING: a user could set profiles.primary_entity_id to ANOTHER user's entity
--     id; the trigger then copied that entity's name into their own profile (and the rename trigger kept it updated).
--     Now the entity must belong to the profile's owner.
---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_from_primary_entity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entity_name TEXT;
BEGIN
  IF NEW.primary_entity_id IS NOT NULL THEN
    SELECT name INTO v_entity_name
    FROM public.entities
    WHERE id = NEW.primary_entity_id AND user_id = NEW.id;   -- must be the profile owner's own entity

    IF v_entity_name IS NULL THEN
      RAISE EXCEPTION 'Primary entity not found or not owned by this profile';
    END IF;
    NEW.company_name := v_entity_name;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_profile_on_entity_rename()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.profiles
    SET company_name = NEW.name
    WHERE primary_entity_id = NEW.id AND id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;

---------------------------------------------------------------------------------------------------------------------
-- 3j. New-user profile trigger. AUDIT FINDING (low): it cast a user-supplied signup field straight to jsonb; malformed
--     text made the account creation fail. Fall back to the defaults instead.
---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_auth_user_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefs jsonb;
BEGIN
  BEGIN
    v_prefs := (NEW.raw_user_meta_data->>'alert_preferences')::jsonb;
  EXCEPTION WHEN others THEN
    v_prefs := NULL;
  END;

  INSERT INTO public.profiles (id, email, created_at, updated_at, alert_preferences)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.created_at, NOW()),
    NOW(),
    COALESCE(v_prefs, '{"advance_notice_days": 0, "remind_on_due": true, "followup_grace_period": true, "escalation_notice_days": 30}'::jsonb)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = NOW(),
      alert_preferences = COALESCE(public.profiles.alert_preferences, EXCLUDED.alert_preferences);
  RETURN NEW;
END;
$function$;

---------------------------------------------------------------------------------------------------------------------
-- 4. What signed-in users may still call: no anon access, pinned search_path.
--    (Only one user-facing function remains: rpc_evaluate_deal_notifications; everything
--    else the app does goes through row-level-security tables and the edge functions.)
---------------------------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_evaluate_deal_notifications(uuid)                    FROM PUBLIC, anon;
ALTER FUNCTION public.sync_profile_preferences()                                           SET search_path = public;

---------------------------------------------------------------------------------------------------------------------
-- 5. Unused by the current app and by every edge function: drop them (smaller attack surface, nothing to keep in sync).
--    Collaboration, scenario history and entities now go through the manage-* edge functions and direct table access
--    under row-level security. Checked: no other database function calls any of these once 3c / 3g / 3h are in place.
--    (rpc_recalculate_deal and rpc_get_debt_schedule are DB-side copies of the financial engine; there must be one engine.)
---------------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_sync_proforma_to_actuals(uuid, numeric);
DROP FUNCTION IF EXISTS public.rpc_recalculate_deal(uuid, jsonb);
DROP FUNCTION IF EXISTS public.rpc_get_debt_schedule(numeric, numeric, integer, integer);
DROP FUNCTION IF EXISTS public.schedule_advance_rent_increase(uuid, date, numeric, text, text, numeric);
DROP FUNCTION IF EXISTS public.rpc_get_portfolio_operations_summary(uuid);
DROP FUNCTION IF EXISTS public.rpc_get_user_entities(boolean);
DROP FUNCTION IF EXISTS public.rpc_get_user_profile_with_companies();
DROP FUNCTION IF EXISTS public.rpc_attach_entity_to_deal(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_create_or_update_entity(text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.rpc_delete_entity(uuid);
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

---------------------------------------------------------------------------------------------------------------------
-- 6. We do not store EINs (owner decision 2026-09-30: no use for them, only liability). The column is empty (0 of 2 rows) and
--    the only path that could write it, rpc_create_or_update_entity, is dropped above. manage-entities no longer writes it
--    either, so deploy that function BEFORE applying this (an insert naming a missing column would fail).
--    Bank name is dropped the same way (owner decision 2026-09-30): two rows currently hold a value, which is deleted with the column.
---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.entities DROP COLUMN IF EXISTS ein;
ALTER TABLE public.entities DROP COLUMN IF EXISTS bank_name;

COMMIT;
