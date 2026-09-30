/** Same formatting the legacy pages used: "$1,234", "-$10,080" (sign before the currency symbol), "$0" for empty. */
export function formatCurrency(val: number | null | undefined): string {
  if (!val || isNaN(val)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}
