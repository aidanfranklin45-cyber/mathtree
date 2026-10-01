-- DRAFT 08 (APPLIED 2026-10-01): lease term type + Washington residential rent-increase guard.
--
-- * leases.term_type ('fixed' | 'month_to_month'), leases.is_subsidized, leases.stabilization_exempt (RCW 59.18.140 / 59.18.700).
--   Existing open-ended residential leases are marked month to month.
-- * execute_scheduled_rent_escalations(): for Washington residential properties rent never changes automatically. It changes only for an
--   explicit scheduled increase whose written notice date was recorded at least 90 days (30 if subsidized) before the effective date.
--   (Built on draft 07: owned, non-demo, lease in force, never lowers rent.)

BEGIN;

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS term_type text NOT NULL DEFAULT 'fixed';
ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_term_type_check;
ALTER TABLE public.leases ADD CONSTRAINT leases_term_type_check CHECK (term_type IN ('fixed', 'month_to_month'));
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS is_subsidized boolean NOT NULL DEFAULT false;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS stabilization_exempt boolean NOT NULL DEFAULT false;

UPDATE public.leases l SET term_type = 'month_to_month'
FROM public.deals d
WHERE d.id = l.deal_id AND d.asset_type IN ('single-family', 'multi-unit') AND l.lease_end_date IS NULL AND l.term_type = 'fixed';

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
    JOIN public.deals d ON d.id = l.deal_id
    LEFT JOIN LATERAL (
      SELECT id, new_rent, increase_type, scheduled_amount, notice_sent_date, effective_date
      FROM public.rent_increases
      WHERE lease_id = l.id
        AND effective_date <= CURRENT_DATE
        AND is_applied = false
      ORDER BY effective_date DESC
      LIMIT 1
    ) ri ON true
    WHERE l.is_active = true
      -- Only owned, non-demo properties with the lease in force are escalated (never prospects, demo data, or leases not started / ended)
      AND d.status = 'owned'
      AND d.is_demo = false
      AND (l.lease_start_date IS NULL OR l.lease_start_date <= CURRENT_DATE)
      AND (l.lease_end_date IS NULL OR l.lease_end_date >= CURRENT_DATE)
      -- Washington residential (RCW 59.18.140): no automatic escalation. Rent changes only for an explicit scheduled increase whose
      -- written notice was recorded (notice_sent_date) at least 90 days (30 if subsidized) before it takes effect.
      AND NOT (
        d.asset_type IN ('single-family', 'multi-unit')
        AND (
          COALESCE(NULLIF(d.inputs->'assessorData'->>'state', ''), NULLIF(d.inputs->>'state', ''), '') = 'WA'
          OR (
            COALESCE(NULLIF(d.inputs->'assessorData'->>'state', ''), NULLIF(d.inputs->>'state', ''), '') = ''
            AND d.location ~* '(,|[[:space:]])WA([[:space:]]+[0-9]{5}(-[0-9]{4})?)?[[:space:]]*$'
          )
        )
        AND NOT (
          ri.id IS NOT NULL
          AND ri.notice_sent_date IS NOT NULL
          AND ri.effective_date >= ri.notice_sent_date + (CASE WHEN l.is_subsidized THEN 30 ELSE 90 END)
        )
      )
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

    -- An escalation never lowers rent: a stale or mistaken scheduled row (new rent at or below today's rent) is left alone
    IF v_new_rent IS NULL OR v_new_rent <= r_lease.monthly_rent THEN
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

COMMIT;
