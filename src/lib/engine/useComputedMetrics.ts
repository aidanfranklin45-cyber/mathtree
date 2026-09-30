import { useMemo } from 'react';
import type { DealInputs, DealMetrics, DealRecord, SensitivityMatrix, TaxMetrics } from '../math/types';
import { computeDealMetrics, computeSensitivity, computeTaxMetrics } from './compute';

export interface ComputedMetricsState {
  metrics: DealMetrics | null;
  tax: TaxMetrics | null;
  sensitivity: SensitivityMatrix | null;
  error: string | null;
}

/**
 * useComputedMetrics: derives every studio number from the deal's inputs, synchronously, on the
 * client. Recomputes automatically whenever inputs (or `overrides`) change; there is nothing to
 * fetch, cache-invalidate or keep in sync. The sensitivity grid is only computed when requested.
 */
export function useComputedMetrics(
  deal: DealRecord | null,
  opts: { computeSensitivity?: boolean; overrides?: Partial<DealInputs> } = {},
): ComputedMetricsState {
  const inputsKey = JSON.stringify(deal?.inputs ?? null);
  const overridesKey = JSON.stringify(opts.overrides ?? null);
  const assetClass = deal?.asset_class;
  const purchasePrice = deal?.purchase_price;

  return useMemo<ComputedMetricsState>(() => {
    if (!deal) return { metrics: null, tax: null, sensitivity: null, error: null };
    try {
      return {
        metrics: computeDealMetrics(deal, opts.overrides),
        tax: computeTaxMetrics(deal, opts.overrides),
        sensitivity: opts.computeSensitivity ? computeSensitivity(deal, opts.overrides) : null,
        error: null,
      };
    } catch (err) {
      console.error('[useComputedMetrics] engine error:', err);
      return { metrics: null, tax: null, sensitivity: null, error: err instanceof Error ? err.message : String(err) };
    }
    // deal is intentionally keyed by its facts, not object identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id, assetClass, purchasePrice, inputsKey, overridesKey, opts.computeSensitivity]);
}
