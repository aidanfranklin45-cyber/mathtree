-- DRAFT 04 (step 1 of 2): hash email tokens. TRANSITION: accepts a raw OR hashed stored value, so links already sent keep working.
-- Apply, deploy cron-daily-lease-monitor (it now stores hashes), then apply 05.
--
-- Email-link tokens (confirm / snooze / undo) are credentials. Until now the raw token was stored in
-- reconciliation_tokens.token_hash; anyone who could read that table (a backup, a leaked service key) could act on rent.
-- Now only SHA-256(token) is stored; the raw token exists only in the email link (and the undo link returned to the browser).

BEGIN;

CREATE OR REPLACE FUNCTION public.hash_token(p_token text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'extensions'
AS $f$ SELECT encode(extensions.digest(p_token, 'sha256'), 'hex') $f$;
REVOKE EXECUTE ON FUNCTION public.hash_token(text) FROM PUBLIC, anon, authenticated;

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
  WHERE token_hash IN (p_token, public.hash_token(p_token)) AND action = 'confirm' AND expires_at > now()
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
  VALUES (v_lease.id, v_deal.id, v_lease.user_id, v_tok.period_month, 'undo', public.hash_token(v_undo_token), now() + INTERVAL '48 hours');

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
  WHERE token_hash IN (p_token, public.hash_token(p_token)) AND action = 'snooze' AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired snooze link.');
  END IF;
  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This alert has already been snoozed.');
  END IF;

  SELECT * INTO v_lease FROM public.leases WHERE id = v_tok.lease_id;
  SELECT * INTO v_deal FROM public.deals WHERE id = v_tok.deal_id;

  -- How long a snooze lasts: the owner's alert setting if present, otherwise the lease's grace period
  v_grace_days := COALESCE(
    (SELECT CASE WHEN p.alert_preferences->>'snooze_days' ~ '^[0-9]{1,2}$'
 THEN (p.alert_preferences->>'snooze_days')::integer END
       FROM public.profiles p WHERE p.id = v_lease.user_id),
    v_lease.grace_period_days,
    5
  );
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
  VALUES (v_lease.id, v_deal.id, v_lease.user_id, v_tok.period_month, 'undo', public.hash_token(v_undo_token), now() + INTERVAL '48 hours');

  RETURN jsonb_build_object(
    'success', true, 'action', 'snoozed', 'tenant_name', v_lease.tenant_name, 'deal_title', v_deal.title,
    'grace_period_days', v_grace_days, 'snooze_until', v_snooze_date, 'undo_token', v_undo_token
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_rent_reconciliation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tok RECORD;
BEGIN
  SELECT * INTO v_tok
  FROM public.reconciliation_tokens
  WHERE token_hash IN (p_token, public.hash_token(p_token))
    AND action = 'undo'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired undo link.');
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Action has already been reverted.');
  END IF;

  -- Revert rent payment to pending
  UPDATE public.rent_payments
  SET 
    status = 'pending',
    amount_paid = 0,
    paid_date = NULL,
    payment_method = NULL,
    snooze_until = NULL,
    snoozed_at = NULL,
    reference_note = 'Reverted via Undo link',
    updated_at = now()
  WHERE lease_id = v_tok.lease_id AND period_month = v_tok.period_month;

  UPDATE public.reconciliation_tokens SET used_at = now() WHERE id = v_tok.id;

  RETURN jsonb_build_object('success', true, 'message', 'Payment status reverted to pending.');
END;
$function$;

COMMIT;
