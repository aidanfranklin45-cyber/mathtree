// Washington State residential rent increases. Pure (no Deno / database / network) so the rules can be tested and shared by the app
// and the edge functions.
//
// Sources (checked 2026-10-01; confirm against current law, this is a helper and not legal advice):
//   * RCW 59.18.140: a landlord must give at least 90 days' prior WRITTEN notice of an increase in rent (30 days for subsidized
//     tenancies); an increase may not take effect before the end of the term of the rental agreement (except by mutual consent, and
//     for subsidized tenancies). Last amended May 7, 2025 (HB 1217).
//   * RCW 59.18.700 (rent stabilization): no increase in the first 12 months of a tenancy; an increase may not exceed the lesser of
//     7% plus CPI or 10%. The Department of Commerce publishes the maximum each year (2026: 9.683%, 2027: 10%). Exemptions are in
//     RCW 59.18.710 (for example new construction for 12 years, certain owner-occupied small buildings, tax-credit and nonprofit
//     housing).
//   * Reported in secondary sources but not confirmed in the statute text: only one increase in any 12-month period. It is a WARNING
//     here, not a block.
// The statute prescribes no particular wording for the notice itself; the notice this module drafts is a plain template to be
// reviewed by counsel before use.

/** Maximum annual increase (%) published by Washington's Department of Commerce, by calendar year. Update each July. */
export const WA_RENT_CAP_BY_YEAR: Record<number, number> = { 2026: 9.683, 2027: 10 };
/** The statutory ceiling: the cap can never be higher than this. */
export const WA_CAP_CEILING_PCT = 10;
export const WA_NOTICE_DAYS = 90;
export const WA_NOTICE_DAYS_SUBSIDIZED = 30;

const RESIDENTIAL = new Set(["single-family", "single_family", "sfr", "multi-unit", "multi_family", "multi-family", "multifamily", "residential"]);

export function isResidentialAsset(assetType: unknown): boolean {
  return RESIDENTIAL.has(String(assetType ?? "").trim().toLowerCase());
}

/** True when the property is in Washington (assessor state, an explicit state field, or ", WA" in the address). */
export function isWashingtonProperty(deal: { location?: unknown; inputs?: Record<string, any> | null }): boolean {
  const inp = deal.inputs ?? {};
  const state = String(inp?.assessorData?.state ?? inp?.state ?? "").trim().toUpperCase();
  if (state) return state === "WA" || state === "WASHINGTON";
  const loc = String(deal.location ?? inp?.propertyAddress ?? inp?.location ?? "");
  return /(?:,|\s)WA(?:\s+\d{5}(?:-\d{4})?)?\s*$/i.test(loc.trim()) || /\bWashington\b/i.test(loc);
}

// ---- tiny UTC date helpers on YYYY-MM-DD strings ----
const toUtc = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const toIso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
export const addMonths = (iso: string, n: number): string => {
  const d = toUtc(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIso(d);
};
export const daysBetween = (fromIso: string, toIsoStr: string): number => Math.round((toUtc(toIsoStr).getTime() - toUtc(fromIso).getTime()) / 86400000);
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

export interface RentIncreaseCheckInput {
  /** YYYY-MM-DD */
  today: string;
  currentRent: number;
  newRent: number;
  effectiveDate: string;
  /** The date the written notice was (or will be) given to the tenant. Blank = not yet served. */
  noticeServedDate?: string | null;
  tenancyStartDate?: string | null;
  /** Effective date of the most recent increase, if any. */
  lastIncreaseDate?: string | null;
  termType?: "fixed" | "month_to_month" | string | null;
  leaseEndDate?: string | null;
  subsidized?: boolean;
  /** Exempt from rent stabilization (RCW 59.18.710), for example new construction. The 90-day notice still applies. */
  stabilizationExempt?: boolean;
}

export interface RentIncreaseCheck {
  ok: boolean;
  /** Blocking problems: the increase as entered would break the rules. */
  errors: string[];
  /** Things to double-check; do not block. */
  warnings: string[];
  increasePct: number;
  noticeDays: number;
  /** Maximum increase (%) that applies to this effective date, or null when exempt. */
  maxPct: number | null;
  /** The highest new rent the cap allows (rounded down to the cent), or null when the cap does not apply. */
  maxNewRent: number | null;
  /** The earliest effective date the rules allow for an increase decided today. */
  earliestEffectiveDate: string;
  /** The last day the written notice can be given for the chosen effective date. */
  latestNoticeDate: string;
}

const usd = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function checkWashingtonRentIncrease(i: RentIncreaseCheckInput): RentIncreaseCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const noticeDays = i.subsidized ? WA_NOTICE_DAYS_SUBSIDIZED : WA_NOTICE_DAYS;
  const increasePct = i.currentRent > 0 ? ((i.newRent - i.currentRent) / i.currentRent) * 100 : 0;
  const served = validDate(i.noticeServedDate) ? i.noticeServedDate.slice(0, 10) : null;

  if (!(i.newRent > i.currentRent)) errors.push("The new rent must be higher than the current rent.");
  if (served && served > i.today) errors.push("The notice date cannot be in the future. Enter the date it was actually given to the tenant.");

  // Earliest effective date: the notice period (from the served date, or from today if it is not served yet), the end of a fixed term,
  // and (unless exempt) the first 12 months of the tenancy and one year after the last increase.
  const candidates: Array<{ date: string; why: string }> = [];
  const noticeBase = served ?? i.today;
  candidates.push({ date: addDays(noticeBase, noticeDays), why: `${noticeDays} days' written notice (RCW 59.18.140) counted from ${served ? "the notice date" : "today"}` });
  if (String(i.termType ?? "fixed") === "fixed" && validDate(i.leaseEndDate)) {
    candidates.push({ date: addDays(i.leaseEndDate.slice(0, 10), 1), why: "an increase may not take effect before the lease term ends (RCW 59.18.140)" });
  }
  if (!i.stabilizationExempt && validDate(i.tenancyStartDate)) {
    candidates.push({ date: addMonths(i.tenancyStartDate.slice(0, 10), 12), why: "no increase in the first 12 months of a tenancy (RCW 59.18.700)" });
  }
  const earliest = candidates.reduce((a, b) => (b.date > a.date ? b : a));
  if (i.effectiveDate < earliest.date) {
    const failing = candidates.filter((c) => i.effectiveDate < c.date);
    for (const f of failing) errors.push(`Too early: ${f.why}. The earliest allowed effective date is ${f.date}.`);
  }
  const latestNoticeDate = addDays(i.effectiveDate, -noticeDays);
  if (!served && latestNoticeDate < i.today) {
    // already covered by the "too early" error above (today + 90 > effective); nothing more to add
  }

  // The cap (rent stabilization), unless exempt. Subsidized tenancies have their own rules, so only warn.
  let maxPct: number | null = null;
  let maxNewRent: number | null = null;
  if (!i.stabilizationExempt && !i.subsidized) {
    const year = Number(i.effectiveDate.slice(0, 4));
    const published = WA_RENT_CAP_BY_YEAR[year];
    maxPct = published ?? WA_CAP_CEILING_PCT;
    if (published === undefined) warnings.push(`No Commerce-published maximum is on file for ${year}; the 10% ceiling is used. Check the current figure at commerce.wa.gov.`);
    maxNewRent = Math.floor(i.currentRent * (1 + maxPct / 100) * 100) / 100;
    if (increasePct > maxPct + 1e-9) {
      errors.push(`Over the ${year} limit of ${maxPct}% (RCW 59.18.700): the most you can raise this rent to is ${usd(maxNewRent)}.`);
    }
  } else if (i.subsidized) {
    warnings.push("Subsidized tenancies have different notice and increase rules. Confirm the program's requirements before relying on this check.");
  }

  // Reported but not confirmed in the statute text: one increase per 12 months
  if (!i.stabilizationExempt && validDate(i.lastIncreaseDate)) {
    const next = addMonths(i.lastIncreaseDate.slice(0, 10), 12);
    if (i.effectiveDate < next) warnings.push(`The last increase took effect ${i.lastIncreaseDate.slice(0, 10)}. Washington is reported to allow only one increase in any 12-month period; confirm before raising again before ${next}.`);
  }
  if (!served) warnings.push(`Give the tenant written notice by ${latestNoticeDate} at the latest. If you mail it, allow extra days for service.`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    increasePct: Math.round(increasePct * 1000) / 1000,
    noticeDays,
    maxPct,
    maxNewRent,
    earliestEffectiveDate: earliest.date,
    latestNoticeDate,
  };
}

export type NoticeReminderStage = "heads_up" | "final" | "missed" | null;

/**
 * When to remind the OWNER to give the tenant written notice of a scheduled increase. `daysToEffective` is the number of days from today to
 * the effective date. Two reminders ahead of the deadline (14 and 3 days before the last day to give notice) and one the day after it passes.
 */
export function noticeReminderStage(daysToEffective: number, noticeDays: number): NoticeReminderStage {
  if (daysToEffective === noticeDays + 14) return "heads_up";
  if (daysToEffective === noticeDays + 3) return "final";
  if (daysToEffective === noticeDays - 1) return "missed";
  return null;
}

const esc = (v: unknown): string => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RentIncreaseNoticeInput {
  landlordName: string;
  tenantName: string;
  propertyAddress: string;
  unit?: string;
  currentRent: number;
  newRent: number;
  effectiveDate: string;
  /** Date of this notice (YYYY-MM-DD). */
  noticeDate: string;
}

const longDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/** A plain, printable written notice of a rent increase. A template for the owner to review and deliver; it is not legal advice. */
export function buildRentIncreaseNoticeHtml(n: RentIncreaseNoticeInput): string {
  const pct = n.currentRent > 0 ? ((n.newRent - n.currentRent) / n.currentRent) * 100 : 0;
  const premises = [n.propertyAddress, n.unit].filter(Boolean).join(", ");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Notice of Rent Increase</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; max-width: 680px; margin: 48px auto; line-height: 1.55; font-size: 14px; padding: 0 24px; }
  h1 { font-size: 20px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  table { border-collapse: collapse; margin: 16px 0; } td { padding: 4px 18px 4px 0; vertical-align: top; }
  .sig { margin-top: 48px; } .line { border-bottom: 1px solid #111; width: 280px; height: 28px; }
  .fine { font-size: 11px; color: #555; margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; }
  @media print { .fine { color: #333; } }
</style></head><body>
<h1>Notice of Rent Increase</h1>
<p>Date of notice: <strong>${esc(longDate(n.noticeDate))}</strong></p>
<p>To: <strong>${esc(n.tenantName)}</strong><br>Premises: <strong>${esc(premises)}</strong></p>
<p>This is written notice that the monthly rent for the premises above will increase as follows:</p>
<table>
  <tr><td>Current monthly rent</td><td><strong>${esc(usd(n.currentRent))}</strong></td></tr>
  <tr><td>New monthly rent</td><td><strong>${esc(usd(n.newRent))}</strong></td></tr>
  <tr><td>Increase</td><td>${esc(usd(n.newRent - n.currentRent))} (${esc(pct.toFixed(2))}%)</td></tr>
  <tr><td>Effective date</td><td><strong>${esc(longDate(n.effectiveDate))}</strong></td></tr>
</table>
<p>The new rent applies to the rent due on and after the effective date. All other terms of the tenancy are unchanged.</p>
<p>Landlord: <strong>${esc(n.landlordName)}</strong></p>
<div class="sig"><div class="line"></div>Landlord or authorized agent &nbsp;&nbsp;&nbsp; Date: ____________</div>
<p style="margin-top:28px">Method of delivery (tick one): &#9744; handed to tenant &nbsp; &#9744; mailed &nbsp; &#9744; other: ____________ &nbsp;&nbsp; Date delivered: ____________</p>
<div class="fine">Template for the owner's use. Washington requires at least 90 days' written notice of any rent increase (RCW 59.18.140) and limits the amount of an increase (RCW 59.18.700). Have this wording and the delivery method reviewed by a Washington attorney before relying on it.</div>
</body></html>`;
}
