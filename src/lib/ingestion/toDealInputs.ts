/**
 * Parsed documents in, engine inputs out. This is the one place that turns intake payloads into the keys the engine actually reads
 * (`src/lib/engine`, `supabase/functions/_shared/math-engine.ts`), so a parser can never write a key the engine silently ignores.
 *
 * Rules:
 * - Only engine-read keys go into `patch`. Everything else stays in `claims` (broker figures, to test, never adopted) or `notes`.
 * - Nothing is invented. A value the documents do not give is listed in `missing`, not defaulted.
 * - Precedence by reliability: an executed document (lease, purchase agreement) beats a reported one (rent roll, T12), which beats a
 *   projected one (offering memorandum, loan quote). A lower-reliability value never overwrites a higher one.
 * - The owner confirms the patch on the review screen before anything is saved. This module only proposes.
 */

import type { ExpenseCategory, IntakeDocument, LeaseIntake, LoanTermsIntake, OfferingMemorandumIntake, OperatingStatementIntake, Reliability, RentRollIntake } from './intake';
import { missing as missingValue, val } from './intake';
import { DOCUMENT_PROFILES } from './documentTypes';
import { leaseMonthlyRent, rentRollTotals, rowMonthlyRent, statementTotals } from './normalize';
import { checkEngineInputs, type MissingInput } from '../../../supabase/functions/_shared/inputRequirements';
import { TRACKED_INPUTS, type InputBasis } from '../../../supabase/functions/_shared/underwritingAssumptions';

export interface FieldProvenance {
  documentType: IntakeDocument['documentType'];
  reliability: Reliability;
  /** How the value was arrived at, in one line, for the review screen. */
  how: string;
}

export interface DealPatch {
  /** Merged into the deal's inputs when the owner confirms. Engine-read keys only. */
  patch: Record<string, unknown>;
  provenance: Record<string, FieldProvenance>;
  /** Figures a document asserts that must not become inputs: shown beside the engine's own result. */
  claims: Record<string, { value: number; documentType: IntakeDocument['documentType']; how: string }>;
  /** What the engine would still refuse the deal for once this patch is applied: its own check, so the two can never disagree. */
  missing: string[];
  /** The same list, structured, for the review screen and the readiness check. */
  missingInputs: MissingInput[];
  /** Where each parsed number came from, in the form a deal stores it (`assumptionBasis`), so a lender can be shown the document. */
  basis: Record<string, InputBasis>;
  notes: string[];
}

export interface PatchContext {
  /** The deal's purchase price if already known (typed by the owner), used to turn a loan amount into a down payment percent. */
  purchasePrice?: number | null;
  /** The deal's asset class, when the documents do not say (an offering memorandum does). */
  assetClass?: string;
  /** What the deal already states, so only what is genuinely still missing is reported. */
  existingInputs?: Record<string, unknown>;
}

const RANK: Record<Reliability, number> = { projected: 0, reported: 1, executed: 2 };
const round2 = (n: number): number => Math.round(n * 100) / 100;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type LeaseRow = {
  tenantName: string;
  unit?: string;
  monthlyRent: number;
  annualRent: number;
  leaseStartDate: string;
  leaseEndDate: string;
  leaseType?: string;
  escalationType: string;
  escalationRate: number;
  _reliability: Reliability;
};

class Builder {
  patch: Record<string, unknown> = {};
  provenance: Record<string, FieldProvenance> = {};
  claims: DealPatch['claims'] = {};
  notes: string[] = [];

  /** Set a key unless a more reliable document already set it. */
  set(key: string, value: unknown, doc: IntakeDocument, how: string): void {
    if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
    const reliability = reliabilityOf(doc);
    const existing = this.provenance[key];
    if (existing && RANK[existing.reliability] >= RANK[reliability]) return;
    this.patch[key] = value;
    this.provenance[key] = { documentType: doc.documentType, reliability, how };
  }

  claim(key: string, value: number | null, doc: IntakeDocument, how: string): void {
    if (value === null) return;
    this.claims[key] = { value, documentType: doc.documentType, how };
  }
}

function reliabilityOf(doc: IntakeDocument): Reliability {
  return doc.documentType === 'unknown' ? 'projected' : DOCUMENT_PROFILES[doc.documentType].reliability;
}

// ---------------------------------------------------------------------------
// Per-type mapping
// ---------------------------------------------------------------------------

function leaseFromLeaseDoc(doc: LeaseIntake, notes: string[]): LeaseRow | null {
  const monthly = leaseMonthlyRent(doc);
  if (monthly === null) return null;
  const tenant = val(doc.tenantName) ?? 'Tenant';
  const kind = val(doc.escalationKind);
  const value = val(doc.escalationValue);

  // The engine compounds one annual percent. Say what it cannot model, and never leave the rate unset (it would assume 3%).
  let escalationRate = 0;
  let escalationType = '';
  if (kind === 'fixed_percent' && value !== null) {
    escalationRate = value;
    escalationType = 'Fixed %';
  } else if (kind === 'fixed_amount' && value !== null && monthly > 0) {
    // A fixed dollar bump per period, expressed as the percent of today's rent that the engine compounds (annual bumps only).
    const freq = val(doc.escalationFrequency);
    if (freq === 'annual' || freq === null) {
      escalationRate = round2((value / (val(doc.baseRentPeriod) === 'annual' ? monthly * 12 : monthly)) * 100);
      escalationType = 'Fixed %';
      notes.push(`${tenant}: a fixed-dollar escalation was converted to ${escalationRate}% a year of the starting rent (the engine compounds a percent).`);
    } else {
      notes.push(`${tenant}: a fixed-dollar escalation every ${freq} could not be converted; rent is held flat. Set an escalation assumption.`);
    }
  } else if (kind === 'cpi') {
    escalationRate = value ?? 0;
    escalationType = 'CPI';
    notes.push(`${tenant}: CPI-linked rent is modelled at ${escalationRate}% a year${value === null ? ' (flat, because no cap or assumed rate was given)' : ' (the stated cap)'}. Set an assumption.`);
  } else if (kind === 'stepped_schedule') {
    notes.push(`${tenant}: a stepped rent schedule (${doc.rentSteps.length} steps) is recorded but the engine models only a single annual percent; rent is held flat until the schedule is supported.`);
  } else if (kind === null) {
    notes.push(`${tenant}: no escalation was found in the lease; rent is held flat.`);
  }

  if (val(doc.renewalOptionCount) !== null && (val(doc.renewalOptionCount) as number) > 0) {
    notes.push(`${tenant}: has ${val(doc.renewalOptionCount)} renewal option(s) of ${val(doc.renewalOptionYears) ?? '?'} years (${val(doc.renewalRentBasis) ?? 'rent basis not stated'}); choose the expiry assumption on the lease.`);
  }
  if (val(doc.earlyTerminationRight) === true) notes.push(`${tenant}: has an early-termination right${val(doc.earlyTerminationFee) !== null ? ` (fee ${val(doc.earlyTerminationFee)})` : ''}; not modelled.`);
  if ((val(doc.freeRentMonths) ?? 0) > 0) notes.push(`${tenant}: ${val(doc.freeRentMonths)} month(s) of free rent; not modelled.`);

  return {
    tenantName: tenant,
    unit: val(doc.premises) ?? undefined,
    monthlyRent: monthly,
    annualRent: round2(monthly * 12),
    leaseStartDate: val(doc.commencementDate) ?? '',
    leaseEndDate: val(doc.expirationDate) ?? '',
    leaseType: val(doc.expenseStructure) ?? undefined,
    escalationType,
    escalationRate,
    _reliability: 'executed',
  };
}

function leasesFromRentRoll(doc: RentRollIntake, notes: string[]): LeaseRow[] {
  const period = val(doc.rentPeriod);
  const out: LeaseRow[] = [];
  doc.rows.forEach((row, i) => {
    if (val(row.status) === 'vacant') return;
    const monthly = rowMonthlyRent(row, period);
    if (monthly === null) return;
    const m2m = val(row.status) === 'month_to_month';
    out.push({
      tenantName: val(row.tenantName) ?? `Tenant ${i + 1}`,
      unit: val(row.unit) ?? undefined,
      monthlyRent: monthly,
      annualRent: round2(monthly * 12),
      leaseStartDate: val(row.leaseStartDate) ?? '',
      leaseEndDate: m2m ? '' : (val(row.leaseEndDate) ?? ''),
      escalationType: '',
      // A rent roll never states escalations. Flat is explicit here so the engine does not fall back to its own 3%.
      escalationRate: 0,
      _reliability: 'reported',
    });
    if (val(row.status) === 'notice_to_vacate') notes.push(`${val(row.tenantName) ?? `Row ${i + 1}`} is on notice to vacate; it is still counted as paying rent.`);
  });
  if (out.length > 0) notes.push('Rent roll rows carry no escalation terms, so rent is held flat until leases are added.');
  return out;
}

/** Expense lines that are inputs in their own right (not only part of the ratio), and the engine key each one sets. */
const ITEM_KEYS: Partial<Record<ExpenseCategory, [string, string]>> = {
  property_tax: ['annualTaxes', 'Property taxes'],
  insurance: ['annualInsurance', 'Insurance'],
  utilities: ['annualUtilities', 'Utilities'],
  repairs_maintenance: ['annualMaintenance', 'Repairs and maintenance'],
  reserves_capex: ['capexReserveAnnual', 'Replacement reserve'],
};

/**
 * An income and expense table into inputs: the expense ratio, vacancy, and the lines that are inputs themselves (taxes, insurance,
 * utilities, upkeep, reserves). `doc` is the document it came from, which decides how far the figures are trusted.
 */
function applyOperatingStatement(b: Builder, stmt: OperatingStatementIntake, doc: IntakeDocument, leasesEmitted: boolean): void {
  const t = statementTotals(stmt);
  const source = doc.documentType === 'offering_memorandum' ? "offering memorandum (the seller's current column)" : 'operating statement';
  for (const [category, [key, label]] of Object.entries(ITEM_KEYS) as Array<[ExpenseCategory, [string, string]]>) {
    const lines = stmt.expenses.filter((l) => val(l.category) === category && val(l.amount) !== null);
    if (lines.length === 0) continue;
    const total = lines.reduce((s, l) => s + Math.abs(val(l.amount) as number), 0) * (t.annualFactor ?? 1);
    if (total > 0) b.set(key, round2(total), doc, `${label} on the ${source}${t.months && t.months !== 12 ? `, annualised from ${t.months} months` : ''}`);
  }
  if (t.operatingExpenses > 0 && t.grossRent > 0) {
    // The engine applies the expense ratio to gross rent before vacancy (the same basis as `grossRent` here), so that is the basis used.
    const ratio = round2((t.operatingExpenses / t.grossRent) * 100);
    const span = t.months && t.months !== 12 ? `, annualised from ${t.months} months` : '';
    b.set('expenseRatio', ratio, doc, `${source === 'operating statement' ? '' : 'Seller\'s figures: '}Operating expenses ${Math.round(t.operatingExpenses).toLocaleString()} / gross rent ${Math.round(t.grossRent).toLocaleString()}${span}; reserves, debt service and depreciation excluded`);
    if (t.excludedExpenses > 0) b.notes.push(`Left out of the expense ratio: ${Math.round(t.excludedExpenses).toLocaleString()} of reserves, debt service or depreciation.`);
  }
  if (t.income.other_income > 0) b.notes.push(`The statement shows ${Math.round(t.income.other_income).toLocaleString()} of other income a year; the engine does not model other income, so it is not in the result.`);
  if (t.income.vacancy_credit_loss > 0 && t.income.rent > 0) {
    const vacancy = round2((t.income.vacancy_credit_loss / t.income.rent) * 100);
    if (leasesEmitted) {
      b.notes.push(`The statement shows ${vacancy}% vacancy and credit loss. Vacancy is not applied: rent comes from the occupied leases, and applying it again would double-count.`);
    } else {
      b.set('vacancyRate', vacancy, doc, 'Vacancy and credit loss / rent, as printed (assumes rent is shown before the loss)');
    }
  }
  if (stmt.documentType === 'operating_statement') b.claim('reportedNoi', val(stmt.reportedNoi), doc, 'NOI printed on the statement (seller figure)');
}

/** The unit mix as the rent the property would collect now, and what the broker says the market would pay. */
function applyUnitMix(b: Builder, doc: OfferingMemorandumIntake, leasesEmitted: boolean): void {
  const rows = doc.unitMix.map((r) => ({ count: val(r.unitCount), current: val(r.currentMonthlyRent), market: val(r.marketMonthlyRent) })).filter((r) => r.count !== null && r.count > 0);
  const priced = rows.filter((r) => r.current !== null);
  const units = rows.reduce((s, r) => s + (r.count as number), 0);
  if (units > 0 && val(doc.unitCount) === null) b.set('unitCount', units, doc, 'Sum of the unit mix in the offering memorandum');
  if (priced.length === 0) return;
  const pricedUnits = priced.reduce((s, r) => s + (r.count as number), 0);
  const monthly = round2(priced.reduce((s, r) => s + (r.count as number) * (r.current as number), 0));
  if (leasesEmitted) {
    b.notes.push('The offering memorandum\'s unit mix rents were not applied: rent comes from the leases that were read.');
  } else {
    const how = `Current rents in the offering memorandum's unit mix (${pricedUnits} units, average ${Math.round(monthly / pricedUnits).toLocaleString()} a month)`;
    b.set('grossRentPerMonth', monthly, doc, how);
    b.set('monthlyRent', monthly, doc, how);
    b.set('grossRentAnnual', round2(monthly * 12), doc, how);
    b.set('monthlyRentPerUnit', round2(monthly / pricedUnits), doc, how);
  }
  const withMarket = priced.filter((r) => r.market !== null);
  if (withMarket.length === priced.length) {
    const market = priced.reduce((s, r) => s + (r.count as number) * (r.market as number), 0) / pricedUnits;
    b.notes.push(`The broker's market rents average ${Math.round(market).toLocaleString()} a month against ${Math.round(monthly / pricedUnits).toLocaleString()} current. Current rents are used; the market figure is the broker's claim.`);
  }
}

function applyLoan(b: Builder, doc: LoanTermsIntake, ctx: PatchContext, missing: string[]): void {
  b.set('interestRate', val(doc.interestRatePercent), doc, 'Rate stated in the loan document');
  // Term and amortization are different things. Both are set so the engine can tell them apart.
  b.set('loanTermYears', val(doc.termYears), doc, 'Maturity stated in the loan document');
  b.set('amortizationYears', val(doc.amortizationYears), doc, 'Amortization period stated in the loan document');
  b.set('financingType', val(doc.rateType), doc, 'Rate type stated in the loan document');
  b.set('interestOnlyYears', val(doc.interestOnlyYears), doc, 'Interest-only period stated in the loan document');
  const amount = val(doc.loanAmount);
  b.set('loanAmount', amount, doc, 'Loan amount stated in the loan document');
  const price = ctx.purchasePrice ?? (b.patch.purchasePrice as number | undefined) ?? null;
  if (amount !== null && price && price > 0) {
    b.set('downPaymentPercent', round2((1 - amount / price) * 100), doc, `Down payment = 1 - loan ${Math.round(amount).toLocaleString()} / price ${Math.round(price).toLocaleString()}`);
  } else if (amount !== null) {
    missing.push('downPaymentPercent (a loan amount was found but there is no purchase price to turn it into a down payment)');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildDealPatch(docs: IntakeDocument[], ctx: PatchContext = {}): DealPatch {
  const b = new Builder();
  const missing: string[] = [];

  // Highest reliability first so a lower one can never overwrite a higher one, whatever order the files arrived in.
  const ordered = [...docs].sort((x, y) => RANK[reliabilityOf(y)] - RANK[reliabilityOf(x)]);

  // Price first: the loan mapping needs it.
  for (const doc of ordered) {
    if (doc.documentType === 'purchase_agreement') {
      b.set('purchasePrice', val(doc.purchasePrice), doc, 'Price in the purchase agreement');
      b.set('closingDate', val(doc.closingDate), doc, 'Closing date in the purchase agreement');
      b.set('closingCosts', val(doc.buyerClosingCosts), doc, 'Buyer closing costs in the purchase agreement');
      b.set('address', val(doc.address), doc, 'Address in the purchase agreement');
    }
  }
  if (ctx.purchasePrice && !b.patch.purchasePrice) b.patch.purchasePrice = ctx.purchasePrice;

  // Leases: executed lease documents beat the rent roll's row for the same tenant.
  const leaseRows = new Map<string, LeaseRow>();
  const addLease = (l: LeaseRow) => {
    const key = norm(l.tenantName) || `${l.unit ?? ''}|${l.monthlyRent}`;
    const have = leaseRows.get(key);
    if (!have || RANK[l._reliability] > RANK[have._reliability]) leaseRows.set(key, l);
  };
  for (const doc of ordered) {
    if (doc.documentType === 'lease') {
      const l = leaseFromLeaseDoc(doc, b.notes);
      if (l) addLease(l);
      else b.notes.push(`A lease${val(doc.tenantName) ? ` for ${val(doc.tenantName)}` : ''} had no usable rent and was not applied.`);
    } else if (doc.documentType === 'rent_roll') {
      leasesFromRentRoll(doc, b.notes).forEach(addLease);
    }
  }
  const leases = [...leaseRows.values()];
  if (leases.length > 0) {
    const reliability: Reliability = leases.some((l) => l._reliability === 'executed') ? 'executed' : 'reported';
    const fromDoc = ordered.find((d) => d.documentType === 'lease') ?? ordered.find((d) => d.documentType === 'rent_roll')!;
    b.patch.leases = leases.map(({ _reliability, ...rest }) => rest);
    b.provenance.leases = {
      documentType: fromDoc.documentType,
      reliability,
      how: `${leases.length} tenant(s); ${leases.filter((l) => l._reliability === 'executed').length} read from leases, the rest from the rent roll`,
    };
    // One lease structure for the deal when every lease agrees; otherwise leave it to each lease.
    const types = new Set(leases.map((l) => l.leaseType).filter(Boolean));
    if (types.size === 1) b.set('leaseType', [...types][0], fromDoc, 'Every lease uses the same expense structure');
  }
  for (const doc of ordered) if (doc.documentType === 'rent_roll') {
    const totals = rentRollTotals(doc);
    if (totals.vacant > 0) b.notes.push(`${totals.vacant} vacant unit(s) on the rent roll are not in the lease list. Vacancy is already reflected, so no vacancy percent is applied on top.`);
  }

  for (const doc of ordered) {
    switch (doc.documentType) {
      case 'operating_statement':
        applyOperatingStatement(b, doc, doc, leases.length > 0);
        break;
      case 'loan_terms':
        applyLoan(b, doc, ctx, missing);
        break;
      case 'offering_memorandum': {
        b.set('address', val(doc.address), doc, 'Address in the offering memorandum');
        b.set('city', val(doc.city), doc, 'Offering memorandum');
        b.set('state', val(doc.state), doc, 'Offering memorandum');
        b.set('zip', val(doc.zip), doc, 'Offering memorandum');
        b.set('primaryApn', val(doc.apn), doc, 'Parcel number in the offering memorandum');
        b.set('squareFeet', val(doc.squareFeet), doc, 'Offering memorandum');
        b.set('unitCount', val(doc.unitCount), doc, 'Offering memorandum');
        b.set('yearBuilt', val(doc.yearBuilt), doc, 'Year built in the offering memorandum');
        const lotSf = val(doc.lotSqFt);
        b.set('acres', val(doc.lotAcres) ?? (lotSf !== null && lotSf > 0 ? round2(lotSf / 43560) : null), doc, 'Land area in the offering memorandum');
        // The list price is the natural starting price for a prospect, but it is the seller's number: it is offered, not assumed, and a
        // price the owner already typed always wins
        if (!ctx.purchasePrice) b.set('purchasePrice', val(doc.askingPrice), doc, "The seller's list price in the offering memorandum");
        applyUnitMix(b, doc, leases.length > 0);
        // The memorandum's income and expense table is the seller's own account of the property: read like a statement, trusted like a claim
        if (doc.income.length > 0 || doc.expenses.length > 0) {
          applyOperatingStatement(b, {
            documentType: 'operating_statement',
            periodStart: missingValue(), periodEnd: missingValue(),
            income: doc.income, expenses: doc.expenses,
            reportedEffectiveGrossIncome: missingValue(), reportedTotalExpenses: missingValue(), reportedNoi: missingValue(),
          }, doc, leases.length > 0);
        }
        // The broker's numbers are claims. They are shown next to the engine's result and never become inputs.
        b.claim('askingPrice', val(doc.askingPrice), doc, 'Asking price in the offering memorandum');
        b.claim('claimedNoi', val(doc.claimedNoi), doc, 'NOI claimed in the offering memorandum');
        b.claim('claimedCapRatePercent', val(doc.claimedCapRatePercent), doc, 'Cap rate claimed in the offering memorandum');
        b.claim('statedOccupancyPercent', val(doc.occupancyPercent), doc, 'Occupancy stated in the offering memorandum');
        break;
      }
      case 'unknown':
        b.notes.push('A document could not be classified and was not used.');
        break;
      default:
        break;
    }
  }

  // What is still missing is exactly what the engine itself would refuse the deal for: the same check, run on the deal as it would be
  // once this patch is applied. A missing figure is reported, never filled in.
  const omDoc = ordered.find((d) => d.documentType === 'offering_memorandum');
  const omClass = omDoc && omDoc.documentType === 'offering_memorandum' ? omDoc.assetClass.value : null;
  const assetClass = ctx.assetClass ?? omClass ?? 'commercial';
  const merged: Record<string, unknown> = { ...(ctx.existingInputs ?? {}), ...b.patch };
  const missingInputs = checkEngineInputs(assetClass, merged);
  const missingText = [...missing, ...missingInputs.map((m) => `${m.key} (${m.label})`)];

  // A parsed figure is recorded with the document it came from, in the same form every other number on a deal is
  const basis: Record<string, InputBasis> = {};
  for (const [key, label] of Object.entries(TRACKED_INPUTS)) {
    const v = b.patch[key];
    const p = b.provenance[key];
    if (typeof v === 'number' && p) {
      basis[key] = { source: 'document', label, value: v, rationale: `${p.how} (${p.documentType.replace('_', ' ')}, ${p.reliability})` };
    }
  }

  return { patch: b.patch, provenance: b.provenance, claims: b.claims, missing: missingText, missingInputs, basis, notes: b.notes };
}
