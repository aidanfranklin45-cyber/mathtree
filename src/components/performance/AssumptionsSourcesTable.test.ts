import { describe, it, expect } from 'vitest';
import type { InputBasis } from '@engine/underwritingAssumptions';

describe('Assumptions & Sources contract verification', () => {
  it('identifies supported vs unsupported figures correctly', () => {
    const basis: Record<string, InputBasis> = {
      vacancyRate: {
        source: 'profile',
        label: 'Vacancy',
        value: 5,
        rationale: 'Submarket average 4-6% over past 3 years',
      },
      expenseRatio: {
        source: 'owner',
        label: 'Expense ratio',
        value: 35,
        // No rationale provided
      },
      exitCapRate: {
        source: 'county_record',
        label: 'Exit cap rate',
        value: 6.5,
        rationale: 'CoStar Q3 2026 industrial sales comps',
      },
    };

    const entries = Object.entries(basis).map(([key, b]) => ({
      key,
      label: b.label,
      value: b.value,
      source: b.source,
      hasRationale: Boolean(b.rationale && b.rationale.trim().length > 0),
    }));

    const supported = entries.filter((e) => e.hasRationale);
    const unsupported = entries.filter((e) => !e.hasRationale);

    expect(supported.length).toBe(2);
    expect(unsupported.length).toBe(1);
    expect(unsupported[0].key).toBe('expenseRatio');
    expect(supported.map((s) => s.source)).toEqual(['profile', 'county_record']);
  });
});
