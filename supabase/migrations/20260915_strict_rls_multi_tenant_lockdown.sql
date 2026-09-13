-- 20260915_strict_rls_multi_tenant_lockdown.sql
-- Strict PostgreSQL Row Level Security (RLS) and Multi-Tenant Isolation
-- Locks down deals, leases, entities, units, parcels, rent_payments, and rent_increases.
-- Enables security_invoker = on on all relational views.

-- 1. Sanitize Data Flagging: Real user deals must NEVER be is_demo = true
UPDATE public.deals
SET is_demo = false
WHERE user_id = '26ba3e5c-697b-4f26-9b0d-a9bd40564f0d';

-- Ensure only Bob's synthetic benchmark templates are is_demo = true
UPDATE public.deals
SET is_demo = true
WHERE user_id = '12fc4c0a-a3e0-4cd2-8d7b-e671db00a957';

-- 2. Drop dangerous public update policy on deals (anon must NEVER update deals)
DROP POLICY IF EXISTS "Allow update access to demo deals" ON public.deals;

-- 3. Lock down LEASES table
DROP POLICY IF EXISTS "Allow public read access to demo leases" ON public.leases;
DROP POLICY IF EXISTS "Allow public insert access to demo leases" ON public.leases;
DROP POLICY IF EXISTS "Allow public update access to demo leases" ON public.leases;
DROP POLICY IF EXISTS "Allow public delete access to demo leases" ON public.leases;
DROP POLICY IF EXISTS "Users can view own leases" ON public.leases;
DROP POLICY IF EXISTS "Users can insert own leases" ON public.leases;
DROP POLICY IF EXISTS "Users can update own leases" ON public.leases;
DROP POLICY IF EXISTS "Users can delete own leases" ON public.leases;
DROP POLICY IF EXISTS "leases_select_policy" ON public.leases;
DROP POLICY IF EXISTS "leases_insert_policy" ON public.leases;
DROP POLICY IF EXISTS "leases_update_policy" ON public.leases;
DROP POLICY IF EXISTS "leases_delete_policy" ON public.leases;

CREATE POLICY "leases_select_policy"
ON public.leases
FOR SELECT
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  ))
  OR deal_id IN (SELECT id FROM public.deals WHERE is_demo = true)
);

CREATE POLICY "leases_insert_policy"
ON public.leases
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "leases_update_policy"
ON public.leases
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "leases_delete_policy"
ON public.leases
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

-- 4. Lock down ENTITIES table
DROP POLICY IF EXISTS "Allow public read access to entities" ON public.entities;
DROP POLICY IF EXISTS "Allow public write access to entities" ON public.entities;
DROP POLICY IF EXISTS "Users can view own entities" ON public.entities;
DROP POLICY IF EXISTS "Users can insert own entities" ON public.entities;
DROP POLICY IF EXISTS "Users can update own entities" ON public.entities;
DROP POLICY IF EXISTS "Users can delete own entities" ON public.entities;
DROP POLICY IF EXISTS "entities_select_policy" ON public.entities;
DROP POLICY IF EXISTS "entities_insert_policy" ON public.entities;
DROP POLICY IF EXISTS "entities_update_policy" ON public.entities;
DROP POLICY IF EXISTS "entities_delete_policy" ON public.entities;

CREATE POLICY "entities_select_policy"
ON public.entities
FOR SELECT
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  OR id IN (SELECT entity_id FROM public.deals WHERE is_demo = true AND entity_id IS NOT NULL)
);

CREATE POLICY "entities_insert_policy"
ON public.entities
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "entities_update_policy"
ON public.entities
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "entities_delete_policy"
ON public.entities
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- 5. Lock down UNITS table
DROP POLICY IF EXISTS "Allow public read access to units" ON public.units;
DROP POLICY IF EXISTS "Allow public write access to units" ON public.units;
DROP POLICY IF EXISTS "Users can view own units" ON public.units;
DROP POLICY IF EXISTS "Users can insert own units" ON public.units;
DROP POLICY IF EXISTS "Users can update own units" ON public.units;
DROP POLICY IF EXISTS "Users can delete own units" ON public.units;
DROP POLICY IF EXISTS "units_select_policy" ON public.units;
DROP POLICY IF EXISTS "units_insert_policy" ON public.units;
DROP POLICY IF EXISTS "units_update_policy" ON public.units;
DROP POLICY IF EXISTS "units_delete_policy" ON public.units;

CREATE POLICY "units_select_policy"
ON public.units
FOR SELECT
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  ))
  OR deal_id IN (SELECT id FROM public.deals WHERE is_demo = true)
);

CREATE POLICY "units_insert_policy"
ON public.units
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "units_update_policy"
ON public.units
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "units_delete_policy"
ON public.units
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

-- 6. Lock down RENT_PAYMENTS table
DROP POLICY IF EXISTS "Allow public read access to rent_payments" ON public.rent_payments;
DROP POLICY IF EXISTS "Users can view own rent_payments" ON public.rent_payments;
DROP POLICY IF EXISTS "Users can insert own rent_payments" ON public.rent_payments;
DROP POLICY IF EXISTS "Users can update own rent_payments" ON public.rent_payments;
DROP POLICY IF EXISTS "Users can delete own rent_payments" ON public.rent_payments;
DROP POLICY IF EXISTS "rent_payments_select_policy" ON public.rent_payments;
DROP POLICY IF EXISTS "rent_payments_insert_policy" ON public.rent_payments;
DROP POLICY IF EXISTS "rent_payments_update_policy" ON public.rent_payments;
DROP POLICY IF EXISTS "rent_payments_delete_policy" ON public.rent_payments;

CREATE POLICY "rent_payments_select_policy"
ON public.rent_payments
FOR SELECT
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  ))
  OR deal_id IN (SELECT id FROM public.deals WHERE is_demo = true)
);

CREATE POLICY "rent_payments_insert_policy"
ON public.rent_payments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "rent_payments_update_policy"
ON public.rent_payments
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "rent_payments_delete_policy"
ON public.rent_payments
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

-- 7. Lock down RENT_INCREASES table
DROP POLICY IF EXISTS "Allow public read access to rent_increases" ON public.rent_increases;
DROP POLICY IF EXISTS "Users can view own rent_increases" ON public.rent_increases;
DROP POLICY IF EXISTS "Users can insert own rent_increases" ON public.rent_increases;
DROP POLICY IF EXISTS "Users can update own rent_increases" ON public.rent_increases;
DROP POLICY IF EXISTS "Users can delete own rent_increases" ON public.rent_increases;
DROP POLICY IF EXISTS "rent_increases_select_policy" ON public.rent_increases;
DROP POLICY IF EXISTS "rent_increases_insert_policy" ON public.rent_increases;
DROP POLICY IF EXISTS "rent_increases_update_policy" ON public.rent_increases;
DROP POLICY IF EXISTS "rent_increases_delete_policy" ON public.rent_increases;

CREATE POLICY "rent_increases_select_policy"
ON public.rent_increases
FOR SELECT
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  ))
  OR deal_id IN (SELECT id FROM public.deals WHERE is_demo = true)
);

CREATE POLICY "rent_increases_insert_policy"
ON public.rent_increases
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "rent_increases_update_policy"
ON public.rent_increases
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

CREATE POLICY "rent_increases_delete_policy"
ON public.rent_increases
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  )
);

-- 8. Lock down PARCELS table
DROP POLICY IF EXISTS "Users can view own or demo parcels" ON public.parcels;
DROP POLICY IF EXISTS "parcels_select_policy" ON public.parcels;
CREATE POLICY "parcels_select_policy"
ON public.parcels
FOR SELECT
TO anon, authenticated
USING (
  (auth.uid() IS NOT NULL AND (
    auth.uid() = user_id 
    OR deal_id IN (SELECT id FROM public.deals WHERE user_id = auth.uid())
  ))
  OR deal_id IN (SELECT id FROM public.deals WHERE is_demo = true)
);

-- 9. Enforce security_invoker on all PostgreSQL views
ALTER VIEW public.view_deal_parcel_packages SET (security_invoker = on);
ALTER VIEW public.view_deal_performance_tracking SET (security_invoker = on);
ALTER VIEW public.view_monthly_rent_reconciliation SET (security_invoker = on);
ALTER VIEW public.view_portfolio_aggregates SET (security_invoker = on);
ALTER VIEW public.view_property_management_stats SET (security_invoker = on);
