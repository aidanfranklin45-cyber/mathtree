-- DRAFT 11: one share per deal per email and per group.   *** NOT APPLIED. Run by hand after review. ***
--
-- deal_shares only had UNIQUE (deal_id, shared_with_user_id). Email shares to people without an account have a NULL user id (NULLs
-- never collide) and group shares have no user id at all, so repeated shares piled up duplicate rows. manage-collaboration now
-- updates the existing row instead of inserting again; these partial indexes make the database enforce the same rule.
-- Rolling back: DROP INDEX uq_deal_shares_email; DROP INDEX uq_deal_shares_group;

BEGIN;

-- Keep the newest row of each duplicate set.
DELETE FROM public.deal_shares a
USING public.deal_shares b
WHERE a.deal_id = b.deal_id
  AND a.group_id IS NOT DISTINCT FROM b.group_id
  AND lower(a.shared_with_email) IS NOT DISTINCT FROM lower(b.shared_with_email)
  AND (a.group_id IS NOT NULL OR a.shared_with_email IS NOT NULL)
  AND (a.created_at, a.id) < (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_shares_email
  ON public.deal_shares (deal_id, lower(shared_with_email)) WHERE shared_with_email IS NOT NULL AND group_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_shares_group
  ON public.deal_shares (deal_id, group_id) WHERE group_id IS NOT NULL;

COMMIT;
