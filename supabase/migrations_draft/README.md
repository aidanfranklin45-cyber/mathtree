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

### The app itself rewrote the underwriting when leases changed (found while working on the rent model)

Saving a lease in Operations (the edge function, `EditLeaseModal`, `AddLeaseModal`), a database trigger, and the daily
escalation job all overwrote the deal's rent inputs and even replaced its lease list (which would have wiped the lease-expiry
assumptions). Owner decision: the transactions and leases are the record of what happened, and nothing rewrites the
underwriting to match. All of those writes are removed (code in this PR; the trigger and sync function are dropped in draft 01).
The one-click "Sync Pro-Forma" buttons and the revenue-variance alert are gone; the comparison that matters is the frozen baseline
vs reality (Overview card and the Operations table).

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
- EINs and bank names are never stored (owner decision). `entities.ein` was empty; `entities.bank_name` held a value in both rows. Both columns are dropped in draft 01 (6) (the two bank names are deleted with it) and no code references them.
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

- **App** (Firebase): the Operations page and Alert Settings now send the signed-in user's token to the monitor function; lease forms record the rent due day and grace period and no longer write to the deal; the Operations rent roll shows the next due date; the sync buttons are removed; unpaid-rent follow-ups are configurable per user (frequency, maximum count, snooze length) in Alert Settings, and the daily function no longer re-emails a snoozed payment every day.
- **Edge functions** (Supabase): `configure-lease-terms`, `cron-daily-lease-monitor`, `batch-sync-gis`, `generate-pdf-brief`,
  `manage-entities` (no longer writes `ein`; must be live before draft 01 drops the column), plus the new `_shared/auth.ts`. Deploy per function: `npx supabase functions deploy <name> --project-ref bgexwcepwbxvhxbpblhd --no-verify-jwt --use-api`.

## Rollout order (matters)

1. Merge this PR. Deploy the **app** first (`firebase deploy --only hosting`): the new app sends user tokens, which the
   old functions ignore, so nothing breaks yet.
2. The cron secret already exists (edge secret + Vault). Nothing to do.
3. Apply **03** (jobs now send the secret; harmless to the old functions).
4. Deploy the five **edge functions** (the four above plus `manage-entities`). They now require the user token / cron secret. (If they were deployed before step 3
   the daily and monthly jobs would be rejected until 03 is applied.)
5. Apply **01** (after the app is deployed, so baselines are captured by the app, not the old SQL function).
6. Smoke-test: Operations page (Send reminder, Sync monitor, Alert test email, Edit lease), PDF brief, Sync pro-forma, alerts,
   an email confirm link, marking a deal Owned (baseline created).
7. Take a backup marker, then apply **02**; regenerate `src/lib/supabase/types.ts`.

## Follow-up emails (configurable)

The daily function now follows each owner's Alert Settings: **follow up every N days**, **stop after M follow-ups** (or keep going until paid),
**a snooze lasts N days** (default: the lease's grace period). A follow-up starts when a snooze runs out or, if the reminder was ignored,
when the grace period ends; snoozing again pauses it; every email has Confirm and Snooze buttons. Rules live in
`supabase/functions/_shared/followups.ts` (12 tests). The snooze-length setting is applied inside `snooze_rent_payment_by_token`, so it
takes effect when draft 01 is applied; frequency and maximum take effect when the function is deployed.

## Decisions still open

1. ~~Lease rent auto-sync~~ **Resolved:** no sync of any kind; the trigger and sync function are dropped (draft 01, 3a/3g). Old notes follow for reference. The current pro-forma of an OWNED deal is the live
   picture of what it is actually making, so it should follow the rent roll automatically; the comparison that matters is
   frozen baseline vs current. The 3g trigger is only an interim, partial version (it writes `monthlyRent`/`grossRentAnnual`,
   which the engine ignores when the deal has explicit leases). Proposed replacement: derive the owned deal's leases from the
   `leases` table on the fly (no sync, one source of truth), then retire the trigger, `rpc_sync_proforma_to_actuals`, the
   manual "Sync pro-forma" buttons and the revenue-variance alert. Needs your go-ahead.
2. ~~Cron secret~~ **Done (2026-09-30):** a fresh 256-bit `CRON_SECRET` was set as an edge secret and the same value stored in Vault
   (`cron_secret`); digests were compared and match. Nothing uses it yet, so the live site is unchanged: the scheduled jobs still
   send the old anon key and the old functions ignore the secret. It takes effect in rollout steps 3-4. Rotate with
   `supabase secrets set` plus `vault.update_secret` if it is ever exposed.
3. ~~`entities.bank_name`~~ **Decided:** dropped with the EIN column (draft 01, 6).

## Not yet done

- These drafts are not syntax-tested: try them on a Supabase development branch first.
- Optional hardening: store only a hash of each email token (needs a small cron-function change and a transition period).
