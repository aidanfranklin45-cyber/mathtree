// Sanity limits for figures parsed from CSVs and offering memorandums. These catch
// unit slips (0.065 vs 6.5, 650 vs 6.5) and impossible values. They are NOT market data
// and are deliberately wide; a "warn" means "ask the user to confirm", never "fix it".

export type PlausibilityField = 'vacancy_pct' | 'cap_rate_pct' | 'expense_ratio_pct' | 'rent_growth_pct' | 'interest_rate_pct' | 'ltv_pct';

interface Range { min: number; max: number; warnMin: number; warnMax: number }

const RANGES: Record<PlausibilityField, Range> = {
  vacancy_pct: { min: 0, max: 100, warnMin: 0, warnMax: 40 },
  cap_rate_pct: { min: 0.5, max: 25, warnMin: 2, warnMax: 15 },
  expense_ratio_pct: { min: 0, max: 100, warnMin: 5, warnMax: 80 },
  rent_growth_pct: { min: -30, max: 30, warnMin: -5, warnMax: 10 },
  interest_rate_pct: { min: 0, max: 30, warnMin: 2, warnMax: 15 },
  ltv_pct: { min: 0, max: 100, warnMin: 0, warnMax: 90 },
};

export interface PlausibilityResult {
  level: 'ok' | 'warn' | 'invalid';
  message: string | null;
}

export function checkPlausibility(field: PlausibilityField, value: number): PlausibilityResult {
  const r = RANGES[field];
  if (!Number.isFinite(value)) return { level: 'invalid', message: 'Not a number' };
  if (value < r.min || value > r.max) return { level: 'invalid', message: `Outside ${r.min}% to ${r.max}%` };
  // A fraction in a percent field (0.065 for 6.5%) is the most common parsing slip.
  if (value > 0 && value < 1 && field !== 'vacancy_pct' && field !== 'rent_growth_pct' && value < r.warnMin) {
    return { level: 'warn', message: `Looks like a fraction; did you mean ${(value * 100).toFixed(2)}%?` };
  }
  if (value < r.warnMin || value > r.warnMax) return { level: 'warn', message: `Unusual; typical range is ${r.warnMin}% to ${r.warnMax}%. Confirm with the source` };
  return { level: 'ok', message: null };
}
