// CAM year-end reconciliation and submeter billing math. Pure (no Deno / network) so it can be tested. Tracking only:
// nothing here feeds underwriting.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface CamReconInput {
  /** Total CAM expenses the property actually incurred for the year. */
  totalExpenses: number;
  /** Tenant's pro-rata share, percent 0-100. */
  sharePct: number;
  /** CAM estimates the tenant paid during the year. */
  estimatesPaid: number;
  /** Lease cap on year-over-year CAM growth, percent (e.g. 5), or null for no cap. */
  capPct?: number | null;
  /** What the tenant was billed for CAM last year; the cap needs this as its base. Ignored without a cap. */
  priorYearBilled?: number | null;
  /** Landlord's administrative fee on top of CAM, percent of the tenant's share (e.g. 10). */
  adminFeePct?: number | null;
}

export interface CamReconResult {
  /** Tenant's share of actual expenses plus admin fee, before any cap. */
  uncappedCharge: number;
  /** What the tenant owes for the year after the cap. */
  charge: number;
  capApplied: boolean;
  /** Positive: tenant owes the landlord. Negative: landlord owes the tenant a refund. */
  trueUp: number;
}

/** Year-end true-up: what the tenant should have paid for the year, less what the estimates already covered. */
export function reconcileCam(input: CamReconInput): CamReconResult {
  const share = Math.min(100, Math.max(0, Number(input.sharePct) || 0)) / 100;
  const adminFee = Math.max(0, Number(input.adminFeePct) || 0) / 100;
  const uncapped = round2((Number(input.totalExpenses) || 0) * share * (1 + adminFee));

  const hasCap = input.capPct != null && Number(input.capPct) >= 0 && Number(input.priorYearBilled) > 0;
  const ceiling = hasCap ? round2(Number(input.priorYearBilled) * (1 + Number(input.capPct) / 100)) : null;
  const capApplied = ceiling != null && uncapped > ceiling;
  const charge = capApplied ? (ceiling as number) : uncapped;

  return { uncappedCharge: uncapped, charge, capApplied, trueUp: round2(charge - (Number(input.estimatesPaid) || 0)) };
}

export interface MeterChargeInput {
  previousReading: number;
  currentReading: number;
  /** Price per unit of usage (kWh, gallon, ccf, ...). */
  ratePerUnit: number;
  /** Meter multiplier for CT/scaled meters; 1 for a normal meter. */
  multiplier?: number | null;
  /** Fixed monthly service charge added to the usage charge, if any. */
  baseCharge?: number | null;
}

export interface MeterChargeResult {
  usage: number;
  charge: number;
  error: string | null;
}

/** Usage and charge for one reading. A current reading below the previous one is rejected rather than billed as negative. */
export function meterCharge(input: MeterChargeInput): MeterChargeResult {
  const prev = Number(input.previousReading);
  const curr = Number(input.currentReading);
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return { usage: 0, charge: 0, error: 'Enter both readings.' };
  if (curr < prev) return { usage: 0, charge: 0, error: 'Current reading is lower than the previous reading (meter rollover or typo?).' };
  const usage = round2((curr - prev) * (Number(input.multiplier) > 0 ? Number(input.multiplier) : 1));
  const charge = round2(usage * (Number(input.ratePerUnit) || 0) + (Number(input.baseCharge) || 0));
  return { usage, charge, error: null };
}

/** Sum of CAM (or any category) estimates the tenant actually paid within a calendar year. */
export function estimatesPaidInYear(
  items: Array<{ due_date: string; paid_date?: string | null; amount_actual?: number | null; amount_expected?: number | null }>,
  year: number,
): number {
  const prefix = `${year}-`;
  return round2(items
    .filter((i) => i.paid_date && String(i.paid_date).startsWith(prefix))
    .reduce((s, i) => s + (Number(i.amount_actual ?? i.amount_expected) || 0), 0));
}
