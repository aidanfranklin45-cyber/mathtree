# Reviewed SQL applied by hand

This folder is a record of SQL that was reviewed and applied to production by hand, in the order of the file numbers. The files are
outside `supabase/migrations/` on purpose: the live schema was never built from that folder, so `supabase db push` must not run them.
**Do not re-run any of them.** For a new change, write the SQL here with the next number, review it, apply it, then note it below.

| File | What it did |
|---|---|
| 01 | Locked down RPC security (revoked `anon`, pinned search paths, dropped unused calculator functions, made `deal_baselines` append-only) |
| 02 | Dropped the stored-analysis columns and two unused views (the database stores facts, never results) |
| 03 | Scheduled jobs send a Vault-backed `CRON_SECRET` (daily run 15:00 UTC) |
| 04, 05 | Email tokens stored as SHA-256 hashes only |
| 07 | Escalations apply to owned deals only |
| 08 | Washington residential lease rules |
| 09 | Rent checklist (digest emails) |
| 10 | Transfer of deal ownership |
| 11 | One share per deal per target |
| 13 | Market benchmarks table (**not applied**) |
| 15 | Dropped utility meters and meter readings |
| 16 | Private bucket for the original documents (access follows the deal's owner), and the `deal_documents` list |

Still the owner's to do: switch on leaked-password protection (Supabase Auth dashboard, Auth, Passwords).
