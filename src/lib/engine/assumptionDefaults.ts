/**
 * The signed-in investor's underwriting assumptions (set in their profile), held here, away from the profile and network code, so the
 * engine wrapper can read them synchronously and tests stay free of the Supabase client. Same shape as `expiryDefaults.ts`.
 *
 * A property that does not state an assumption the engine needs (vacancy, expense ratio, selling costs, reserves, carrying costs, ...) is
 * computed with the owner's assumption for it, live: change the assumption in the profile and every property that relies on it follows.
 * Facts about a deal (closing date, the loan, a lease's rent) are never filled from here.
 */
import { useSyncExternalStore } from 'react';
import { suggestedStartingPoints, type UnderwritingAssumptions } from '../../../supabase/functions/_shared/underwritingAssumptions';

export interface AssumptionDefaults {
  assumptions: UnderwritingAssumptions;
  /** The profile's hurdle rate and hold, which sit beside the assumptions in the profile. */
  discountRate?: number;
  exitYear?: number;
}

/** No assumption has been saved yet: the labelled starting points apply until the owner sets their own. */
export const isEmptyAssumptions = (a: UnderwritingAssumptions | null | undefined): boolean =>
  !a || (Object.keys(a.assets ?? {}).length === 0 && a.taxRate === undefined && a.propertyTaxRatePercent === undefined && a.assumedClosingWeeks === undefined);

// Before the profile has loaded, the starting points apply, with the same hurdle rate and hold the profile itself shows by default
let current: AssumptionDefaults = { assumptions: suggestedStartingPoints(null), discountRate: 8, exitYear: 10 };
let version = 0;
const listeners = new Set<() => void>();

export const getAssumptionDefaults = (): AssumptionDefaults => current;
export const getAssumptionDefaultsVersion = (): number => version;

export function setAssumptionDefaults(next: AssumptionDefaults): void {
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (!changed) return;
  current = next;
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeAssumptionDefaults(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Re-renders the caller when the owner's assumptions change, so figures that rely on them follow. Returns a version to use in memo deps. */
export function useAssumptionVersion(): number {
  return useSyncExternalStore(subscribeAssumptionDefaults, getAssumptionDefaultsVersion);
}
