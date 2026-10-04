/**
 * TEST FIXTURES ONLY. The engine entry points with `withLegacyDefaults` applied to their inputs, for tests about behaviour other than
 * input requirements. Same names and signatures as the real ones, so a test only changes its import. See `testInputs.ts`.
 */
import * as engine from './index';
import * as compute from './compute';
import { withLegacyDefaults, withLegacyTaxDefaults } from './testInputs';

type Deal = { asset_class?: string; assetType?: string } & Record<string, any>;
const assetOf = (d: Deal): string => String(d.asset_class ?? d.assetType ?? 'commercial');
const fillDeal = (deal: Deal, overrides?: Record<string, any>): Deal => ({
  ...deal,
  inputs: withLegacyTaxDefaults(withLegacyDefaults(assetOf(deal), { ...(deal.inputs ?? {}), ...(overrides ?? {}) })),
});

export const calculateProjections = (asset: string, inputs: Record<string, any> = {}, opts?: any) =>
  engine.calculateProjections(asset, withLegacyDefaults(asset, inputs), opts);

export const calculateMonthlyProjections = (asset: string, inputs: Record<string, any>, options?: Record<string, any>) =>
  engine.calculateMonthlyProjections(asset, withLegacyDefaults(asset, inputs), options);

export const calculateDownPaymentMatrix = (asset: string, inputs: Record<string, any>, ...rest: any[]) =>
  (engine.calculateDownPaymentMatrix as any)(asset, withLegacyDefaults(asset, inputs), ...rest);

export const calculateSensitivityMatrix = (asset: string, inputs: Record<string, any>, ...rest: any[]) =>
  (engine.calculateSensitivityMatrix as any)(asset, withLegacyDefaults(asset, inputs), ...rest);

export const calculateTaxAndDepreciation = (asset: string, inputs: Record<string, any>, base: any) =>
  engine.calculateTaxAndDepreciation(asset, withLegacyTaxDefaults(withLegacyDefaults(asset, inputs)), base);

export const runMonteCarlo = (asset: string, inputs: Record<string, any>, options?: any) =>
  engine.runMonteCarlo(asset, withLegacyDefaults(asset, inputs), options);

export const createMonteCarloRunner = (asset: string, inputs: Record<string, any>, options?: any) =>
  engine.createMonteCarloRunner(asset, withLegacyDefaults(asset, inputs), options);

export const computeDealMetrics = (deal: Deal, overrides?: Record<string, any>) => compute.computeDealMetrics(fillDeal(deal, overrides) as any);
export const tryComputeDealMetrics = (deal: Deal, overrides?: Record<string, any>) => compute.tryComputeDealMetrics(fillDeal(deal, overrides) as any);
export const computeSensitivity = (deal: Deal, overrides?: Record<string, any>) => compute.computeSensitivity(fillDeal(deal, overrides) as any);
export const computeTaxMetrics = (deal: Deal, overrides?: Record<string, any>) => compute.computeTaxMetrics(fillDeal(deal, overrides) as any);

export const calculateRefinanceEvent = (asset: string, inputs: Record<string, any>, year: number, ltv: number, rate: number, term: number, closingCostPercent: number) =>
  engine.calculateRefinanceEvent(asset, withLegacyDefaults(asset, inputs), year, ltv, rate, term, closingCostPercent);

export const calculateHoldingPeriodWealth = (inputs: Record<string, any>, projections: any[], amortizationSchedule: any[], holdYear?: number) =>
  engine.calculateHoldingPeriodWealth(withLegacyDefaults('commercial', inputs), projections, amortizationSchedule, holdYear);
