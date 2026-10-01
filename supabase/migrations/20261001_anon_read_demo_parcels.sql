-- Public demo brief: let signed-out visitors read the parcels of DEMO deals only.
-- The parcels_select_policy row rule already limits anon to deals with is_demo = true (same rule as leases and deals);
-- only the table privilege was missing (the original migration did REVOKE ALL ... FROM anon).
GRANT SELECT ON TABLE public.parcels TO anon;
