/**
 * Browser entry point for the MathTree math engine.
 *
 * The engine is a pure `(inputs) -> metrics` module and its single source of truth lives in
 * supabase/functions/_shared (Edge Functions are Deno and can only bundle that directory).
 * Nothing derived from it is stored: call these functions on demand, memoise in React.
 */
export { ENGINE_VERSION } from './version';
export {
  calculateProjections,
  calculateMonthlyProjections,
  calculateSensitivityMatrix,
  calculateDownPaymentMatrix,
  calculateTaxMetrics,
  calculateTaxAndDepreciation,
  calculateHoldingPeriodWealth,
  calculateMonthlyPayment,
  calculateRemainingBalance,
  getAnnualAmortization,
  getMonthlyAmortization,
  calculateNPV,
  calculateIRR,
  calculateRefinanceEvent,
  solveTargetPurchasePrice,
  generateScenarioVariants,
  aggregatePortfolio,
  getBenchmarkCapRateRange,
  auditDealRisks,
  normalizeAssetClass,
  resolveLeaseMonthlyRent,
  createLeaseScheduleCache,
  firstFullYear,
  numOr,
  resolveDownPaymentPercent,
  IncompleteInputsError,
  checkEngineInputs,
  checkTaxInputs,
} from '@engine/math-engine.ts';
export type {
  DownPaymentMatrixRow,
  DownPaymentMatrixResult,
  LeaseScheduleCache,
  MissingInput,
} from '@engine/math-engine.ts';
export { runMonteCarlo, createMonteCarloRunner, buildFixedHistogram, seededRandom, seedFromText, DEFAULT_TENANT_DEFAULT, DEFAULT_TURNOVER } from '@engine/monte-carlo.ts';
export type { MonteCarloOptions, MonteCarloResult, MonteCarloHistogramBin, MonteCarloRunner, ProfitSummary } from '@engine/monte-carlo.ts';

