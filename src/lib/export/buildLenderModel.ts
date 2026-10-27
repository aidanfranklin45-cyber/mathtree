import type { BriefModel } from './buildBriefModel';
import { calculateLenderMetrics, type LenderMetrics } from '../engine';
import { isLeaseInForce } from '@engine/leaseInForce';
import type { BriefLease } from './buildBriefModel';

/**
 * The lender view of a deal. It adds nothing of its own to the math: every figure is the brief's, or comes from the shared engine's
 * lender metrics. What it does is arrange them in the order a loan officer asks, and say "Not provided" for what the sponsor has not stated.
 */

export interface LenderProfile {
  /** The borrowing entity (the primary company in the profile), when there is one. */
  entityName: string | null;
  fullName: string | null;
  minDscr: number;
  sponsorExperience: string;
  sponsorLiquidity: number | null;
  sponsorNetWorth: number | null;
}

export interface SourceUseLine { label: string; amount: number; pct: number }

export interface LenderModel {
  brief: BriefModel;
  metrics: LenderMetrics;
  minDscr: number;
  borrower: { entity: string | null; principal: string | null; experience: string | null; liquidity: number | null; netWorth: number | null };
  request: { amount: number; purpose: string; rate: number; termYears: number; basis: 'LTV' | 'LTC'; leveragePct: number };
  uses: SourceUseLine[];
  sources: SourceUseLine[];
  totalUses: number;
  /** Total sources minus total uses; zero when the two sides tie to the dollar. */
  unreconciled: number;
  /** Loan over the county's assessed value: a fact from the parcel, not an appraisal. Null without a county value. */
  ltvAssessedPct: number | null;
  coverage: { status: 'meets' | 'below' | 'none'; text: string };
  tenancy: {
    /** The leases in force at the end of the first full year: the tenancy the stabilized income comes from. */
    leases: BriefLease[];
    leaseCount: number;
    /** Lease periods on the deal that are not in force then (an earlier intercompany period, for example): noted, never counted as tenants. */
    earlierPeriods: number;
    earliestEnd: string | null; latestEnd: string | null; endingBeforeHold: number; holdEndYear: number | null; singleTenant: boolean;
  };
  flags: Array<{ title: string; description: string }>;
}

const year = (s: string | null): number | null => { const t = s ? new Date(s).getTime() : NaN; return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null; };

export function buildLenderModel(brief: BriefModel, profile: LenderProfile): LenderModel {
  const metrics = calculateLenderMetrics(brief.assetClass, brief.monteCarloInputs);
  const dscr = metrics.dscr;

  const totalUses = brief.price + brief.rehabCosts + brief.closingCosts;
  const line = (label: string, amount: number, of: number): SourceUseLine => ({ label, amount, pct: of > 0 ? (amount / of) * 100 : 0 });
  const uses = [
    line('Purchase price', brief.price, totalUses),
    ...(brief.rehabCosts > 0 ? [line('Renovation', brief.rehabCosts, totalUses)] : []),
    ...(brief.closingCosts > 0 ? [line('Buyer closing costs', brief.closingCosts, totalUses)] : []),
  ];
  const sources = [line('Senior loan', brief.loanAmt, totalUses), line('Borrower equity', brief.equity, totalUses)];
  const unreconciled = Math.round((brief.loanAmt + brief.equity - totalUses) * 100) / 100;

  const dscrRounded = dscr === null ? null : Math.round(dscr * 100) / 100;
  const coverage: LenderModel['coverage'] = dscrRounded === null
    ? { status: 'none', text: 'There is no senior debt in this structure, so there is no coverage ratio to test.' }
    : dscrRounded >= profile.minDscr
      ? { status: 'meets', text: `Debt service coverage of ${dscrRounded.toFixed(2)}x meets the ${profile.minDscr.toFixed(2)}x minimum${dscrRounded - profile.minDscr < 0.1 ? ', with little room to spare' : ''}.` }
      : { status: 'below', text: `Debt service coverage of ${dscrRounded.toFixed(2)}x is below the ${profile.minDscr.toFixed(2)}x minimum.` };

  // Tenancy: facts from the underwriting leases and the rent roll, against the end of the hold
  // A deal can carry several lease periods (for example intercompany rent before a formal lease). The tenants behind the stabilized income are the
  // leases in force on the last day of the first full year; if none is, every lease that has content stands (the same rule as the tenant count elsewhere).
  const allLeases = brief.underwritingLeases.length > 0 ? brief.underwritingLeases : brief.rentRoll;
  const asOf = metrics.basisYear > 0 ? `${metrics.basisYear}-12-31` : null;
  const running = asOf ? allLeases.filter((l) => isLeaseInForce({ leaseStartDate: l.start, leaseEndDate: l.end }, asOf)) : [];
  const leases = running.length > 0 ? running : allLeases;
  const ends = leases.map((l) => l.end).filter((e): e is string => !!e).sort();
  const closeYear = year(brief.closingDate) ?? brief.startYear;
  const holdEndYear = Number.isFinite(closeYear) ? closeYear + brief.holdYears : null;
  const endingBeforeHold = holdEndYear === null ? 0 : leases.filter((l) => { const y = year(l.end); return y !== null && y < holdEndYear; }).length;
  const tenancy: LenderModel['tenancy'] = {
    leases,
    leaseCount: leases.length,
    earlierPeriods: allLeases.length - leases.length,
    earliestEnd: ends[0] ?? null,
    latestEnd: ends[ends.length - 1] ?? null,
    endingBeforeHold,
    holdEndYear,
    singleTenant: leases.length === 1,
  };

  const flags = [...brief.warnings];
  if (tenancy.singleTenant) {
    flags.push({ title: 'Single-Tenant Income', description: `All underwritten rent comes from one tenant${tenancy.latestEnd ? `, whose lease ends ${tenancy.latestEnd}` : ''}.` });
  }
  if (tenancy.endingBeforeHold > 0) {
    flags.push({ title: 'Lease Expiry Inside The Hold', description: `${tenancy.endingBeforeHold} of ${tenancy.leaseCount} lease${tenancy.leaseCount === 1 ? '' : 's'} end${tenancy.endingBeforeHold === 1 ? 's' : ''} before the ${brief.holdYears}-year hold does (earliest ${tenancy.earliestEnd}).` });
  }
  if (brief.isProrated) {
    flags.push({ title: 'Partial First Year', description: `Year 1 holds ${Number(brief.p0.operatingMonths)} months of operation; coverage and yield figures are read from the first full year (${metrics.basisYear}).` });
  }
  if (metrics.breakEvenOccupancyPct !== null && metrics.breakEvenOccupancyPct > 85) {
    flags.push({ title: 'High Break-Even Occupancy', description: `The property must collect ${metrics.breakEvenOccupancyPct.toFixed(0)}% of potential rent to pay operating costs and debt service.` });
  }

  const purpose = brief.rehabCosts > 0 ? 'Acquisition and renovation' : 'Acquisition';
  const basis: 'LTV' | 'LTC' = brief.rehabMode === 'roll_into_loan' ? 'LTC' : 'LTV';

  return {
    brief,
    metrics,
    minDscr: profile.minDscr,
    borrower: {
      entity: profile.entityName,
      principal: profile.fullName,
      experience: profile.sponsorExperience.trim() ? profile.sponsorExperience.trim() : null,
      liquidity: profile.sponsorLiquidity,
      netWorth: profile.sponsorNetWorth,
    },
    request: { amount: brief.loanAmt, purpose, rate: brief.interestRate, termYears: brief.loanTerm, basis, leveragePct: brief.ltvPct },
    uses,
    sources,
    totalUses,
    unreconciled,
    ltvAssessedPct: brief.parcelTotals.assessed > 0 && brief.loanAmt > 0 ? (brief.loanAmt / brief.parcelTotals.assessed) * 100 : null,
    coverage,
    tenancy,
    flags,
  };
}

/**
 * What the lender brief may say about the borrower, from the investor profile. The profile's placeholder name ("Investor") and company
 * ("MathTree Capital") are defaults, not facts, so they never print as the borrower; only a named primary entity does.
 */
export function lenderProfileFrom(p: {
  fullName?: string; companyName?: string; primaryEntityId?: string | null;
  associatedCompanies?: Array<{ id: string; name: string; is_primary?: boolean }>;
  minDscr: number; sponsorExperience: string; sponsorLiquidity: number | null; sponsorNetWorth: number | null;
}): LenderProfile {
  const entity = (p.associatedCompanies ?? []).find((c) => c.is_primary || c.id === p.primaryEntityId)?.name ?? null;
  const name = (p.fullName ?? '').trim();
  return {
    entityName: entity && entity.trim() ? entity.trim() : null,
    fullName: name && name !== 'Investor' ? name : null,
    minDscr: p.minDscr,
    sponsorExperience: p.sponsorExperience,
    sponsorLiquidity: p.sponsorLiquidity,
    sponsorNetWorth: p.sponsorNetWorth,
  };
}
