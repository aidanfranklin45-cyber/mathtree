# Draft database and edge-function security changes

The SQL here is deliberately outside `supabase/migrations/` so `supabase db push` ignores it. Nothing in this folder runs
until we review it together and apply it on purpose. The matching **edge-function and app code** fixes are in this PR's
diff (`supabase/functions/**`, `src/**`) and only take effect when deployed.

## Audit results (2026-09-30)

### Critical: anyone on the internet could do this today (no sign-in needed)

| # | Where | Problem | Fixed by |
|---|---|---|---|
| 1 | edge fn `configure-lease-terms` | No caller check at all. Read any lease by id; overwrite any lease or rewrite a deal's inputs given a deal id (a missing login fell back to acting as the deal owner). | code in this PR |
| 2 | edge fn `cron-daily-lease-monitor` | No caller check. Anyone could trigger a full run: email tenants, apply rent escalations; the test mode emailed **any address** (open email relay). | code + draft 03 |
| 3 | edge fn `batch-sync-gis` | No caller check; anyone could trigger a county-GIS re-sync of every deal. | code + draft 03 |
| 4 | edge fn `generate-pdf-brief` | Read any deal by id with the service role: anyone with a deal id got its full financial brief. | code in this PR |
| 5 | DB `rpc_sync_proforma_to_actuals` | No caller check: anyone could overwrite any deal's rent. | draft 01 (3a) |
| 6 | DB `rpc_evaluate_deal_notifications` | Trusted a passed-in user id: read or create any user's notifications. | draft 01 (3c) |
| 7 | DB `schedule_advance_rent_increase`, `rpc_get_portfolio_operations_summary` | Same pattern (write rent increases / read operations data for any id). Unused by the app. | dropped, draft 01 (5) |

### Breaks if applied as first drafted (caught by the audit)

- Trigger `trg_sync_lease_to_deal` calls `rpc_recalculate_deal`. Dropping that function (or the stored columns) would make
  **every lease insert/update/delete fail**. Rewritten in draft 01 (3g) to keep the behaviour without the calculator.
- `execute_scheduled_rent_escalations` recomputed stored analysis for touched deals: would break when the columns go. Fixed (3h).
- `rpc_get_user_entities` reads `deals.total_equity`; `rpc_get_user_profile_with_companies` nests an aggregate inside an
  aggregate (errors at runtime). Both unused: dropped.

### Smaller

- `sync_profile_from_primary_entity`: a user could link another user's entity and copy its name. Fixed (3i).
- `handle_auth_user_sync`: malformed signup metadata made account creation fail. Fixed (3j).
- Daily job authenticated with the public anon key, monthly job sent no credential: replaced with a Vault-backed shared secret (draft 03).
- Undo tokens were `md5(random() || clock)` (guessable); token table had excess client privileges. Fixed (3f).
- 31 SECURITY DEFINER functions were executable by `anon`; 8 had a mutable `search_path`. Revoked / pinned / dropped.
- EINs: the `entities.ein` column is empty (0 of 2 rows) and `manage-entities` already wrote `null`; owner decision is to never store them. Column dropped in draft 01 (6), code no longer references it. `entities.bank_name` still holds a value in both rows: decision pending (drop the column, or clear the values and keep it).
- Leaked-password protection is off (dashboard: Auth → Passwords). Not SQL.

### Reviewed and sound

Entity RPCs (scoped to `auth.uid()`), `manage-entities`, `manage-profile`, `manage-collaboration` (verify the user token
and scope every query to it), `reconcile-action` and the three email-token functions (public by design; tokens are
single-purpose, expiring, single-use, scoped to one lease and month; confirm/snooze tokens are 192-bit random).
Every table has row-level security with policies.

## The files

- `01_lock_down_rpc_security.sql`: revokes `anon`, rewrites the two functions the app uses, fixes the trigger/cron
  functions above, hardens the email-token functions, makes `deal_baselines` append-only, drops the unused and
  duplicate-calculator functions. One transaction.
- `02_drop_stored_analysis.sql`: drops the stored-analysis columns and two unused views. Irreversible. `deal_baselines`
  is kept: it is the frozen pro-forma at purchase, used to compare actual performance with what was expected.
- `03_cron_secret.sql`: makes the two scheduled jobs send a Vault-backed secret.

## Code changes in this PR that need deploying

- **App** (Firebase): the Operations page and Alert Settings now send the signed-in user's token to the monitor function.
- **Edge functions** (Supabase): `configure-lease-terms`, `cron-daily-lease-monitor`, `batch-sync-gis`, `generate-pdf-brief`,
  `manage-entities` (no longer writes `ein`; must be live before draft 01 drops the column), plus the new `_shared/auth.ts`. Deploy per function: `npx supabase functions deploy <name> --project-ref bgexwcepwbxvhxbpblhd --no-verify-jwt --use-api`.

## Rollout order (matters)

1. Merge this PR. Deploy the **app** first (`firebase deploy --only hosting`): the new app sends user tokens, which the
   old functions ignore, so nothing breaks yet.
2. Choose the cron secret. Set it as the `CRON_SECRET` edge secret and in Vault (steps at the top of `03_cron_secret.sql`).
3. Apply **03** (jobs now send the secret; harmless to the old functions).
4. Deploy the five **edge functions** (the four above plus `manage-entities`). They now require the user token / cron secret. (If they were deployed before step 3
   the daily and monthly jobs would be rejected until 03 is applied.)
5. Apply **01** (after the app is deployed, so baselines are captured by the app, not the old SQL function).
6. Smoke-test: Operations page (Send reminder, Sync monitor, Alert test email, Edit lease), PDF brief, Sync pro-forma, alerts,
   an email confirm link, marking a deal Owned (baseline created).
7. Take a backup marker, then apply **02**; regenerate `src/lib/supabase/types.ts`.

## Decisions still open

1. **Lease rent auto-sync (draft 01, 3g): direction agreed, design pending.** The current pro-forma of an OWNED deal is the live
   picture of what it is actually making, so it should follow the rent roll automatically; the comparison that matters is
   frozen baseline vs current. The 3g trigger is only an interim, partial version (it writes `monthlyRent`/`grossRentAnnual`,
   which the engine ignores when the deal has explicit leases). Proposed replacement: derive the owned deal's leases from the
   `leases` table on the fly (no sync, one source of truth), then retire the trigger, `rpc_sync_proforma_to_actuals`, the
   manual "Sync pro-forma" buttons and the revenue-variance alert. Needs your go-ahead.
2. **Cron secret** (step 2): there is no `CRON_SECRET` edge secret yet (only RESEND_*/SUPABASE_*). The edge-function side stays an edge
   secret; the database scheduler needs its own copy in Vault because it cannot read edge secrets. Setting it changes
   production secrets, so it is yours or needs your explicit go-ahead.
3. **`entities.bank_name`**: drop the column (deletes 2 values) or clear and keep.

## Not yet done

- These drafts are not syntax-tested: try them on a Supabase development branch first.
- Optional hardening: store only a hash of each email token (needs a small cron-function change and a transition period).
