import { describe, it, expect } from 'vitest';
import { computeDealMetrics } from './testEngine';

const deal = (over: Record<string, unknown> = {}): any => ({
  id: 'd1', asset_class: 'commercial', purchase_price: 500000,
  inputs: {
    purchasePrice: 500000, downPaymentPercent: 25, interestRate: 6, loanTerm: 25, exitYear: 5, closingDate: '2025-01-01',
    closingCosts: 5000, grossRentAnnual: 60000, monthlyRent: 5000, vacancyRate: 5, expenseRatio: 30, targetCapRate: 7,
    leaseType: 'NNN', discountRate: 8, ...over,
  },
});
const finite = (o: any, path = ''): string[] => {
  const bad: string[] = [];
  const walk = (v: any, p: string) => {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${p}.${k}`));
  };
  walk(o, path);
  return bad;
};

describe('degenerate inputs produce finite metrics', () => {
  const cases: Record<string, Record<string, unknown>> = {
    'all cash (100% down)': { downPaymentPercent: 100 },
    'zero rate loan': { interestRate: 0 },
    'exit year 1': { exitYear: 1 },
    'zero rent': { grossRentAnnual: 0, monthlyRent: 0 },
    'zero purchase price': { purchasePrice: 0 },
    'zero closing costs': { closingCosts: 0 },
    'zero target cap': { targetCapRate: 0 },
    'zero discount rate': { discountRate: 0 },
    'expenses over 100%': { expenseRatio: 120 },
    'vacancy 100%': { vacancyRate: 100 },
    'loan term shorter than hold': { loanTerm: 3 },
    'zero loan term': { loanTerm: 0 },
    'leap-day close': { closingDate: '2024-02-29' },
    'dec 31 close': { closingDate: '2025-12-31' },
  };
  for (const [name, over] of Object.entries(cases)) {
    it(name, () => {
      const m: any = computeDealMetrics(deal(over));
      expect(finite(m)).toEqual([]);
    });
  }
});
