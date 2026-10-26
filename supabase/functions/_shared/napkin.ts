/**
 * The back-of-the-napkin math every investor starts with, read from the same engine run as the pro forma:
 *   units x average rent = gross rent, less vacancy and operating expenses = NOI,
 *   NOI / total cost of acquisition = yield on cost, compared with what the loan costs (the loan constant),
 *   NOI less the loan payment and reserves = cash flow.
 *
 * Every figure is the first FULL operating year's, so a partial first year never distorts the story. Nothing here changes an existing number.
 */
import { calculateProjections, firstFullYear, normalizeAssetClass } from './math-engine.ts';

export interface Napkin {
  /** Calendar year of the first full operating year, the year every figure is read from. */
  basisYear: number;
  /** How many units (or homes) the rent is built from, as the owner entered them; null when the deal does not say. */
  units: { count: number; label: 'unit' | 'home' } | null;
  /** Gross rent per unit per month in the first full year (after rent growth); null without a unit count. */
  avgRentMonthly: number | null;
  /** The rent per unit the owner entered, before growth; null when the deal states rent another way. */
  enteredRentMonthly: number | null;
  /** The first full year's gross rent over twelve months: the engine's own number, divided. Always available, whatever the rent is built from. */
  grossRentMonthly: number;
  grossRentAnnual: number;
  vacancyLoss: number;
  operatingExpenses: number;
  noi: number;
  /** Purchase price plus renovation plus buyer closing costs. */
  totalCost: number;
  purchasePrice: number;
  rehabCosts: number;
  closingCosts: number;
  /** NOI / total cost, in percent. Null when there is no cost. */
  yieldOnCostPct: number | null;
  loanAmount: number;
  debtService: number;
  /** Annual debt service / loan, in percent. Null with no loan. */
  loanConstantPct: number | null;
  /** Yield on cost against the loan constant: does borrowing help (positive) or hurt (negative)? 'none' with no loan. */
  leverage: 'positive' | 'negative' | 'neutral' | 'none';
  replacementReserve: number;
  /** Anything else the pro forma deducts between NOI and cash flow (renovation paid in cash); zero when nothing. */
  otherCash: number;
  /** The pro forma's own cash flow for that year, so the equation above foots to it. */
  cashFlow: number;
  /** NOI / debt service. Null with no loan. */
  dscr: number | null;
}

const n = (v: unknown): number => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const whole = (v: unknown): number => { const x = Math.round(n(v)); return x > 0 ? x : 0; };

export function calculateNapkin(rawAssetType: string, inputs: Record<string, any>): Napkin {
  const assetType = normalizeAssetClass(rawAssetType);
  const res = calculateProjections(assetType, inputs);
  const proj = (res.projections ?? []) as any[];
  const y = (firstFullYear(proj) ?? proj[0] ?? {}) as any;

  const gross = n(y.grossPotentialIncome ?? y.grossPotentialRent);
  const noi = n(y.netOperatingIncome);
  const ds = n(y.debtService);
  const reserve = n(y.capexReserve);
  const cashFlow = n(y.cashFlow ?? y.netCashFlow);
  const loan = n(res.loanAmount);

  const price = n(res.purchasePrice ?? inputs.purchasePrice);
  const rehab = n(res.rehabCosts ?? inputs.rehabCosts);
  const closing = n(inputs.closingCosts);
  const totalCost = price + rehab + closing;

  // Units are a fact the owner entered, never guessed: a home is one unit. A deal built from a lease schedule states no unit count and no tenant
  // here: lease records can overlap, repeat or describe earlier periods, so page 1 reports only the rent the engine itself produced.
  const basisYear = n(y.calendarYear);
  const hasLeases = Array.isArray(inputs.leases) && inputs.leases.length > 0;
  let units: Napkin['units'] = null;
  if (assetType === 'single-family') units = { count: 1, label: 'home' };
  else if (!hasLeases) {
    const entered = whole(inputs.unitCount ?? inputs.numUnits ?? inputs.totalUnits ?? inputs.storageUnitCount);
    if (entered > 0) units = { count: entered, label: 'unit' };
  }
  const perUnit = n(inputs.monthlyRentPerUnit ?? inputs.storageRentPerUnit ?? inputs.storageRent);
  const enteredRent = units && perUnit > 0 ? perUnit : units?.label === 'home' && n(inputs.monthlyRent) > 0 ? n(inputs.monthlyRent) : null;

  const constant = loan > 0 && ds > 0 ? (ds / loan) * 100 : null;
  const yieldPct = totalCost > 0 ? (noi / totalCost) * 100 : null;
  let leverage: Napkin['leverage'] = 'none';
  if (constant !== null && yieldPct !== null) {
    const spread = yieldPct - constant;
    leverage = spread > 0.05 ? 'positive' : spread < -0.05 ? 'negative' : 'neutral';
  }
  const residual = noi - ds - reserve - cashFlow;

  return {
    basisYear,
    units,
    enteredRentMonthly: enteredRent,
    grossRentMonthly: gross / 12,
    avgRentMonthly: units && gross > 0 ? gross / units.count / 12 : null,
    grossRentAnnual: gross,
    vacancyLoss: n(y.vacancyLoss),
    operatingExpenses: n(y.operatingExpenses),
    noi,
    totalCost,
    purchasePrice: price,
    rehabCosts: rehab,
    closingCosts: closing,
    yieldOnCostPct: yieldPct,
    loanAmount: loan,
    debtService: ds,
    loanConstantPct: constant,
    leverage,
    replacementReserve: reserve,
    otherCash: Math.abs(residual) >= 1 ? residual : 0,
    cashFlow,
    dscr: loan > 0 && ds > 0 ? noi / ds : null,
  };
}
