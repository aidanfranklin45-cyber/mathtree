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

## 4. Decisions (owner, 2026-10-01) and status

1. **Digest emails: yes, as a checklist.** One email per property per day when 3 or more tenants are due (an owner setting: 2, 3, 5, 10, or never combine), with ONE "Manage rent payments" button. It opens a page that needs no sign-in: tick everyone who paid and press Save. Ticked tenants are recorded as paid; unticked tenants are snoozed for the owner's snooze setting (else the lease's grace period) and followed up from there, exactly as if "Missing rent" had been pressed. Reopening the link lets the owner correct a mistake; a month already recorded as paid some other way is shown as paid and left alone. The link is a long random value stored only as a hash, expires after 14 days and can only touch the leases it was issued for. A single tenant still gets the one-tenant email with Confirm and Snooze buttons. Built (`feat/rent-checklist`, migration 09, live; the page appears when merged).
2. **A tenant-by-tenant rent roll, not a unit mix.** Tenants pay different rents depending on when they came in, so each tenant is its own lease row (unit, tenant, rent, move-in date, lease dates or month to month, due day). Vacancy and the building's make-up stay configured per deal when it is created and updated in Edit Inputs; no new profile-level setting.
3. **Turnover / vacancy assumptions come from the deal's own vacancy configuration** (Edit Inputs), not a global default.
4. **Rent-increase notice follows Washington law.** Built (branch `feat/wa-rent-increase-rules`, live), see below.

### Washington rent increases (RCW 59.18.140 and 59.18.700), as built
Checked against the statute pages and the Department of Commerce on 2026-10-01. A helper, not legal advice.

* **Applies to** residential deals (houses and apartments) located in Washington (assessor state, or ", WA" in the address).
* **Enforced (blocks the increase):** at least **90 days'** written notice (30 for subsidized tenancies); no increase before a fixed-term lease ends; no increase in the first 12 months of a tenancy; the new rent may not exceed the lesser of 7% plus CPI or 10% (2026: **9.683%**, 2027: **10%**, from the Commerce announcements; other years use the 10% ceiling with a warning to check). Properties marked exempt skip the cap and first-year rule (the notice period still applies).
* **Warned, not blocked:** a second increase within 12 months (reported in secondary sources, not confirmed in the statute text); mailing the notice (allow extra days).
* **Record Rent Escalation screen:** shows the rules live, starts at the earliest legal effective date, prints a **notice for the tenant**, and records the date the notice was given. A future-dated increase is *scheduled* (the rent does not change early); a past or present date applies immediately only if the notice was given far enough ahead. It also no longer rewrites the deal's pro-forma (an old leftover).
* **The rent cannot change without the notice:** the nightly escalation job skips Washington residential leases entirely unless an explicit scheduled increase has a recorded notice date at least 90 (or 30) days before its effective date. There is no automatic yearly increase for these leases.
* **Reminders to the owner** (not the tenant): 14 days and 3 days before the last day to give notice, and the day after it passes ("this increase can no longer take effect on that date").
* **Lease term:** Add and Edit Lease now have *Fixed term* or *Month to month* (no end date, no auto-increase, "Month-to-month" badge in Operations), plus *subsidized* and *exempt from the cap* flags for residential leases.
* **Not confirmed:** the statute prescribes no particular wording for the notice; the printable notice is a plain template and says to have a Washington attorney review it. Tenants are not emailed by the app: the owner delivers the notice and records when.

### Phases
| Phase | What | Status |
|---|---|---|
| 1 | Eligibility rule, escalation guard, repair | **Done, live** |
| 2 | Lease term type (fixed / month to month), flags, badge, Washington notice rules | **Done, live** (term type also in the lease-saving function) |
| 3 | Digest emails with the rent checklist | **Done, live** (space labels in the PDF and Overview still to do) |
| 4 | Residential turnover model in the engine and Monte Carlo, from the deal's own vacancy configuration; "continue month to month" expiry mode | Next |
| 5 | **Tenant-by-tenant rent roll**: a grid in Operations (Rent Roll button) to enter or edit every tenant of a property, paste from a spreadsheet, each tenant with their own rent, move-in date, term, due day and yearly increase; creates the unit and lease rows. Also fixed: Add Lease now saves the unit it asks for. | **Done** (branch `feat/rent-roll-grid`) |
| 5b | **Underwrite from the rent roll**: in Edit Inputs, a prospect's tenants are copied into the deal's inputs (one lease per tenant, each with its own rent) by pressing "Underwrite from this rent roll"; it previews the effect and applies on Save. Never automatic; owned deals keep their frozen baseline; a deal that used it shows its tenants read-only in Edit Inputs (edit them in the rent roll, then press the button again). Computing each lease's rent schedule once per simulation (so very large rent rolls stay fast) and the expiry ladder are still to do | **Done** (branch `feat/underwrite-from-rent-roll`); speed-up and ladder proposed |

Residential turnover defaults (owner: "use the industry standard"), to be expressed through each deal's own vacancy configuration, not a global setting. Checked 2026-10-01: multifamily resident turnover is about **40 to 50% a year** (average retention about 60% in 2024; Yardi Matrix put turnover near 50% nationally; REITs report roughly 31 to 41%), with about **41 vacant days per turn** on average, and single-family rentals typically run **30 to 45 vacant days per turn** with heavier make-ready. Defaults: apartments 45% a year and 41 days; single-family 30% a year and 40 days. They stay editable per deal.

### Note for the rent roll and the analysis
A building with many tenants means many leases in the analysis: the engine evaluates every lease for every month of the hold, and the Monte Carlo repeats that 1,000 times. At about 0.2 ms per lease per run, a 12-tenant building is fine, but a 120-unit facility would take around 10 seconds. The fix is to compute each lease's monthly rent schedule once per simulation and only add the pieces that change per run (market drift after a lease ends, a tenant default), which makes the cost almost independent of the number of tenants. That belongs with Phase 5.
