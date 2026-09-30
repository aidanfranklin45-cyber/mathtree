# Draft database changes (not applied, not run by `supabase db push`)

These files live outside `supabase/migrations/` on purpose. Nothing here touches the database until we review it together
and apply it deliberately. Each file is one independent, reversible-where-possible step.

## 01 — Lock down `SECURITY DEFINER` functions (security, urgent)

Found on 2026-09-30 by the Supabase security advisor plus reading the function bodies.

| Problem | Impact |
|---|---|
| `rpc_sync_proforma_to_actuals(deal, rent)` never checks the caller | Anyone with the public anon key can overwrite any deal's rent |
| `schedule_advance_rent_increase(lease, ...)` never checks the caller | Anyone can schedule rent increases on any lease |
| `rpc_evaluate_deal_notifications(user_id)` trusts the passed-in user id | Anyone can read or create another user's notifications |
| `rpc_get_portfolio_operations_summary(user_id)` trusts the passed-in user id | Anyone can read another user's operations summary |
| 31 `SECURITY DEFINER` functions executable by `anon` | Every one is callable from the internet |
| 8 functions with a mutable `search_path` | Hardening gap |
| `rpc_recalculate_deal`, `rpc_capture_deal_baseline` | Obsolete DB-side calculators; skip all checks |
| Leaked-password protection is off | Dashboard setting (Auth → Passwords), not SQL |

Tables themselves are safe: every table has row-level security with policies. The exposure is the functions that bypass it.

What the file does: revokes `anon` (and `authenticated` where only triggers/cron call it), rewrites the four functions so they
only act for `auth.uid()` (owner or shared editor where that makes sense), pins `search_path`, and drops eleven functions
that neither the React app nor any edge function calls, and rewrites the baseline and email-token functions.

Everything in the file runs in one transaction. `rpc_capture_deal_baseline` is rewritten (not dropped) and the rewritten
`rpc_evaluate_deal_notifications` keeps calling it, so alerts keep working and baselines keep being frozen.

### Decisions made (2026-09-30)
1. Drop the unused collaboration / scenario-snapshot functions: **yes** (nothing outside this repo calls them).
2. Shared **editors** may sync rent (owner or editor): **yes**.
3. Email-link functions stay public, but locked to one tiny action each: **yes**. Reviewed: tokens are single-purpose,
   expiring, single-use and scoped to one lease + month. Fixes drafted: undo tokens now use gen_random_bytes (were guessable
   md5(random)), and client roles lose all privileges on `reconciliation_tokens`.
4. **Baselines are a frozen record of the pro-forma at purchase** (what we expected), kept so actual performance can be compared
   with it. They are the one deliberate exception to compute-on-the-fly: a newer engine must not rewrite past expectations.
   So `deal_baselines` keeps its projected numbers, becomes append-only (trigger), and the SQL capture function (DB math, no
   caller check) is dropped. The app will capture baselines with the shared engine. `deal_parameter_history` (inputs per
   run, powers the Parameter History modal) is separate.

### Still to review (not done yet)
- A line-by-line audit of the bodies of the `auth.uid()`-based functions kept in section 4 (I only confirmed they reference
  `auth.uid()`, not that every query is scoped correctly): entities, profile and the entity-attach functions.
- Optional hardening: store only a SHA-256 of each email token instead of the raw token (needs a small change in the
  cron edge function plus a transition period for emails already sent). Not included in these drafts.
- These drafts are not syntax-tested. Suggest trying them on a Supabase development branch first.

## 02 — Drop the stored-analysis columns (Migration B)

Drops `deals.{metrics, irr, npv, cash_on_cash, equity_multiple, year1_cashflow, total_equity, metrics_computed_at}`,
the scenario-history `metrics / input_diff / metric_diff`, the two views built on them, and the stored numbers in
nothing in `deal_baselines` (it is kept). All are derived values. **Irreversible**, so the file lists its prerequisites (backup marker, confirm no
outside readers).

### Decisions made (2026-09-30)
1. Nothing outside this repo reads `irr`, `npv`, `cash_on_cash` etc. (only the app and edge functions such as the PDF brief): **confirmed**.
2. `deal_baselines` is left untouched (frozen expectations are the point of it).

## Suggested order
1. Turn on leaked-password protection (dashboard toggle).
2. Review and apply **01** (security first; nothing in the app depends on the things it removes).
3. Smoke-test in the app: alerts/notifications, Sync Pro-Forma, Log Payment, email reconcile links.
4. Take a backup marker, then apply **02**; regenerate `types.ts`.
5. Follow-up PR: delete the unused `src/lib/collaboration.ts`, regenerate types, add the Phase 7 build check.
