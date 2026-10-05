-- 15_drop_utility_meters_and_readings.sql   APPLIED to production 2026-10-04 (migration "drop_utility_meters_and_meter_readings")
-- Record of what was run. Do not re-run.
--
-- Individual utility meters and readings are not tracked per property; utility cost is an underwriting assumption like any other.
-- Both tables were empty (0 rows). Steps, in order:
--   1. public.rpc_transfer_deal_ownership was re-created WITHOUT its two UPDATEs on these tables (otherwise a deal transfer would
--      have failed once they were gone). The function is otherwise unchanged from 10_transfer_deal_ownership.sql.
--   2. DROP TABLE public.meter_readings;   (references utility_meters, so first)
--   3. DROP TABLE public.utility_meters;
-- No CASCADE was used. Checked afterwards: neither table exists, no function mentions them, 10 deals and 8 leases unchanged.

DROP TABLE public.meter_readings;
DROP TABLE public.utility_meters;
