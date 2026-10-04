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

// Implemented in the next commit: totalsByMonth, trailing12Months, totalsByCategory.
