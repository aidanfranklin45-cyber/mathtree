/**
 * Rent-roll domain logic, ported from the legacy operations.html so the React page reports the same
 * numbers. Pure functions only (no fetching, no React): rows, occupancy, collections and escalation
 * status are all derived on the fly from the database facts (deals, leases, units, payments, increases).
 */

export type Row = Record<string, any>;

export interface RentRollInput {
  deals: Row[];
  leases: Row[];
  units: Row[];
  payments: Row[];
  increases: Row[];
  scope: 'owned' | 'all';
  entityId: string;   // 'all' or an entity id
  dealId: string;     // 'all' or a deal id
  activeDate: Date;   // billing month being viewed
  now?: Date;
}

export interface RentRollRow extends Row {
  is_vacant: boolean;
}

export interface EscalationInfo {
  leaseScheduledSteps: Row[];
  hasDefinedSchedule: boolean;
  nearestScheduled: Row | null;
  isScheduledDue: boolean;
  isAdvanceScheduled: boolean;
  isUnscheduledReviewDue: boolean;
  scheduledValStr: string;
}

export interface OperationsResult {
  rows: RentRollRow[];
  scopedLeases: Row[];
  scopedDeals: Row[];
  kpis: {
    monthlyRent: number;
    annualRent: number;
    occupancyPct: number;
    occupiedUnits: number;
    totalUnits: number;
    collectedPct: number;
    paidCount: number;
    pendingCount: number;
    overdueCount: number;
    escalationsDueCount: number;
    scheduledCount: number;
    earliestUpcomingStep: Row | null;
  };
}

export const formatPeriodMonth = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

const num = (v: unknown): number => {
  const p = parseFloat(String(v ?? ''));
  return isNaN(p) ? 0 : p;
};

const stepFromLease = (lease: Row): Row => ({
  effective_date: lease.next_escalation_date,
  increase_type: lease.escalation_type && String(lease.escalation_type).toLowerCase().includes('fixed') ? 'fixed_step' : 'percentage',
  scheduled_amount: lease.escalation_rate || 3.0,
});

/** Leases that exist only as JSON in a deal's inputs are surfaced as derived leases (legacy behaviour). */
function deriveLeasesFromInputs(deal: Row): Row[] {
  const inputs = deal.inputs || {};
  const dealTitle = String(deal.title || '').toLowerCase();
  const usable = (l: Row) =>
    num(l.monthlyRent) > 0 ||
    (l.tenantName && String(l.tenantName).trim() !== '' && String(l.tenantName).toLowerCase() !== dealTitle);

  const inputLeases: Row[] = (Array.isArray(inputs.leases) ? inputs.leases : []).filter(usable);
  const derived: Row[] = [];

  if (inputLeases.length > 0) {
    inputLeases.forEach((l, idx) => {
      const rent = num(l.monthlyRent);
      const start = l.leaseStartDate || inputs.leaseStartDate || inputs.closingDate || null;
      derived.push({
        id: `deal-lease-${deal.id}-${idx}`,
        user_id: deal.user_id,
        deal_id: deal.id,
        unit_id: `derived-unit-${deal.id}-${idx}`,
        tenant_name: l.tenantName || 'Commercial Tenant',
        tenant_email: l.tenantEmail || null,
        tenant_phone: l.tenantPhone || null,
        monthly_rent: rent,
        security_deposit: num(l.securityDeposit) || rent * 2,
        lease_start_date: start,
        lease_end_date: l.leaseEndDate || inputs.leaseExpiration || null,
        payment_due_day: Math.min(31, Math.max(1, parseInt(String(l.paymentDueDay ?? 1), 10) || 1)),
        grace_period_days: Math.max(0, parseInt(String(l.gracePeriodDays ?? 5), 10) || 0),
        last_rent_increase_date: start,
        previous_rent_amount: rent,
        escalation_type: l.escalationType || 'Percentage Bump (%)',
        escalation_rate: num(l.escalationRate) || 3.0,
        escalation_frequency: l.escalationFrequency || 'Annual on Anniversary',
        next_escalation_date: l.nextEscalationDate || null,
        is_active: true,
        is_derived: true,
        derived_unit_number: l.unitNumber || `Suite ${idx + 1}`,
        derived_unit_type: l.leaseType || inputs.facilityType || 'Commercial',
        derived_sqft: num(l.sqft),
      });
    });
    return derived;
  }

  const rent = num(inputs.monthlyRent || inputs.grossRentPerMonth || inputs.commercialRent || inputs.rent);
  if (rent > 0) {
    const start = inputs.leaseStartDate || inputs.closingDate || inputs.loiDate || (deal.created_at ? String(deal.created_at).split('T')[0] : null);
    derived.push({
      id: `deal-lease-${deal.id}`,
      user_id: deal.user_id,
      deal_id: deal.id,
      unit_id: `derived-unit-${deal.id}`,
      tenant_name: inputs.tenantName || 'In-Place Commercial Tenant',
      tenant_email: inputs.tenantEmail || null,
      tenant_phone: inputs.tenantPhone || null,
      monthly_rent: rent,
      security_deposit: inputs.securityDeposit || rent * 2,
      lease_start_date: start,
      lease_end_date: inputs.leaseExpiration || null,
      payment_due_day: Math.min(31, Math.max(1, parseInt(String(inputs.paymentDueDay ?? 1), 10) || 1)),
      grace_period_days: Math.max(0, parseInt(String(inputs.gracePeriodDays ?? 5), 10) || 0),
      last_rent_increase_date: inputs.leaseStartDate || inputs.closingDate || (deal.created_at ? String(deal.created_at).split('T')[0] : null),
      previous_rent_amount: rent,
      escalation_type: inputs.escalationType || 'Percentage Bump (%)',
      escalation_rate: num(inputs.rentGrowth ?? inputs.annualRentGrowth) || 3.0,
      escalation_frequency: inputs.escalationFrequency || 'Annual on Anniversary',
      next_escalation_date: inputs.nextEscalationDate || inputs.next_escalation_date || null,
      is_active: true,
      is_derived: true,
      derived_unit_number: inputs.unitNumber || 'Main Suite',
      derived_unit_type: inputs.useCode || inputs.facilityType || deal.asset_type || 'Commercial',
      derived_sqft: inputs.sqft || inputs.buildingSqFt || inputs.gla || 0,
    });
  }
  return derived;
}

/** Escalation / review status for one lease (drives the "Last Escalation" column). */
export function escalationInfo(lease: Row, increases: Row[], now: Date): EscalationInfo {
  // Earliest first, so the "nearest" step is the next one due rather than whichever row the database returned first.
  const leaseScheduledSteps = increases
    .filter((inc) => inc.lease_id === lease.id && inc.is_applied !== true)
    .sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)));
  const hasDefinedSchedule = Boolean(
    (lease.escalation_type && lease.escalation_type !== 'none') ||
      num(lease.escalation_rate) > 0 ||
      lease.next_escalation_date ||
      leaseScheduledSteps.length > 0,
  );

  let nearestScheduled: Row | null = leaseScheduledSteps.length > 0 ? leaseScheduledSteps[0] : null;
  if (!nearestScheduled && lease.next_escalation_date) nearestScheduled = stepFromLease(lease);

  const nextEscDate = nearestScheduled ? new Date(nearestScheduled.effective_date) : null;
  const isScheduledDue = Boolean(nextEscDate && nextEscDate <= now);
  const isAdvanceScheduled = Boolean(nextEscDate && nextEscDate > now);

  const refDate = lease.last_rent_increase_date ? new Date(lease.last_rent_increase_date) : new Date(lease.lease_start_date);
  const monthsSince = (now.getFullYear() - refDate.getFullYear()) * 12 + (now.getMonth() - refDate.getMonth());
  const isUnscheduledReviewDue = !hasDefinedSchedule && monthsSince >= 12;

  const scheduledValStr = nearestScheduled
    ? nearestScheduled.increase_type === 'fixed_step'
      ? `+$${nearestScheduled.scheduled_amount}`
      : `+${nearestScheduled.scheduled_amount}%`
    : '';

  return { leaseScheduledSteps, hasDefinedSchedule, nearestScheduled, isScheduledDue, isAdvanceScheduled, isUnscheduledReviewDue, scheduledValStr };
}

export function buildOperations(input: RentRollInput): OperationsResult {
  const { deals, leases, units, payments, increases, scope, entityId, dealId, activeDate } = input;
  const now = input.now ?? new Date();
  const period = formatPeriodMonth(activeDate);

  let scopedDeals = deals || [];
  if (scope === 'owned') scopedDeals = scopedDeals.filter((d) => (d.status || 'prospect') === 'owned');
  if (entityId !== 'all') scopedDeals = scopedDeals.filter((d) => d.entity_id === entityId);
  if (dealId !== 'all') scopedDeals = scopedDeals.filter((d) => d.id === dealId);

  const scopedLeases: Row[] = [];
  const rows: RentRollRow[] = [];
  let totalUnits = 0;
  let occupiedUnits = 0;

  scopedDeals.forEach((deal) => {
    const dealTitle = String(deal.title || '').toLowerCase();
    const dbLeases = (leases || []).filter((l) => l && l.deal_id === deal.id && l.is_active !== false);
    const activeDbLeases = dbLeases.filter(
      (l) => num(l.monthly_rent) > 0 || (l.tenant_name && String(l.tenant_name).trim() !== '' && String(l.tenant_name).toLowerCase() !== dealTitle),
    );
    const dealLeases = activeDbLeases.length > 0 ? activeDbLeases : deriveLeasesFromInputs(deal);

    const declaredUnits = parseInt(String(deal.inputs?.unitCount || deal.inputs?.numUnits || deal.inputs?.storageUnitCount || 0), 10) || 0;
    const dealUnits = Math.max(1, declaredUnits, (units || []).filter((u) => u.deal_id === deal.id).length, dealLeases.length);
    totalUnits += dealUnits;
    occupiedUnits += dealLeases.length;

    if (dealLeases.length > 0) {
      dealLeases.forEach((l) => {
        scopedLeases.push(l);
        rows.push({ ...l, is_vacant: false });
      });
    } else {
      rows.push({
        id: `vacant-${deal.id}`,
        deal_id: deal.id,
        is_vacant: true,
        tenant_name: '',
        monthly_rent: 0,
        unit_number: deal.inputs?.unitNumber || 'Main Parcel',
        unit_type: deal.inputs?.useCode || deal.inputs?.facilityType || deal.asset_class || 'Vacant / Unleased',
        sqft: deal.inputs?.sqft || deal.inputs?.buildingSqFt || 0,
      });
    }
  });

  const monthlyRent = scopedLeases.reduce((acc, l) => acc + num(l.monthly_rent), 0);
  const occupancyPct = totalUnits > 0 ? Math.min(100, Math.round((occupiedUnits / totalUnits) * 100)) : 0;

  // Collections for the viewed billing month
  let paidCount = 0;
  let pendingCount = 0;
  let overdueCount = 0;
  let totalDue = 0;
  let totalPaid = 0;
  const monthEnd = new Date(activeDate.getFullYear(), activeDate.getMonth() + 1, 1);
  scopedLeases.forEach((l) => {
    const p = (payments || []).find((pay) => pay.lease_id === l.id && pay.period_month === period);
    const due = num(l.monthly_rent);
    totalDue += due;
    if (p) {
      if (p.status === 'paid') {
        paidCount++;
        totalPaid += num(p.amount_paid) || due;
      } else if (p.status === 'overdue') overdueCount++;
      else pendingCount++;
    } else if (now > monthEnd) overdueCount++;
    else pendingCount++;
  });
  const collectedPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : scopedLeases.length === 0 ? 100 : 0;

  // Escalation scorecard
  let escalationsDueCount = 0;
  let scheduledCount = 0;
  let earliestUpcomingStep: Row | null = null;
  const earliest = (candidate: Row) => {
    if (!earliestUpcomingStep || new Date(candidate.effective_date) < new Date(earliestUpcomingStep.effective_date)) earliestUpcomingStep = candidate;
  };

  scopedLeases.forEach((lease) => {
    const leaseIncreases = (increases || []).filter((inc) => inc && inc.lease_id === lease.id && inc.is_applied !== true);
    const hasDefinedSchedule = Boolean(
      (lease.escalation_type && lease.escalation_type !== 'none') || num(lease.escalation_rate) > 0 || lease.next_escalation_date || leaseIncreases.length > 0,
    );
    const freq = String(lease.escalation_frequency || lease.term_type || lease.lease_term_type || 'annual').toLowerCase();
    const isAnnual = freq.includes('annual') || freq === 'yearly' || freq === 'anniversary';

    let hasDueStep = false;
    let hasUpcoming = false;

    if (isAnnual) {
      if (leaseIncreases.length > 0) {
        const sorted = [...leaseIncreases].sort((a, b) => +new Date(a.effective_date) - +new Date(b.effective_date));
        if (sorted.find((inc) => inc.effective_date && new Date(inc.effective_date) <= now)) hasDueStep = true;
        const nextFuture = sorted.find((inc) => inc.effective_date && new Date(inc.effective_date) > now);
        if (nextFuture) {
          hasUpcoming = true;
          earliest(nextFuture);
        }
      }
      const nextEsc = lease.next_escalation_date ? new Date(lease.next_escalation_date) : null;
      if (nextEsc) {
        if (nextEsc <= now) hasDueStep = true;
        else {
          hasUpcoming = true;
          earliest(stepFromLease(lease));
        }
      }
      if (hasDueStep) escalationsDueCount++;
      else if (hasUpcoming) scheduledCount++;
      else if (hasDefinedSchedule && !lease.last_rent_increase_date) scheduledCount++;
      else if (!hasDefinedSchedule) {
        const ref = lease.last_rent_increase_date || lease.lease_start_date;
        if (ref) {
          const r = new Date(ref);
          if ((now.getFullYear() - r.getFullYear()) * 12 + (now.getMonth() - r.getMonth()) >= 12) escalationsDueCount++;
        }
      }
    } else {
      leaseIncreases.forEach((inc) => {
        scheduledCount++;
        const eff = new Date(inc.effective_date);
        if (eff <= now) hasDueStep = true;
        else earliest(inc);
      });
      const nextEsc = lease.next_escalation_date ? new Date(lease.next_escalation_date) : null;
      if (nextEsc) {
        if (nextEsc <= now) hasDueStep = true;
        else earliest(stepFromLease(lease));
      }
      if (hasDueStep) escalationsDueCount++;
      else if (!hasDefinedSchedule) {
        const ref = lease.last_rent_increase_date || lease.lease_start_date;
        if (ref) {
          const r = new Date(ref);
          if ((now.getFullYear() - r.getFullYear()) * 12 + (now.getMonth() - r.getMonth()) >= 12) escalationsDueCount++;
        }
      }
    }
  });

  return {
    rows,
    scopedLeases,
    scopedDeals,
    kpis: {
      monthlyRent,
      annualRent: monthlyRent * 12,
      occupancyPct,
      occupiedUnits,
      totalUnits,
      collectedPct,
      paidCount,
      pendingCount,
      overdueCount,
      escalationsDueCount,
      scheduledCount,
      earliestUpcomingStep,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rent due dates. Rent is a recurring obligation, never "done": once a month is paid the next due date is simply next month's.
// ---------------------------------------------------------------------------------------------------------------------

export type DueState = 'upcoming' | 'due_today' | 'paid' | 'snoozed' | 'late' | 'overdue';

export interface DueInfo {
  dueDay: number;
  /** This month's due date (the date the current period's rent falls/fell due). */
  currentDue: Date;
  /** The next date rent falls due that still matters: this month's if still ahead and unpaid, otherwise next month's. */
  nextDue: Date;
  daysUntilNext: number;
  state: DueState;
  /** Days past the due date for an unpaid current period (0 if not late). */
  daysLate: number;
  /** Short human label for the state, e.g. "Paid through Mar", "Mar rent 7 days late". */
  summary: string;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY_MS = 86400000;
/** A date-only string ('2026-10-05') is that local calendar day; new Date() would read it as UTC and shift it back a day west of UTC. */
const localDay = (v: unknown): Date => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : startOfDay(new Date(v as any));
};
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
const monthShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });

/** The due date in a given month; a due day of 29-31 falls on the last day of shorter months. */
export function dueDateIn(year: number, month0: number, dueDay: number): Date {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(Math.max(1, Math.floor(dueDay) || 1), lastDay));
}

/**
 * Where does this lease stand on rent? `payment` is the payment record for the CURRENT calendar month (if any);
 * `today` is injected for testing.
 */
export function getDueInfo(lease: Row, payment: Row | undefined, today: Date = new Date()): DueInfo {
  const dueDay = Math.min(31, Math.max(1, parseInt(String(lease.payment_due_day ?? ''), 10) || 1));
  const grace = Math.max(0, parseInt(String(lease.grace_period_days ?? ''), 10) || 0);
  const day = startOfDay(today);
  const y = day.getFullYear();
  const m = day.getMonth();
  const currentDue = dueDateIn(y, m, dueDay);
  const followingDue = dueDateIn(y, m + 1, dueDay);

  const rent = num(lease.monthly_rent);
  const paid = !!payment && (payment.status === 'paid' || (rent > 0 && num(payment.amount_paid) >= rent));
  const snoozed = !paid && !!payment?.snooze_until && localDay(payment.snooze_until) >= day;
  const month = monthShort(currentDue);

  if (paid) {
    return { dueDay, currentDue, nextDue: followingDue, daysUntilNext: daysBetween(day, followingDue), state: 'paid', daysLate: 0, summary: `Paid through ${month}` };
  }

  const untilCurrent = daysBetween(day, currentDue);
  if (untilCurrent > 0) {
    return { dueDay, currentDue, nextDue: currentDue, daysUntilNext: untilCurrent, state: 'upcoming', daysLate: 0, summary: `${month} rent due in ${untilCurrent} day${untilCurrent === 1 ? '' : 's'}` };
  }
  if (untilCurrent === 0) {
    return { dueDay, currentDue, nextDue: currentDue, daysUntilNext: 0, state: 'due_today', daysLate: 0, summary: `${month} rent due today` };
  }

  const daysLate = -untilCurrent;
  const state: DueState = snoozed ? 'snoozed' : daysLate > grace ? 'overdue' : 'late';
  const summary = snoozed
    ? `${month} rent snoozed`
    : `${month} rent ${daysLate} day${daysLate === 1 ? '' : 's'} late${daysLate > grace ? ' (past grace)' : ''}`;
  return { dueDay, currentDue, nextDue: followingDue, daysUntilNext: daysBetween(day, followingDue), state, daysLate, summary };
}
