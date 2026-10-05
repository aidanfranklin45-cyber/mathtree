/**
 * The assumptions ledger for one property: every figure the numbers rest on, in two groups the owner can read at a glance.
 *
 * - `project`: what is specific to this property (its contract, its loan, its lease, and any figure the owner entered or took from a document)
 * - `standard`: where the owner's global underwriting standards are doing the work, either copied onto the property when it was created
 *   or followed live because the property states no figure of its own
 *
 * Pure. It reads what the property states, what the owner's profile fills in for it, and the engine's result, so every line says what the
 * figure is, where it came from, and what it does to this property's numbers. Nothing here is invented.
 */

import { KEYS, parseClosingDate, stated } from '../../../supabase/functions/_shared/inputRequirements';
import type { InputBasis } from '../../../supabase/functions/_shared/underwritingAssumptions';

export type LedgerGroup = 'project' | 'standard';
export type LedgerMode = 'entered' | 'document' | 'copied' | 'live' | 'assumed';

export interface LedgerRow {
  id: string;
  label: string;
  value: string;
  /** What this figure does to this property's numbers, in the property's own dollars. */
  effect?: string;
  group: LedgerGroup;
  mode: LedgerMode;
  /** The owner's reason, when they gave one. */
  reason?: string;
  /** Where it came from, in a few words. */
  source: string;
}

type Fmt = 'pct' | 'usd' | 'yrs' | 'text';

interface Def {
  id: string;
  label: string;
  fmt: Fmt;
  /** Input aliases the engine reads, first is canonical. */
  aliases: readonly string[];
  /** Keys under which the profile can fill this figure (and under which a basis is recorded). */
  fills?: readonly string[];
  /** A fact about the deal, not an assumption: it is never filled from the profile. */
  fact?: boolean;
}

const DEFS: Def[] = [
  { id: 'price', label: 'Purchase price', fmt: 'usd', aliases: ['purchasePrice'], fact: true },
  { id: 'down', label: 'Down payment', fmt: 'pct', aliases: ['downPaymentPercent'], fact: true },
  { id: 'rate', label: 'Interest rate', fmt: 'pct', aliases: ['interestRate'], fact: true },
  { id: 'term', label: 'Loan term', fmt: 'yrs', aliases: KEYS.amortization, fact: true },
  { id: 'vacancy', label: 'Vacancy and credit loss', fmt: 'pct', aliases: KEYS.vacancy, fills: ['vacancyRate'] },
  { id: 'expenses', label: 'Operating expense ratio', fmt: 'pct', aliases: KEYS.expenseRatio, fills: ['expenseRatio', 'operatingExpenseRatio'] },
  { id: 'rentGrowth', label: 'Rent growth', fmt: 'pct', aliases: KEYS.rentGrowth, fills: ['rentGrowth'] },
  { id: 'expenseGrowth', label: 'Expense growth', fmt: 'pct', aliases: ['expenseGrowth', 'expenseInflation', 'expenseGrowthRate', 'expenseGrowthPercent'], fills: ['expenseGrowth'] },
  { id: 'hold', label: 'Hold period', fmt: 'yrs', aliases: KEYS.hold, fills: ['exitYear'] },
  { id: 'exit', label: 'Exit cap rate', fmt: 'pct', aliases: KEYS.exitCap, fills: ['targetCapRate', 'targetExitCapRate'] },
  { id: 'appreciation', label: 'Appreciation', fmt: 'pct', aliases: ['appreciationRate'], fills: ['appreciationRate'] },
  { id: 'selling', label: 'Selling costs', fmt: 'pct', aliases: KEYS.sellingCost, fills: ['sellingCostPercent'] },
  { id: 'closingCosts', label: 'Buyer closing costs', fmt: 'usd', aliases: ['closingCosts'], fills: ['closingCosts'] },
  { id: 'reserve', label: 'Replacement reserve', fmt: 'usd', aliases: [...KEYS.capexAnnual, ...KEYS.capexPercent], fills: ['capexReserveAnnual', 'capexReservePercent'] },
  { id: 'management', label: 'Management fee', fmt: 'pct', aliases: ['managementFeePercent'], fills: ['managementFeePercent'] },
  { id: 'payroll', label: 'Payroll and marketing', fmt: 'pct', aliases: ['payrollMarketingPercent'], fills: ['payrollMarketingPercent'] },
  { id: 'taxes', label: 'Property taxes', fmt: 'usd', aliases: KEYS.taxes, fills: ['annualTaxes'] },
  { id: 'insurance', label: 'Insurance', fmt: 'usd', aliases: KEYS.insurance, fills: ['annualInsurance'] },
  { id: 'maintenance', label: 'Maintenance and upkeep', fmt: 'usd', aliases: KEYS.maintenance, fills: ['annualMaintenance'] },
  { id: 'utilities', label: 'Utilities (power, water, sewer, garbage)', fmt: 'usd', aliases: KEYS.utilities, fills: ['annualUtilities'] },
  { id: 'discount', label: 'Discount rate', fmt: 'pct', aliases: KEYS.discountRate, fills: ['discountRate'] },
];

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function show(v: number, fmt: Fmt, key?: string): string {
  if (fmt === 'usd') return money(v);
  if (fmt === 'pct') return `${Number(v.toFixed(2))}%`;
  if (fmt === 'yrs') return `${v} years`;
  return String(v);
}

interface Args {
  /** What the property itself states. */
  stored: Record<string, any>;
  /** What the engine will use: the stored figures plus the owner's assumptions for what is unstated. */
  prepared: Record<string, any>;
  /** The owner's assumptions the engine filled in for this property (key to value), and where each came from. */
  filled: Record<string, number>;
  filledBasis: Record<string, InputBasis>;
  assetClass: string;
  /** The engine's result for this property. */
  metrics: any;
  /** The weeks assumed between the analysis and closing when no closing date is entered. */
  assumedClosingWeeks?: number;
}

export function buildAssumptionLedger(a: Args): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const projections: any[] = Array.isArray(a.metrics?.projections) ? a.metrics.projections : [];
  const first = projections.find((p) => Number(p.operatingMonths) >= 12) ?? projections[0] ?? {};
  const last = projections[projections.length - 1] ?? {};
  const nnn = String(a.stored.leaseType ?? '') === 'NNN';
  const hasRent = Number(a.prepared.grossRentAnnual) > 0 || (Array.isArray(a.prepared.leases) && a.prepared.leases.length > 0);

  const effects: Record<string, string | undefined> = {
    vacancy: first.vacancyLoss != null ? `${money(first.vacancyLoss)} a year of rent not collected` : undefined,
    expenses: first.operatingExpenses != null ? `${money(first.operatingExpenses)} a year of operating expenses` : undefined,
    rentGrowth: first.grossPotentialIncome != null && last.grossPotentialIncome != null && projections.length > 1
      ? `Rent goes from ${money(first.grossPotentialIncome)} to ${money(last.grossPotentialIncome)} a year over the hold` : undefined,
    hold: last.calendarYear != null ? `Sale assumed in ${last.calendarYear}` : undefined,
    exit: last.propertyValue != null ? `Sale value ${money(last.propertyValue)} at the end of year ${projections.length}` : undefined,
    appreciation: last.propertyValue != null ? `Sale value ${money(last.propertyValue)} at the end of year ${projections.length}` : undefined,
    selling: last.propertyValue != null && stated(a.prepared, ...KEYS.sellingCost) !== undefined
      ? `${money(last.propertyValue * (stated(a.prepared, ...KEYS.sellingCost) as number) / 100)} comes off the sale proceeds` : undefined,
    closingCosts: 'Paid at purchase, on top of the price',
    reserve: first.capexReserve != null ? `${money(first.capexReserve)} a year set aside from cash flow` : undefined,
    management: a.prepared.manageProperty ? 'Charged on collected income' : 'Not charged: you manage it yourself',
    taxes: nnn ? 'Tenants reimburse this while leased; you carry it if the space is vacant' : 'A cost of owning it, carried by you',
    insurance: nnn ? 'Tenants reimburse this while leased; you carry it if the space is vacant' : 'A cost of owning it, carried by you',
    maintenance: nnn ? 'Tenants reimburse this while leased; you carry it if the space is vacant' : 'A cost of owning it, carried by you',
    utilities: nnn ? 'Tenants pay their own while leased; you carry it if the space is vacant' : 'Carried by you while the space has no tenant',
    discount: a.metrics?.npv != null ? `Discounts the cash flows to an NPV of ${money(a.metrics.npv)}` : undefined,
    price: a.metrics?.initialCashInvested != null ? `Your total cash in at closing is ${money(a.metrics.initialCashInvested)} (down payment plus closing costs)` : undefined,
    down: a.metrics?.loanAmount != null ? `Borrowing ${money(a.metrics.loanAmount)}` : undefined,
    rate: a.metrics?.monthlyMortgagePayment != null ? `${money(a.metrics.monthlyMortgagePayment)} a month principal and interest` : undefined,
    term: 'Paid off at the end of the term, counted from the closing date',
  };

  const relevant = (d: Def): boolean => {
    if (d.id === 'management') return Boolean(a.prepared.manageProperty);
    if (d.id === 'payroll') return a.assetClass === 'storage';
    if (d.id === 'rentGrowth') return !(Array.isArray(a.prepared.leases) && a.prepared.leases.length > 0) || stated(a.stored, ...KEYS.rentGrowth) !== undefined;
    if (d.id === 'expenseGrowth') return stated(a.prepared, ...d.aliases) !== undefined;
    if (d.id === 'exit') return a.assetClass === 'commercial' || a.assetClass === 'storage';
    if (d.id === 'appreciation') return a.assetClass !== 'commercial' && a.assetClass !== 'storage';
    if (['taxes', 'insurance', 'maintenance', 'utilities'].includes(d.id)) return nnn || !hasRent || stated(a.stored, ...d.aliases) !== undefined;
    return true;
  };

  for (const d of DEFS) {
    if (!relevant(d)) continue;
    const effective = stated(a.prepared, ...d.aliases);
    if (effective === undefined) continue; // nothing to say yet; the Inputs needed screen covers what is missing

    // The reserve can be stated as a share of income; say so
    const reserveIsPercent = d.id === 'reserve' && stated(a.prepared, ...KEYS.capexAnnual) === undefined;
    const value = reserveIsPercent ? `${Number(effective.toFixed(2))}% of income` : show(effective, d.fmt);

    const filledKey = d.fills?.find((k) => k in a.filled);
    if (filledKey) {
      const b = a.filledBasis[filledKey];
      rows.push({
        id: d.id, label: d.label, value, effect: effects[d.id], group: 'standard', mode: 'live', reason: b?.rationale,
        source: b?.source === 'county_record' ? 'County value times your rate (follows your profile)' : 'Your profile (follows it)',
      });
      continue;
    }

    // Stated on the property: was it copied from the profile when created, taken from a document, or entered by the owner?
    const basis: InputBasis | undefined = d.fills?.map((k) => a.stored.assumptionBasis?.[k] as InputBasis | undefined).find(Boolean);
    const sameAsBasis = basis !== undefined && basis.value !== undefined && Math.abs(Number(basis.value) - effective) < 1e-9;
    if (!d.fact && sameAsBasis && (basis!.source === 'profile' || basis!.source === 'county_record')) {
      rows.push({ id: d.id, label: d.label, value, effect: effects[d.id], group: 'standard', mode: 'copied', reason: basis!.rationale, source: basis!.source === 'county_record' ? 'County value times your rate (copied)' : 'Your profile (copied when created)' });
    } else if (sameAsBasis && basis!.source === 'document') {
      rows.push({ id: d.id, label: d.label, value, effect: effects[d.id], group: 'project', mode: 'document', reason: basis!.rationale, source: 'From a document' });
    } else {
      rows.push({ id: d.id, label: d.label, value, effect: effects[d.id], group: 'project', mode: 'entered', reason: basis?.source === 'owner' ? basis.rationale : undefined, source: 'Your entry for this property' });
    }
  }

  // The closing date: entered, or assumed from the owner's setting
  const closing = parseClosingDate(a.stored.closingDate);
  if (closing && a.stored.closingDateSource === 'assumed') {
    rows.splice(1, 0, { id: 'closing', label: 'Closing date', value: String(a.stored.closingDate).slice(0, 10), effect: 'Year 1 starts here; the loan is paid down from here', group: 'standard', mode: 'assumed', source: 'Assumed when the project was created (your profile setting)' });
  } else if (closing) {
    rows.splice(1, 0, { id: 'closing', label: 'Closing date', value: String(a.stored.closingDate).slice(0, 10), effect: 'Year 1 starts here; the loan is paid down from here', group: 'project', mode: 'entered', source: 'Your entry for this property' });
  } else if (parseClosingDate(a.prepared.closingDate) && a.assumedClosingWeeks !== undefined) {
    rows.push({ id: 'closing', label: 'Closing date', value: String(a.prepared.closingDate).slice(0, 10), effect: 'No date entered: assumed from the day the analysis is run, so the loan schedule has a start', group: 'standard', mode: 'assumed', source: `Your profile: ${a.assumedClosingWeeks} weeks after the analysis` });
  }

  // The lease structure and the rent, which are facts about this property
  if (a.stored.leaseType) rows.push({ id: 'lease', label: 'Lease structure', value: String(a.stored.leaseType), effect: nnn ? 'Tenants pay the building\'s costs, so the landlord\'s expense ratio is small' : undefined, group: 'project', mode: 'entered', source: 'Your entry for this property' });
  if (Number(a.prepared.grossRentAnnual) > 0) rows.push({ id: 'rent', label: 'Gross rent', value: `${money(Number(a.prepared.grossRentAnnual))} a year`, group: 'project', mode: 'entered', source: Array.isArray(a.stored.leases) && a.stored.leases.length > 0 ? `${a.stored.leases.length} lease${a.stored.leases.length === 1 ? '' : 's'} on this property` : 'Your entry for this property' });

  return rows;
}
