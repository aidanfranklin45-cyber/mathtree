import { describe, it, expect } from 'vitest';
import {
  totalsByMonth, trailing12Months, totalsByCategory,
  type ExpenseEntry, type ExpenseCategory,
} from './expenses';

let n = 0;
const entry = (expense_date: string, amount: number, category: ExpenseCategory = 'utilities'): ExpenseEntry => ({
  id: `e${++n}`, deal_id: 'd1', expense_date, category, amount, vendor_note: null, recurring: false,
});

describe('totalsByMonth', () => {
  it('groups multiple entries per month, ascending, omitting empty months', () => {
    const out = totalsByMonth([
      entry('2026-03-15', 100), entry('2026-01-02', 50), entry('2026-03-01', 25.5),
    ]);
    expect(out).toEqual([{ month: '2026-01', total: 50 }, { month: '2026-03', total: 125.5 }]);
  });
  it('sorts across a year boundary', () => {
    const out = totalsByMonth([entry('2027-01-01', 1), entry('2026-12-31', 2)]);
    expect(out.map(m => m.month)).toEqual(['2026-12', '2027-01']);
  });
  it('rounds to cents', () => {
    expect(totalsByMonth([entry('2026-05-01', 0.1), entry('2026-05-02', 0.2)])).toEqual([{ month: '2026-05', total: 0.3 }]);
  });
  it('returns [] for empty input', () => {
    expect(totalsByMonth([])).toEqual([]);
  });
});

describe('trailing12Months', () => {
  it('returns 12 zero-filled ascending months ending at asOf month', () => {
    const r = trailing12Months([entry('2026-06-10', 40)], '2026-08-20');
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe('2025-09');
    expect(r.months[11].month).toBe('2026-08');
    expect(r.months.find(m => m.month === '2026-06')!.total).toBe(40);
    expect(r.months.filter(m => m.total === 0)).toHaveLength(11);
    expect(r.total).toBe(40);
  });
  it('handles the year boundary', () => {
    const r = trailing12Months([], '2026-01-31');
    expect(r.months[0].month).toBe('2025-02');
    expect(r.months[11].month).toBe('2026-01');
    expect(r.total).toBe(0);
  });
  it('includes window edges and excludes outside entries', () => {
    const r = trailing12Months([
      entry('2025-08-31', 999),  // before window (window starts 2025-09)
      entry('2025-09-01', 10),   // first day of window
      entry('2026-08-31', 20),   // last day of asOf month, after asOf day but same month
      entry('2026-09-01', 999),  // after asOf month
    ], '2026-08-15');
    expect(r.total).toBe(30);
    expect(r.months[0]).toEqual({ month: '2025-09', total: 10 });
    expect(r.months[11]).toEqual({ month: '2026-08', total: 20 });
  });
  it('rounds the total to cents', () => {
    const r = trailing12Months([entry('2026-02-01', 0.1), entry('2026-03-01', 0.2)], '2026-03-31');
    expect(r.total).toBe(0.3);
  });
});

describe('totalsByCategory', () => {
  const data = [
    entry('2026-01-10', 100, 'insurance'),
    entry('2026-02-10', 300, 'property_tax'),
    entry('2026-03-10', 50, 'insurance'),
    entry('2026-03-11', 150, 'cleaning'),
  ];
  it('sorts by total desc then category name', () => {
    expect(totalsByCategory(data)).toEqual([
      { category: 'property_tax', total: 300 },
      { category: 'cleaning', total: 150 },
      { category: 'insurance', total: 150 },
    ]);
  });
  it('filters by inclusive range and omits zero categories', () => {
    expect(totalsByCategory(data, { from: '2026-01-10', to: '2026-02-10' })).toEqual([
      { category: 'property_tax', total: 300 },
      { category: 'insurance', total: 100 },
    ]);
    expect(totalsByCategory(data, { from: '2027-01-01', to: '2027-12-31' })).toEqual([]);
  });
  it('rounds to cents', () => {
    expect(totalsByCategory([entry('2026-01-01', 0.1, 'other'), entry('2026-01-02', 0.2, 'other')]))
      .toEqual([{ category: 'other', total: 0.3 }]);
  });
  it('returns [] for empty input', () => {
    expect(totalsByCategory([])).toEqual([]);
  });
});
