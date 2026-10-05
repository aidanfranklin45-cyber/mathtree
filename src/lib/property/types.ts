/**
 * Contract for the single property-state calculator (`resolvePropertyState`). Facts in, one labelled state out. Nothing here is
 * stored: the database holds the facts (deal, leases, units, rent payments) and this is derived on the fly.
 */


type Row = Record<string, any>;

/**
 * Where a figure comes from, so a screen can say so:
 * - `estimated`: the underwriting engine's forecast (assumptions, not records)
 * - `contracted`: read from the rent roll (leases and units tables)
 * - `collected`: real rent payments received
 * - `blended`: collected rent combined with an estimate (for example collected rent less forecast expenses, because no expense
 *   actuals are recorded yet)
 */
export type FigureBasis = 'estimated' | 'contracted' | 'collected' | 'blended';

/** A number that may be unknown. `value` is null (never 0) when the data to support it is missing. */
export interface Figure {
  value: number | null;
  basis: FigureBasis;
  /** One plain-language line on how it was derived or why it is blank. */
  note?: string;
}

/** Rows loaded for one deal from the `leases`, `units` and `rent_payments` tables. Pass `null` when they were not loaded. */
export interface PropertyFacts {
  leases: Row[];
  units: Row[];
  payments: Row[];
}

/** The engine's forecast for the same moment, supplied by the caller so this module stays free of the engine. */
export interface PropertyEstimate {
  value: number;
  noi: number;
  /** Null when the engine has no expense figure; actual-based NOI is then not offered. */
  operatingExpenses: number | null;
  /** Annual debt service for the current period. */
  debtService: number;
  cashFlow: number;
}

export interface CollectedRent {
  /** Months in the window that had a rent charge due on or before the as-of date. */
  months: number;
  /** Sum received for those months. */
  total: number;
  /** total / months x 12; null until at least MIN_COLLECTED_MONTHS months are observed. */
  annualised: number | null;
  /** Rent charged for the same months, to read collection against. */
  billed: number;
}

export interface PropertyState {
  stage: 'owned' | 'prospect';
  asOf: string;
  /** Demo deals never contribute actuals. */
  isDemo: boolean;
  rentRoll: {
    /** `tables` for an owned deal, `inputs` (the underwriting assumption) for a prospect, `none` when an owned deal has no leases. */
    source: 'tables' | 'inputs' | 'none';
    inForceCount: number;
    /** Contract rent per month across leases in force; null when there is no rent roll or no lease states a rent. */
    monthlyRent: number | null;
  };
  occupancy: Figure & { occupiedUnits: number; totalUnits: number };
  /** Null for prospects, demo deals, or when no payments are recorded. */
  collected: CollectedRent | null;
  value: Figure;
  noi: Figure;
  cashFlow: Figure;
}

export const MIN_COLLECTED_MONTHS = 3;
export const COLLECTED_WINDOW_MONTHS = 12;
