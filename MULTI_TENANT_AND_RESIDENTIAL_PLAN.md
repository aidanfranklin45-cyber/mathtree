# Rent emails, multi-tenant buildings and residential (month to month)

Written 2026-10-01 after the first real 15:00 UTC monitor run. Part 1 is fixed and live. Parts 2 and 3 are plans for you to approve.

## 1. What went wrong, and what is fixed (live now)

The first run on the new schedule sent six reminders. Only one was right.

| Deal | Status | Demo? | Should it be emailed? |
|---|---|---|---|
| Stop and Go Burgers | owned | no | **yes** (2-day advance notice for the 3rd) |
| The Fields | prospect | no | no (but an email went out) |
| 301 Pleasant | prospect | no | no (but an email went out) |
| 128 N 2nd St, 9150 Occidental, 9202 Occidental | prospect / owned | **demo** | no (sending failed only because Resend's free tier refuses other recipients) |

Cause: the monitor picked **every active lease** and never looked at whether the deal is owned, a prospect, or demo data. The same blind spot was in the database job that applies rent escalations: at 15:00:02 it escalated 301 Pleasant (a **prospect**) from a stale test row and **lowered its rent from $1,450 to $1,339**.

Fixed:
* **One shared rule** (`_shared/reminderEligibility.ts`, 10 tests): a tenant is only contacted when the deal is **owned**, **not demo**, and the lease is **in force today** (active, started, not ended; no end date, such as month to month, counts as in force).
* It is applied to **every** path that emails or changes rent: advance and due-date reminders, follow-ups (they reuse the same lease list), escalation notices, the manual "Send reminder" button (now says why when it declines), and the database escalation job (draft 07, applied).
* **Escalations never lower rent.** A scheduled "increase" at or below today's rent is skipped.
* **Data repaired:** 301 Pleasant's lease is back at $1,450 and the stale increase row is un-applied.
* **Checked against the live data:** under the new rule exactly one lease qualifies, Stop and Go.
* Deployed `cron-daily-lease-monitor`; tomorrow's run uses the new rule.

Known leftover: the 17 old test rows on 301 Pleasant's scheduled increases are still in the table (harmless now, they cannot lower rent or reach a prospect). They can be cleaned up whenever you like.

## 2. Multi-tenant buildings

### What exists today
* Each lease is its own row and can point at a **unit** (`units`: unit number, type, sqft, market rent, status). **Add Lease** has a "Unit / Suite #" field and Operations shows the space beside each tenant.
* The emails now put the space in the subject **when a property has more than one tenant** ("Rent Due Today: Acme Dental (Suite 120) $3,400 - 55 Main St"). Labels that already say what they are ("Suite 100", "Main Building") are kept; bare numbers become "Unit 4B".
* The dashboard, Overview and primer count **tenants in force today**, so an ended intercompany period or a future lease is not a tenant.
* Edit Inputs edits the primary lease and now **keeps** any others (it used to rewrite the list).

### Gaps
1. **One email per tenant does not scale.** A 12-unit building is 12 emails on the 1st; a 120-unit storage facility would be 120.
2. **The demo "multi-tenant" deals are not real examples.** They model a whole building as one lease ("Oakridge Residential Tenants (12 Units)") on one placeholder unit ("Suite 100"). Nothing models a true rent roll with vacant units.
3. **Entering many tenants is slow.** One at a time through Add Lease.
4. **Analysis treats vacancy as a single percentage**, not "units 3 and 7 are empty". Two sources of truth by design: analysis reads the deal's inputs, operations read the lease and payment records.
5. **No lease-expiry view** across tenants (a ladder by year, weighted-average lease term).

### Plan
* **M1. Digest email (recommended).** One email per property per day, listing every tenant due: space, tenant, amount, and its own Confirm and Snooze buttons. A property with fewer than 3 tenants due keeps single emails (the threshold is a setting). Follow-ups work the same way.
* **M2. Fast rent-roll entry.** Paste or import a rent roll (unit, tenant, rent, start, end, escalation), plus a "unit mix" shortcut ("12 x 2BR at $1,450") for storage and apartments where per-tenant detail is not needed.
* **M3. Two levels of detail in the analysis.** *Detailed rent roll* for commercial suites (each lease through the engine, as now) and *unit mix* for storage, apartments and houses (counts times rents, with real vacancy by unit). Vacant units carry market rent and a lease-up assumption.
* **M4. Show the space everywhere:** PDF rent roll table, Overview tenancy line, alerts, and a lease-expiry ladder with weighted-average lease term.
* **M5. Monte Carlo.** A default already hits one tenant chosen by rent weight; with a unit mix the default hits a share of units, and its downtime becomes vacancy for that share.

## 3. Residential (mostly month to month)

Nothing models month to month today; a lease with no end date is only an open-ended fixed lease. Needs:

* **Term type on every lease:** *Fixed term* or *Month to month*. Month to month has no end date, shows no expiry, and gets a "Month-to-month" badge in Operations and on the dashboard card. Residential fixed-term leases get an "after the term, convert to month to month" default.
* **A new expiry mode: "continue month to month".** Distinct from "renew" (a long commitment) and "vacant": rent carries on, but the tenant can leave on notice, so turnover risk applies. It joins the profile default, with separate defaults for residential and commercial.
* **Turnover, labelled like tenant default.** Residential income is modelled with an explicit annual turnover probability and move-out downtime plus make-ready cost, replacing today's single blended vacancy for houses and apartments. In the Monte Carlo this is the visible, adjustable counterpart of commercial tenant default.
* **Rent increases are a decision, not a contract term.** Month to month leases get no automatic escalation (the escalation job skips them unless you scheduled an increase), and the existing notice email goes out the number of days you set before the increase takes effect. The notice period is a setting per owner or lease; the app does not give legal advice and does not assume a jurisdiction's rules.
* **Move-out handling.** Record a notice to vacate and a move-out date; reminders stop after it, the lease closes, and the vacancy clock starts.
* **Emails** drop "lease expires" wording for month-to-month tenants and say "Month to month".
* Residential reminders already work under the new rule (an open-ended lease counts as in force).

## 4. Phases and decisions

| Phase | What | Notes |
|---|---|---|
| 1 | Eligibility rule, escalation guard, repair | **Done, live** |
| 2 | Lease term type (fixed / month to month), badge, hide expiry for month to month; "continue month to month" mode | Small database change (a column) |
| 3 | Digest emails; space labels in the PDF and Overview | Needs your digest decision |
| 4 | Turnover model for residential in the engine and Monte Carlo | Changes Sensitivity-tab numbers for houses and apartments |
| 5 | Rent-roll import and unit mix, expiry ladder | Largest piece |

Decisions needed:
1. **Digest or one email per tenant?** Recommendation: digest when 3 or more tenants of one property are due the same day.
2. **For apartments and storage, unit mix or a full rent roll?** Recommendation: both, chosen by property type.
3. **Default annual turnover for residential** (a placeholder of about 25% a year, with 1 to 2 months of downtime) and whether you want separate residential and commercial defaults.
4. **Month-to-month increase notice default:** how many days should the app warn before an increase?
