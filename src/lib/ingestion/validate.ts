/**
 * Deterministic checks on what the parser returned. The model proposes; these decide whether the result is internally consistent.
 * An `error` stops the document from being applied until the owner fixes or confirms it on the review screen; a `warning` is shown
 * beside the value. Nothing here repairs a value: a wrong number is flagged, never silently corrected.
 */

import type { IntakeDocument } from './intake';
import { val } from './intake';
import { leaseMonthlyRent, NON_OPERATING, periodMonths, rentRollTotals, statementTotals } from './normalize';

export interface IntakeIssue {
  severity: 'error' | 'warning';
  /** The field the issue is about, in the payload's own words (for the review screen to point at). */
  field: string;
  message: string;
}

/** Totals the document prints should match the sum of its rows within this share. Rounding on a printed roll is normal; more is not. */
const TOTAL_TOLERANCE = 0.01;

const off = (a: number, b: number): boolean => Math.abs(a - b) > Math.max(1, Math.abs(b)) * TOTAL_TOLERANCE;

/** One structural check: a figure we derived from the document's own lines set against a figure the document prints. Shown whether it ties or not. */
export interface DocumentCheck {
  label: string;
  ok: boolean;
  /** In words, with both numbers. */
  detail: string;
}

/** A memorandum's NOI is the seller's own arithmetic: the income and costs we read should reproduce it to within this share. */
export const NOI_TIE_TOLERANCE = 0.02;

const num = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * The checks that make a reading provable. A parser can mis-read a table and still look confident, so the document is held to its own
 * arithmetic: (1) the income and operating costs we read must add up to the NOI it prints, and (2) that NOI over the price must give the cap
 * rate it prints. When both tie, we have reproduced the seller's own valuation from the document, which is strong evidence the table was read
 * correctly. When one does not, a line was missed or misread (or the seller's figures do not add up) and the owner is told so.
 */
export function documentChecks(doc: IntakeDocument): DocumentCheck[] {
  const checks: DocumentCheck[] = [];
  if (doc.documentType !== 'offering_memorandum') return checks;
  const claimedNoi = val(doc.claimedNoi);
  const cap = val(doc.claimedCapRatePercent);
  const price = val(doc.askingPrice);
  if (doc.income.length > 0 && doc.expenses.length > 0 && claimedNoi !== null && claimedNoi > 0) {
    let income = 0; let vacancy = 0; let costs = 0;
    for (const l of doc.income) {
      const a = val(l.amount);
      if (a === null) continue;
      if (val(l.category) === 'vacancy_credit_loss') vacancy += Math.abs(a); else income += a;
    }
    for (const l of doc.expenses) {
      const a = val(l.amount);
      if (a === null || NON_OPERATING.has(val(l.category) ?? 'other')) continue;
      costs += Math.abs(a);
    }
    const implied = income - vacancy - costs;
    const gap = Math.abs(implied - claimedNoi) / claimedNoi;
    checks.push({
      label: 'Income less costs equals the memorandum\'s NOI',
      ok: gap <= NOI_TIE_TOLERANCE,
      detail: `The income and operating costs we read give an NOI of ${num(implied)}; the memorandum prints ${num(claimedNoi)} (${(gap * 100).toFixed(1)}% apart). ${gap <= NOI_TIE_TOLERANCE ? 'They tie.' : 'They do not tie: a line may have been missed or misread, so check the income and expense table in the document.'}`,
    });
  }
  if (claimedNoi !== null && cap !== null && price !== null && price > 0) {
    const implied = (claimedNoi / price) * 100;
    const ok = Math.abs(implied - cap) <= 0.25;
    checks.push({
      label: 'NOI over the price equals the memorandum\'s cap rate',
      ok,
      detail: `${num(claimedNoi)} over ${num(price)} is a ${implied.toFixed(2)}% cap rate; the memorandum prints ${cap}%. ${ok ? 'They tie.' : 'They do not tie: the NOI, the price or the cap rate may have been misread.'}`,
    });
  }
  return checks;
}

export function validateIntake(doc: IntakeDocument): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const err = (field: string, message: string) => issues.push({ severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ severity: 'warning', field, message });

  switch (doc.documentType) {
    case 'lease': {
      const start = val(doc.commencementDate);
      const end = val(doc.expirationDate);
      if (start && end && end <= start) err('expirationDate', 'The lease ends on or before it starts.');
      if (val(doc.baseRent) !== null && val(doc.baseRentPeriod) === null) err('baseRentPeriod', 'A rent was read but not whether it is monthly, annual or per square foot.');
      if (val(doc.baseRent) !== null && val(doc.baseRentPeriod) !== null && leaseMonthlyRent(doc) === null) {
        err('baseRent', 'Rent is stated per square foot but the leased square footage is missing.');
      }
      const esc = val(doc.escalationValue);
      if (val(doc.escalationKind) === 'fixed_percent' && esc !== null && (esc < 0 || esc > 15)) warn('escalationValue', `A ${esc}% escalation is outside the usual 0 to 15% range.`);
      if (val(doc.escalationKind) === 'stepped_schedule' && doc.rentSteps.length === 0) err('rentSteps', 'The lease has a stepped schedule but no steps were read.');
      const share = val(doc.proRataSharePercent);
      if (share !== null && (share <= 0 || share > 100)) err('proRataSharePercent', 'A pro-rata share must be between 0 and 100 percent.');
      if (val(doc.expenseStructure) === null) warn('expenseStructure', 'Who pays operating expenses (NNN, gross, modified gross) was not found; the engine needs it.');
      break;
    }

    case 'rent_roll': {
      if (val(doc.rentPeriod) === null) err('rentPeriod', 'It is not clear whether the rent column is monthly or annual.');
      if (doc.rows.length === 0) err('rows', 'No rows were read from the rent roll.');
      const totals = rentRollTotals(doc);
      const printed = val(doc.reportedTotalRent);
      if (printed !== null && val(doc.rentPeriod) !== null) {
        // The roll prints its total in the same period as its rows.
        const rowsTotal = val(doc.rentPeriod) === 'annual' ? totals.monthlyRent * 12 : totals.monthlyRent;
        if (off(rowsTotal, printed)) warn('reportedTotalRent', `The rows add to ${Math.round(rowsTotal).toLocaleString()} but the roll prints ${Math.round(printed).toLocaleString()}. A row may be missing or misread.`);
      }
      const printedUnits = val(doc.reportedUnitCount);
      if (printedUnits !== null && printedUnits !== doc.rows.length) warn('reportedUnitCount', `${doc.rows.length} rows were read but the roll says ${printedUnits} units.`);
      doc.rows.forEach((row, i) => {
        const status = val(row.status);
        const s = val(row.leaseStartDate);
        const e = val(row.leaseEndDate);
        if (s && e && e <= s) err(`rows[${i}].leaseEndDate`, 'Lease ends on or before it starts.');
        if (status && status !== 'vacant' && val(row.monthlyRent) === null) warn(`rows[${i}].monthlyRent`, 'An occupied unit has no rent.');
        if (status === 'vacant' && val(row.monthlyRent) !== null && (val(row.monthlyRent) as number) > 0) warn(`rows[${i}].status`, 'A vacant unit shows rent; it may be market rent, not rent paid.');
      });
      break;
    }

    case 'operating_statement': {
      const months = periodMonths(val(doc.periodStart), val(doc.periodEnd));
      if (months === null) err('periodStart', 'The statement period could not be read, so amounts cannot be annualised.');
      else if (months !== 12) warn('periodEnd', `The statement covers ${months} months; amounts will be annualised (x ${(12 / months).toFixed(2)}), which assumes a typical year.`);
      if (doc.income.length === 0) err('income', 'No income lines were read.');
      if (doc.expenses.length === 0) err('expenses', 'No expense lines were read.');
      const t = statementTotals(doc);
      if (t.linesMissingAmount > 0) warn('lines', `${t.linesMissingAmount} line(s) had no readable amount and were left out.`);
      const printedExpenses = val(doc.reportedTotalExpenses);
      if (printedExpenses !== null && t.annualFactor !== null) {
        // Compare in the statement's own period, so annualisation cannot cause a false alarm.
        const ours = (t.operatingExpenses + t.excludedExpenses) / t.annualFactor;
        if (off(ours, printedExpenses)) warn('reportedTotalExpenses', `Expense lines add to ${Math.round(ours).toLocaleString()} but the statement prints ${Math.round(printedExpenses).toLocaleString()}.`);
      }
      const printedNoi = val(doc.reportedNoi);
      const printedEgi = val(doc.reportedEffectiveGrossIncome);
      if (printedNoi !== null && printedEgi !== null && printedExpenses !== null && off(printedEgi - printedExpenses, printedNoi)) {
        warn('reportedNoi', 'The statement\'s own income, expenses and NOI do not agree (income less expenses is not the printed NOI). It may include reserves or debt service.');
      }
      if (t.grossRent <= 0) warn('income', 'No rent or recovery income was found, so an expense ratio cannot be derived.');
      break;
    }

    case 'offering_memorandum': {
      const noi = val(doc.claimedNoi);
      const cap = val(doc.claimedCapRatePercent);
      const price = val(doc.askingPrice);
      if (noi !== null && cap !== null && price !== null && price > 0) {
        const implied = (noi / price) * 100;
        if (Math.abs(implied - cap) > 0.25) warn('claimedCapRatePercent', `The claimed NOI and asking price imply a ${implied.toFixed(2)}% cap rate, not ${cap}%.`);
      }
      const occ = val(doc.occupancyPercent);
      if (occ !== null && (occ < 0 || occ > 100)) err('occupancyPercent', 'Occupancy must be between 0 and 100 percent.');
      // The unit mix was assembled by the model; these checks are what keep it honest
      const mix = doc.unitMix.filter((r) => val(r.unitCount) !== null);
      const units = val(doc.unitCount);
      const mixUnits = mix.reduce((s, r) => s + (val(r.unitCount) as number), 0);
      if (mix.length > 0 && units !== null && mixUnits !== units) warn('unitMix', `The unit mix adds up to ${mixUnits} units but the memorandum states ${units}. Check the unit counts.`);
      const mk = mix.filter((r) => val(r.marketMonthlyRent) !== null);
      const avgMarket = val(doc.averageMarketRent);
      if (mk.length === mix.length && mk.length > 0 && avgMarket !== null && mixUnits > 0) {
        const weighted = mk.reduce((s, r) => s + (val(r.unitCount) as number) * (val(r.marketMonthlyRent) as number), 0) / mixUnits;
        if (off(weighted, avgMarket) && Math.abs(weighted - avgMarket) / avgMarket > 0.02) warn('unitMix', `The market rents in the unit mix average ${Math.round(weighted).toLocaleString()} a month, but the memorandum states ${Math.round(avgMarket).toLocaleString()}. Check the rents.`);
      }
      break;
    }

    case 'loan_terms': {
      const term = val(doc.termYears);
      const amort = val(doc.amortizationYears);
      if (term !== null && amort !== null && amort < term) err('amortizationYears', 'Amortization is shorter than the term, which is unusual; the two may be swapped.');
      const rate = val(doc.interestRatePercent);
      if (rate !== null && (rate <= 0 || rate > 25)) warn('interestRatePercent', `A ${rate}% rate is outside the usual range.`);
      if (val(doc.loanAmount) === null) warn('loanAmount', 'No loan amount was found.');
      if (term !== null && amort === null && val(doc.rateType) !== 'interest_only') warn('amortizationYears', 'A term was found but not the amortization period; the engine will assume they are the same.');
      break;
    }

    case 'purchase_agreement': {
      if (val(doc.purchasePrice) === null) err('purchasePrice', 'No purchase price was found.');
      break;
    }

    case 'unknown':
      err('documentType', 'The document type could not be determined.');
      break;
  }

  return issues;
}
