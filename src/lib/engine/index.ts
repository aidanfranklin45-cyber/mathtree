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
  runMonteCarloSimulation,
  solveTargetPurchasePrice,
  generateScenarioVariants,
  aggregatePortfolio,
  getBenchmarkCapRateRange,
  auditDealRisks,
  normalizeAssetClass,
  resolveLeaseMonthlyRent,
} from '@engine/math-engine.ts';
export { runMonteCarlo } from '@engine/monte-carlo.ts';
export type { MonteCarloOptions, MonteCarloResult, MonteCarloHistogramBin } from '@engine/monte-carlo.ts';
