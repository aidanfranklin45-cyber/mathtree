import type { DealRecord } from '../math/types';

export type DashboardStatusFilter = 'owned' | 'prospect' | 'all';

/**
 * Determine whether "Mark Owned" is valid for the current selection and filter.
 * False if the user is already viewing the Owned Portfolio, or if all selected deals are already owned.
 */
export function canBulkMarkOwned(
  statusFilter: DashboardStatusFilter,
  selectedDeals: Array<Pick<DealRecord, 'status'>>
): boolean {
  if (statusFilter === 'owned') return false;
  if (selectedDeals.length === 0) return true;
  return selectedDeals.some((d) => d.status !== 'owned');
}

/**
 * Determine whether "Move Pipeline" is valid for the current selection and filter.
 * False if the user is already viewing the Pipeline / Prospects tab, or if none of the selected deals are owned.
 */
export function canBulkMovePipeline(
  statusFilter: DashboardStatusFilter,
  selectedDeals: Array<Pick<DealRecord, 'status'>>
): boolean {
  if (statusFilter === 'prospect') return false;
  if (selectedDeals.length === 0) return true;
  return selectedDeals.some((d) => (d.status || 'prospect') === 'owned');
}
