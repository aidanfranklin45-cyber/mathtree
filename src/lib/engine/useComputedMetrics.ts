import { useMemo, useSyncExternalStore } from 'react';
import type { DealInputs, DealMetrics, DealRecord, SensitivityMatrix } from '../math/types';
import { computeDealMetrics, computeSensitivity } from './compute';
import { IncompleteInputsError, type MissingInput } from './index';
import { getExpiryDefaultsVersion, subscribeExpiryDefaults } from './expiryDefaults';

export interface ComputedMetricsState {
  metrics: DealMetrics | null;
  sensitivity: SensitivityMatrix | null;
  error: string | null;
  /** Set when the deal does not state everything the engine needs: what to ask the owner for. Never a number made up in its place. */
  missing: MissingInput[];
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
  // Re-run when the investor changes their lease-expiry default in Profile
  const expiryVersion = useSyncExternalStore(subscribeExpiryDefaults, getExpiryDefaultsVersion);
  const inputsKey = JSON.stringify(deal?.inputs ?? null);
  const overridesKey = JSON.stringify(opts.overrides ?? null);
  const assetClass = deal?.asset_class;
  const purchasePrice = deal?.purchase_price;

  return useMemo<ComputedMetricsState>(() => {
    if (!deal) return { metrics: null, sensitivity: null, error: null, missing: [] };
    try {
      return {
        metrics: computeDealMetrics(deal, opts.overrides),
        sensitivity: opts.computeSensitivity ? computeSensitivity(deal, opts.overrides) : null,
        error: null,
        missing: [],
      };
    } catch (err) {
      if (err instanceof IncompleteInputsError) return { metrics: null, sensitivity: null, error: err.message, missing: err.missing };
      console.error('[useComputedMetrics] engine error:', err);
      return { metrics: null, sensitivity: null, error: err instanceof Error ? err.message : String(err), missing: [] };
    }
    // deal is intentionally keyed by its facts, not object identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id, assetClass, purchasePrice, inputsKey, overridesKey, opts.computeSensitivity, expiryVersion]);
}
