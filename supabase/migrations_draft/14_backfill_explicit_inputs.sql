-- 14_backfill_explicit_inputs.sql  (DRAFT: not applied; owner review and explicit go required)
--
-- The engine no longer assumes any input (ENGINE_VERSION 2026-10-04.1). The two OWNED deals feed the portfolio scoreboard, so this
-- writes onto each of them the few inputs the old engine used to assume, so their numbers do not change. Every value below is
-- therefore a PLACEHOLDER inherited from the old engine, not a figure anyone chose: each is recorded in `assumptionBasis` as the
-- owner's, unsupported, with a note to replace it with the real document figure.
--
-- Prospect deals are deliberately NOT touched. They will show "Inputs needed" until the owner enters what is missing (or fills it
-- from the Investor Profile assumptions), which is the intended behaviour for a deal that has not been underwritten end to end.
--
-- Idempotent: merges keys into `inputs`, never removes one. Rows are matched by id (and must still be owned and non-demo).
-- Before applying: confirm the ids below, and replace the placeholders with real figures if you have them.
--
-- Differences the owner will see after the engine change, apart from this backfill:
--   * Selling costs (3% is already stated on both owned deals) now reduce the exit proceeds, so their IRR and equity multiple fall.
--   * Escalation, reserves, management and carrying costs are as stated here, not as the engine assumed.

begin;

-- Stop and Go Burgers (owned, commercial, NNN): f6280a80-f335-48c5-9f74-9837249f6981
update deals
set inputs = inputs
  || jsonb_build_object(
       'loanMaturityYears', 20,          -- = the 20-year amortization the old engine implicitly treated as the whole loan. CONFIRM against the note.
       'capexReserveAnnual', 0,          -- the old rule for NNN commercial was an explicit capexReserve, defaulting to 0
       'annualTaxes', 3241,              -- 1.1% of the county assessed value $294,650 (the old engine's carrying-cost default). REPLACE with the tax bill.
       'annualInsurance', 600,           -- old engine default. REPLACE with the policy premium.
       'annualMaintenance', 600          -- old engine default. REPLACE with actual upkeep.
     )
  || jsonb_build_object('assumptionBasis', coalesce(inputs->'assumptionBasis', '{}'::jsonb) || jsonb_build_object(
       'capexReserveAnnual', jsonb_build_object('source', 'owner', 'label', 'Replacement reserve', 'value', 0, 'rationale', 'Placeholder carried over from the old engine; replace with a reserve you can defend.'),
       'annualTaxes',        jsonb_build_object('source', 'owner', 'label', 'Property taxes', 'value', 3241, 'rationale', 'Placeholder: 1.1% of county assessed value, carried over from the old engine; replace with the actual tax bill.'),
       'annualInsurance',    jsonb_build_object('source', 'owner', 'label', 'Insurance', 'value', 600, 'rationale', 'Placeholder carried over from the old engine; replace with the actual premium.'),
       'annualMaintenance',  jsonb_build_object('source', 'owner', 'label', 'Maintenance', 'value', 600, 'rationale', 'Placeholder carried over from the old engine; replace with actual upkeep.')
     ))
where id = 'f6280a80-f335-48c5-9f74-9837249f6981' and status = 'owned' and coalesce(is_demo, false) = false;

-- Spokane Dirt Pit (owned, commercial, vacant land, no rent): 96350ce4-4a2a-4435-9b27-7209093f8f11
update deals
set inputs = inputs
  || jsonb_build_object(
       'loanMaturityYears', 15,          -- = the 15-year amortization. CONFIRM against the note.
       'capexReserveAnnual', 0,          -- vacant land carries no building reserve (the old engine took none)
       'annualTaxes', 668,               -- 1.1% of the county assessed value $60,750 (old engine default). REPLACE with the tax bill.
       'annualInsurance', 600,           -- old engine default. REPLACE.
       'annualMaintenance', 600          -- old engine default. REPLACE.
     )
  || jsonb_build_object('assumptionBasis', coalesce(inputs->'assumptionBasis', '{}'::jsonb) || jsonb_build_object(
       'capexReserveAnnual', jsonb_build_object('source', 'owner', 'label', 'Replacement reserve', 'value', 0, 'rationale', 'Vacant land: no building to reserve for.'),
       'annualTaxes',        jsonb_build_object('source', 'owner', 'label', 'Property taxes', 'value', 668, 'rationale', 'Placeholder: 1.1% of county assessed value, carried over from the old engine; replace with the actual tax bill.'),
       'annualInsurance',    jsonb_build_object('source', 'owner', 'label', 'Insurance', 'value', 600, 'rationale', 'Placeholder carried over from the old engine; replace with the actual premium.'),
       'annualMaintenance',  jsonb_build_object('source', 'owner', 'label', 'Maintenance', 'value', 600, 'rationale', 'Placeholder carried over from the old engine; replace with actual upkeep.')
     ))
where id = '96350ce4-4a2a-4435-9b27-7209093f8f11' and status = 'owned' and coalesce(is_demo, false) = false;

-- Expect 2 rows updated in total. Inspect, then commit (or rollback).
-- select id, title, inputs->'loanMaturityYears', inputs->'annualTaxes' from deals where id in ('f6280a80-f335-48c5-9f74-9837249f6981','96350ce4-4a2a-4435-9b27-7209093f8f11');
rollback;  -- change to `commit;` only on the owner's explicit go
