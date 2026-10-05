import { isLeaseInForce, isoDay, leaseMonthlyRent } from '@engine/leaseInForce';
import { paymentsByMonth, type PaymentLite } from '../baselines/core';
import {
  COLLECTED_WINDOW_MONTHS,
  MIN_COLLECTED_MONTHS,
  type CollectedRent,
  type Figure,
  type PropertyEstimate,
  type PropertyFacts,
  type PropertyState,
} from './types';

type Row = Record<string, any>;

/**
 * The one authority for a property's current state. Pure: deal facts, rent-roll and payment rows, and the engine's forecast go in;
 * one labelled state comes out. Owned deals read the `leases` and `units` tables as the only rent roll and real payments as actuals;
 * prospects read their underwriting assumptions. Unknown stays null, and every figure says whether it is estimated or collected.
 * It never writes anything back.
 */
export function resolvePropertyState(args: {
  deal: Row;
  facts: PropertyFacts | null;
  asOf: Date;
  estimate: PropertyEstimate;
}): PropertyState {
  const { deal, facts, asOf, estimate } = args;
  const owned = deal.status === 'owned';
  const isDemo = !!deal.is_demo;
  const today = isoDay(asOf);

  const estimated = (value: number, note?: string): Figure => ({ value, basis: 'estimated', note });

  // ---- Rent roll: tables for owned deals, assumptions for prospects ----
  let source: PropertyState['rentRoll']['source'];
  let leases: Row[];
  if (owned) {
    const rows = facts ? facts.leases.filter((l) => l && l.deal_id === deal.id) : [];
    source = rows.length > 0 ? 'tables' : 'none';
    leases = rows.filter((l) => isLeaseInForce(l, today));
  } else {
    const rows: Row[] = Array.isArray(deal.inputs?.leases) ? deal.inputs.leases : [];
    source = rows.length > 0 ? 'inputs' : 'none';
    leases = rows.filter((l) => isLeaseInForce(l, today));
  }
  const rents = leases.map(leaseMonthlyRent);
  const monthlyRent = rents.some((r) => r !== null) ? rents.reduce<number>((s, r) => s + (r ?? 0), 0) : null;

  // ---- Occupancy: units on the units table that have a lease in force ----
  const units = owned && facts ? facts.units.filter((u) => u && u.deal_id === deal.id) : [];
  const unitIds = new Set(units.map((u) => u.id));
  const occupiedUnits = new Set(leases.map((l) => l.unit_id).filter((id) => id && unitIds.has(id))).size;
  const occupancy: PropertyState['occupancy'] = !owned
    ? { value: null, basis: 'estimated', note: 'Not owned yet: no actual occupancy.', occupiedUnits: 0, totalUnits: 0 }
    : units.length === 0
      ? { value: null, basis: 'contracted', note: 'No units recorded for this property.', occupiedUnits: 0, totalUnits: 0 }
      : { value: Math.round((occupiedUnits / units.length) * 1000) / 10, basis: 'contracted', note: `${occupiedUnits} of ${units.length} units have a lease in force.`, occupiedUnits, totalUnits: units.length };

  // ---- Collected rent: real payments, owned and non-demo only ----
  const collected = owned && !isDemo && facts ? collectedRent(facts.payments.filter((p) => p && p.deal_id === deal.id), asOf) : null;

  // ---- Headline figures ----
  const value = estimated(estimate.value, 'Purchase price grown at the appreciation rate; no appraisal is recorded.');
  let noi: Figure = estimated(estimate.noi, 'Underwriting forecast.');
  let cashFlow: Figure = estimated(estimate.cashFlow, 'Underwriting forecast.');
  if (owned && collected?.annualised != null && estimate.operatingExpenses !== null) {
    const n = collected.annualised - estimate.operatingExpenses;
    noi = {
      value: n,
      basis: 'blended',
      note: `Rent collected over the last ${collected.months} months, annualised, less the underwritten operating expenses.`,
    };
    cashFlow = { value: n - estimate.debtService, basis: 'blended', note: 'That NOI less scheduled debt service.' };
  } else if (owned) {
    const why = isDemo ? 'Demo deal: no actuals.' : collected && collected.annualised != null ? 'No expense figure to pair with collected rent.' : collected ? `Only ${collected.months} months of rent recorded; ${MIN_COLLECTED_MONTHS} needed.` : 'No rent payments recorded.';
    noi = estimated(estimate.noi, `Underwriting forecast. ${why}`);
    cashFlow = estimated(estimate.cashFlow, `Underwriting forecast. ${why}`);
  }

  return {
    stage: owned ? 'owned' : 'prospect',
    asOf: today,
    isDemo,
    rentRoll: { source, inForceCount: leases.length, monthlyRent },
    occupancy,
    collected,
    value,
    noi,
    cashFlow,
  };
}

const monthIndex = (iso: string): number => parseInt(iso.slice(0, 4), 10) * 12 + parseInt(iso.slice(5, 7), 10) - 1;
const inWindow = (month: string, last: number): boolean => monthIndex(month) <= last && monthIndex(month) > last - COLLECTED_WINDOW_MONTHS;

/**
 * Rent received in the 12 months ending at `asOf`, from the same per-month totals the baseline comparison uses. A month counts only
 * once a rent charge for it was due by `asOf`. Null when there are none.
 */
function collectedRent(payments: Row[], asOf: Date): CollectedRent | null {
  const today = isoDay(asOf);
  const last = monthIndex(today);
  const due = payments.filter((p) => /^\d{4}-\d{2}/.test(String(p.period_month ?? '')) && isoDay(p.due_date ?? p.period_month) <= today);
  const byMonth = paymentsByMonth(due as PaymentLite[]);
  const rows = [...byMonth.entries()].filter(([m]) => inWindow(m, last));
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, [, r]) => sum + r.paid, 0);
  const billed = rows.reduce((sum, [, r]) => sum + r.due, 0);
  return { months: rows.length, total, billed, annualised: rows.length >= MIN_COLLECTED_MONTHS ? (total / rows.length) * 12 : null };
}
