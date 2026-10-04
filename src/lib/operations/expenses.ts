/** Actual operating expenses for an owned property (owner-only ledger; tenant-reimbursed NNN items live in recoveries.ts). */

export type ExpenseCategory =
  | 'property_tax' | 'insurance' | 'utilities' | 'repairs_maintenance' | 'management'
  | 'landscaping_snow' | 'cleaning' | 'legal_professional' | 'marketing' | 'other';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  property_tax: 'Property tax',
  insurance: 'Insurance',
  utilities: 'Utilities',
  repairs_maintenance: 'Repairs & maintenance',
  management: 'Management',
  landscaping_snow: 'Landscaping & snow',
  cleaning: 'Cleaning',
  legal_professional: 'Legal & professional',
  marketing: 'Marketing',
  other: 'Other',
};

/** One row of public.expense_entries. expense_date is YYYY-MM-DD. */
export interface ExpenseEntry {
  id: string;
  deal_id: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  vendor_note: string | null;
  recurring: boolean;
}

export interface MonthTotal { month: string; total: number }
export interface CategoryTotal { category: ExpenseCategory; total: number }

/** Money is summed in integer cents to avoid float drift. */
const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/** 'YYYY-MM' from a 'YYYY-MM-DD' string (no Date/timezone use). */
const monthOf = (date: string): string => date.slice(0, 7);

/** Sums by calendar month, ascending; months with no entries are omitted. */
export function totalsByMonth(entries: ExpenseEntry[]): MonthTotal[] {
  const cents = new Map<string, number>();
  for (const e of entries) {
    const m = monthOf(e.expense_date);
    cents.set(m, (cents.get(m) ?? 0) + toCents(e.amount));
  }
  return [...cents.keys()].sort().map(month => ({ month, total: fromCents(cents.get(month)!) }));
}

/** Exactly 12 zero-filled months ending with asOf's month; later or earlier entries are excluded. */
export function trailing12Months(entries: ExpenseEntry[], asOf: string): { total: number; months: MonthTotal[] } {
  const endYear = Number(asOf.slice(0, 4));
  const endMonth = Number(asOf.slice(5, 7));
  const keys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const idx = endYear * 12 + (endMonth - 1) - i;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    keys.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
  }
  const cents = new Map<string, number>(keys.map(k => [k, 0]));
  for (const e of entries) {
    const m = monthOf(e.expense_date);
    if (cents.has(m)) cents.set(m, cents.get(m)! + toCents(e.amount));
  }
  const months = keys.map(month => ({ month, total: fromCents(cents.get(month)!) }));
  const totalCents = keys.reduce((s, k) => s + cents.get(k)!, 0);
  return { total: fromCents(totalCents), months };
}

/** Sums by category (optionally within an inclusive YYYY-MM-DD range), descending by total then category name; zero totals omitted. */
export function totalsByCategory(entries: ExpenseEntry[], range?: { from: string; to: string }): CategoryTotal[] {
  const cents = new Map<ExpenseCategory, number>();
  for (const e of entries) {
    if (range && (e.expense_date < range.from || e.expense_date > range.to)) continue;
    cents.set(e.category, (cents.get(e.category) ?? 0) + toCents(e.amount));
  }
  return [...cents.entries()]
    .filter(([, c]) => c !== 0)
    .map(([category, c]) => ({ category, total: fromCents(c) }))
    .sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}
