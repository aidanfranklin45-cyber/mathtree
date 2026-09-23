import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './client';
import type { DealRecord, DealInputs, DealMetrics, TaxMetrics, SensitivityMatrix } from '../math/types';

export interface DealProjectionsState {
  metrics: DealMetrics | null;
  tax: TaxMetrics | null;
  sensitivity: SensitivityMatrix | null;
  loading: boolean;
  error: string | null;
  /** Trigger a fresh calculation, optionally with hypothetical input overrides. */
  recalculate: (overrides?: Partial<DealInputs>, opts?: { sensitivity?: boolean }) => Promise<void>;
}

const EDGE_FUNCTION_NAME = 'calculate-deal-projections';
const DEBOUNCE_MS = 400;

/**
 * useDealProjections
 *
 * Calls the `calculate-deal-projections` Edge Function and returns the computed
 * DealMetrics, TaxMetrics, and (optionally) SensitivityMatrix for a deal.
 *
 * The sensitivity matrix is NOT computed on initial load — it is computed lazily
 * only when `computeSensitivity: true` is passed or when `recalculate` is called
 * with `{ sensitivity: true }`.
 *
 * Falls back to any metrics already embedded on `deal.metrics` while the Edge
 * Function response is in flight, so the UI never goes blank on navigation.
 */
export function useDealProjections(
  deal: DealRecord | null,
  initialOptions?: { computeSensitivity?: boolean },
): DealProjectionsState {
  const [metrics, setMetrics] = useState<DealMetrics | null>(
    () => (deal?.metrics as DealMetrics | null) ?? null,
  );
  const [tax, setTax] = useState<TaxMetrics | null>(null);
  const [sensitivity, setSensitivity] = useState<SensitivityMatrix | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce timer ref — avoids hammering the function on rapid input edits
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the current deal ID so we don't apply stale responses
  const currentDealIdRef = useRef<string | null>(null);

  const callEdgeFunction = useCallback(
    async (
      target: DealRecord,
      overrides?: Partial<DealInputs>,
      opts?: { sensitivity?: boolean },
    ): Promise<void> => {
      const dealId = target.id;
      currentDealIdRef.current = dealId;
      setLoading(true);
      setError(null);

      try {
        // Get the current session token for authenticated requests
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const mergedInputs: DealInputs = {
          ...target.inputs,
          ...(overrides ?? {}),
        };

        const requestBody = {
          dealId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId)
            ? dealId
            : undefined,
          assetClass: target.asset_class,
          inputs: mergedInputs,
          computeSensitivity: opts?.sensitivity ?? false,
        };

        const url = `${SUPABASE_URL}/functions/v1/${EDGE_FUNCTION_NAME}`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          // Always send the anon key; auth header adds user context when available
          'apikey': SUPABASE_ANON_KEY,
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });

        // Stale response guard — if the user navigated to a different deal while waiting
        if (currentDealIdRef.current !== dealId) return;

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ?? `HTTP ${response.status}`,
          );
        }

        const data = await response.json() as {
          success: boolean;
          metrics: DealMetrics;
          tax: TaxMetrics;
          sensitivity?: SensitivityMatrix;
        };

        if (!data.success || !data.metrics) {
          throw new Error('Edge Function returned an unexpected response shape');
        }

        setMetrics(data.metrics);
        setTax(data.tax ?? null);
        if (data.sensitivity) setSensitivity(data.sensitivity);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[useDealProjections] Edge Function error:', msg);
        setError(msg);
        // Keep showing the last known metrics rather than going blank
      } finally {
        // Guard: only clear loading if this is still the active request
        if (currentDealIdRef.current === (target.id)) {
          setLoading(false);
        }
      }
    },
    [],
  );

  // Primary effect: call when deal changes (debounced)
  useEffect(() => {
    if (!deal) {
      setMetrics(null);
      setTax(null);
      setSensitivity(null);
      return;
    }

    // Immediately show any cached metrics from the DB row while loading
    if (deal.metrics && !metrics) {
      setMetrics(deal.metrics as unknown as DealMetrics);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      callEdgeFunction(deal, undefined, {
        sensitivity: initialOptions?.computeSensitivity ?? false,
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // We intentionally only react to the deal ID and inputs fingerprint, not the full deal object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id, JSON.stringify(deal?.inputs)]);

  const recalculate = useCallback(
    async (overrides?: Partial<DealInputs>, opts?: { sensitivity?: boolean }) => {
      if (!deal) return;
      await callEdgeFunction(deal, overrides, opts);
    },
    [deal, callEdgeFunction],
  );

  return { metrics, tax, sensitivity, loading, error, recalculate };
}
