/**
 * "Underwrite from this rent roll": turns a property's tenant-by-tenant rent roll (the lease and unit records) into the deal inputs the
 * engine reads (one lease per tenant, each with its own rent), so a multi-tenant prospect is analysed on what each tenant really pays.
 *
 * This is a deliberate, one-way copy made by the owner for a deal that is still being underwritten. It is never automatic, and an owned
 * deal's underwriting stays frozen in its baseline. Pure (no database, no UI) so it can be tested.
 */

import { isLeaseInForce, leaseStatusOn } from '@engine/leaseInForce';

type Rec = Record<string, any>;

export interface RentRollSummary {
  tenants: number;
  vacantUnits: number;
  /** Fixed-term leases already past their end date: not in force, so not underwritten. (Leases not yet started are left out too.) */
  expiredLeases: number;
  monthlyRent: number;
  annualRent: number;
  averageRent: number;
  monthToMonth: number;
  /** Earliest and latest lease end among fixed terms (YYYY-MM-DD), for a quick look at the expiry spread. */
  firstExpiry: string | null;
  lastExpiry: string | null;
}

export interface RentRollUnderwriting {
  /** Merged into the deal's inputs when the owner saves. */
  patch: Record<string, any>;
  summary: RentRollSummary;
  warnings: string[];
}

const day = (v: unknown): string => {
  const m = String(v ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function rentRollToInputs(args: { leases: Rec[]; units: Rec[]; today: string; assetClass: string }): RentRollUnderwriting {
  const { units, today } = args;
  const unitById = new Map(units.map((u) => [u.id, u]));
  const warnings: string[] = [];

  const active = args.leases.filter((l) => l && l.is_active !== false);
  const inForce = active.filter((l) => isLeaseInForce(l, today));
  const expired = active.filter((l) => leaseStatusOn(l, today) === 'ended').length;
  const notStarted = active.filter((l) => leaseStatusOn(l, today) === 'not_started').length;

  inForce.sort((a, b) => natural(String(unitById.get(a.unit_id)?.unit_number ?? a.tenant_name ?? ''), String(unitById.get(b.unit_id)?.unit_number ?? b.tenant_name ?? '')));

  const leases = inForce.map((l) => {
    const rent = Number(l.monthly_rent) || 0;
    const m2m = l.term_type === 'month_to_month';
    const pct = Number(l.escalation_rate) || 0;
    const escalating = pct > 0 && !m2m && !!l.escalation_type;
    return {
      tenantName: String(l.tenant_name || 'Tenant'),
      unit: String(unitById.get(l.unit_id)?.unit_number ?? ''),
      monthlyRent: rent,
      annualRent: rent * 12,
      leaseStartDate: day(l.lease_start_date),
      leaseEndDate: m2m ? '' : day(l.lease_end_date),
      termType: m2m ? 'month_to_month' : 'fixed',
      leaseType: String(l.lease_type || 'Gross'),
      escalationType: escalating ? String(l.escalation_type) : '',
      escalationRate: escalating ? pct : 0,
      escalationFrequency: escalating ? String(l.escalation_frequency || 'Annual on Anniversary') : '',
      nextEscalationDate: escalating ? day(l.next_escalation_date) : '',
      paymentDueDay: Number(l.payment_due_day) || 1,
      gracePeriodDays: Number(l.grace_period_days ?? 5),
      is_active: true,
    };
  });

  const monthlyRent = leases.reduce((s, l) => s + l.monthlyRent, 0);
  const occupiedUnitIds = new Set(inForce.map((l) => l.unit_id).filter(Boolean));
  const vacantUnits = units.filter((u) => !occupiedUnitIds.has(u.id)).length;
  const ends = leases.filter((l) => l.leaseEndDate).map((l) => l.leaseEndDate).sort();
  const monthToMonth = leases.filter((l) => l.termType === 'month_to_month').length;

  const summary: RentRollSummary = {
    tenants: leases.length,
    vacantUnits,
    expiredLeases: expired,
    monthlyRent,
    annualRent: monthlyRent * 12,
    averageRent: leases.length > 0 ? monthlyRent / leases.length : 0,
    monthToMonth,
    firstExpiry: ends[0] ?? null,
    lastExpiry: ends[ends.length - 1] ?? null,
  };

  if (leases.length === 0) warnings.push('There are no tenants in force in this rent roll yet. Add them in Operations, then come back.');
  if (vacantUnits > 0) warnings.push(`${vacantUnits} vacant ${vacantUnits === 1 ? 'unit earns' : 'units earn'} nothing in the projection. The deal's vacancy setting still applies on top, as general vacancy and credit loss.`);
  if (expired > 0) warnings.push(`${expired} fixed-term ${expired === 1 ? 'lease has' : 'leases have'} already ended and ${expired === 1 ? 'is' : 'are'} left out. Renew or mark ${expired === 1 ? 'it' : 'them'} month to month in the rent roll if the tenant stayed.`);
  if (notStarted > 0) warnings.push(`${notStarted} ${notStarted === 1 ? 'lease has' : 'leases have'} not started yet and ${notStarted === 1 ? 'is' : 'are'} left out until the start date.`);
  if (monthToMonth > 0) warnings.push(`${monthToMonth} month-to-month ${monthToMonth === 1 ? 'tenant has' : 'tenants have'} no end date, so no lease-expiry assumption applies to ${monthToMonth === 1 ? 'it' : 'them'}.`);
  if (leases.length > 30) warnings.push('This is a large rent roll. The analysis and Monte Carlo will run more slowly than for a small one.');

  const patch: Record<string, any> = {
    leases,
    grossRentAnnual: monthlyRent * 12,
    grossRentPerMonth: monthlyRent,
    monthlyRent,
    rentRollSource: 'rent_roll',
    rentRollAsOf: today,
    rentRollTenantCount: leases.length,
  };
  if ((args.assetClass === 'multi-unit' || args.assetClass === 'storage') && units.length > 0) {
    patch.unitCount = units.length;
    if (args.assetClass === 'storage') patch.storageUnitCount = units.length;
  }

  return { patch, summary, warnings };
}
