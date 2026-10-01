-- DRAFT 09 (APPLIED 2026-10-01): the rent checklist ("Manage rent payments") for properties with several tenants.
--
-- One link in the digest email opens a page, with no sign-in, listing every tenant due that month with a checkbox. Tick the people who
-- paid and press Save: ticked tenants are recorded as paid, unticked tenants are snoozed for the owner's snooze setting (the same as the
-- "Missing rent" button) and are followed up from there. The link is the credential, so it is a long random value stored only as a hash,
-- it expires, and it can only touch the leases it was issued for.
--
--   rent_batches                      one row per digest link (service role writes it; nobody on the API can read it)
--   get_rent_batch_by_token(token)    the list for the page (anon allowed: the token is the credential)
--   submit_rent_batch_by_token(token, paid_lease_ids)   records the ticks
--
-- Rules for the save:
--   * ticked  -> paid in full (amount due), unticked -> snoozed (owner's snooze_days, else the lease's grace period, else 5 days)
--   * a month already recorded as paid or partially paid some OTHER way (the app, an email button) is shown as paid and left alone
--   * a month this checklist marked paid can be corrected by opening the same link again and unticking it (it goes back to snoozed)

BEGIN;

CREATE TABLE IF NOT EXISTS public.rent_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  lease_ids uuid[] NOT NULL,
  kind text NOT NULL DEFAULT 'reminder' CHECK (kind IN ('reminder', 'followup')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rent_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rent_batches FROM anon, authenticated;
COMMENT ON TABLE public.rent_batches IS 'One-time links for the rent checklist. Only the service role and the SECURITY DEFINER functions below touch it.';

CREATE OR REPLACE FUNCTION public.get_rent_batch_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_b RECORD;
  v_title text;
  v_snooze integer;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_b FROM public.rent_batches WHERE token_hash = public.hash_token(p_token) AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link is invalid or has expired.');
  END IF;

  SELECT title INTO v_title FROM public.deals WHERE id = v_b.deal_id;
  SELECT CASE WHEN p.alert_preferences->>'snooze_days' ~ '^[0-9]{1,2}$' THEN (p.alert_preferences->>'snooze_days')::integer END
    INTO v_snooze FROM public.profiles p WHERE p.id = v_b.user_id;

  SELECT COALESCE(jsonb_agg(r.obj ORDER BY r.sort_key), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      COALESCE(u.unit_number, '') AS sort_key,
      jsonb_build_object(
        'lease_id', l.id,
        'tenant_name', l.tenant_name,
        'space', COALESCE(u.unit_number, ''),
        'amount_due', COALESCE(rp.amount_due, l.monthly_rent),
        'amount_paid', COALESCE(rp.amount_paid, 0),
        'snooze_until', rp.snooze_until,
        'state', CASE
          WHEN rp.status IN ('paid', 'partial') AND COALESCE(rp.reference_note, '') LIKE 'Checklist:%' THEN 'paid_here'
          WHEN rp.status IN ('paid', 'partial') THEN 'paid_other'
          WHEN rp.status = 'snoozed' THEN 'snoozed'
          ELSE 'unpaid'
        END
      ) AS obj
    FROM public.leases l
    LEFT JOIN public.units u ON u.id = l.unit_id
    LEFT JOIN public.rent_payments rp ON rp.lease_id = l.id AND rp.period_month = v_b.period_month
    WHERE l.id = ANY (v_b.lease_ids) AND l.is_active = true
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'deal_title', v_title,
    'period_month', v_b.period_month,
    'kind', v_b.kind,
    'snooze_days', v_snooze,
    'expires_at', v_b.expires_at,
    'rows', v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_rent_batch_by_token(p_token text, p_paid uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_b RECORD;
  v_paid uuid[] := COALESCE(p_paid, ARRAY[]::uuid[]);
  v_snooze integer;
  v_lease RECORD;
  v_existing RECORD;
  v_days integer;
  n_paid integer := 0;
  n_snoozed integer := 0;
  n_locked integer := 0;
BEGIN
  SELECT * INTO v_b FROM public.rent_batches WHERE token_hash = public.hash_token(p_token) AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This link is invalid or has expired.');
  END IF;

  SELECT CASE WHEN p.alert_preferences->>'snooze_days' ~ '^[0-9]{1,2}$' THEN (p.alert_preferences->>'snooze_days')::integer END
    INTO v_snooze FROM public.profiles p WHERE p.id = v_b.user_id;

  -- Only the leases this link was issued for are touched; any other id in p_paid is ignored
  FOR v_lease IN SELECT * FROM public.leases WHERE id = ANY (v_b.lease_ids) AND is_active = true LOOP
    SELECT * INTO v_existing FROM public.rent_payments WHERE lease_id = v_lease.id AND period_month = v_b.period_month;

    -- Recorded as paid some other way (app, email button): leave it alone
    IF FOUND AND v_existing.status IN ('paid', 'partial') AND COALESCE(v_existing.reference_note, '') NOT LIKE 'Checklist:%' THEN
      n_locked := n_locked + 1;
      CONTINUE;
    END IF;

    IF v_lease.id = ANY (v_paid) THEN
      INSERT INTO public.rent_payments (user_id, lease_id, deal_id, period_month, due_date, amount_due, amount_paid, paid_date, status, payment_method, reference_note)
      VALUES (v_lease.user_id, v_lease.id, v_lease.deal_id, v_b.period_month, (v_b.period_month + (COALESCE(v_lease.payment_due_day, 1) - 1)),
              v_lease.monthly_rent, v_lease.monthly_rent, CURRENT_DATE, 'paid', '1-Click Checklist', 'Checklist: marked paid from the rent checklist')
      ON CONFLICT (lease_id, period_month) DO UPDATE SET
        amount_paid = rent_payments.amount_due, paid_date = CURRENT_DATE, status = 'paid', payment_method = '1-Click Checklist',
        reference_note = 'Checklist: marked paid from the rent checklist', snooze_until = NULL, snoozed_at = NULL, updated_at = now();
      n_paid := n_paid + 1;
    ELSE
      v_days := COALESCE(v_snooze, v_lease.grace_period_days, 5);
      INSERT INTO public.rent_payments (user_id, lease_id, deal_id, period_month, due_date, amount_due, amount_paid, status, snooze_until, snoozed_at, payment_method, reference_note)
      VALUES (v_lease.user_id, v_lease.id, v_lease.deal_id, v_b.period_month, (v_b.period_month + (COALESCE(v_lease.payment_due_day, 1) - 1)),
              v_lease.monthly_rent, 0, 'snoozed', CURRENT_DATE + v_days, now(), NULL,
              'Checklist: not received yet; snoozed ' || v_days || ' days')
      ON CONFLICT (lease_id, period_month) DO UPDATE SET
        amount_paid = 0, paid_date = NULL, status = 'snoozed', snooze_until = CURRENT_DATE + v_days, snoozed_at = now(), payment_method = NULL,
        reference_note = 'Checklist: not received yet; snoozed ' || v_days || ' days', updated_at = now();
      n_snoozed := n_snoozed + 1;
    END IF;
  END LOOP;

  UPDATE public.rent_batches SET last_submitted_at = now() WHERE id = v_b.id;

  RETURN jsonb_build_object('success', true, 'paid', n_paid, 'snoozed', n_snoozed, 'already_recorded', n_locked, 'snooze_days', COALESCE(v_snooze, 5));
END;
$function$;

-- The token is the credential, exactly like the confirm / snooze email links
REVOKE EXECUTE ON FUNCTION public.get_rent_batch_by_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_rent_batch_by_token(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rent_batch_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rent_batch_by_token(text, uuid[]) TO anon, authenticated;

COMMIT;
