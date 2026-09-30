import type { DealRecord } from '../math/types';

/** First calendar year of the projection: year of the closing (or LOI) date, else the current year. */
export function getProjectionStartYear(deal: Pick<DealRecord, 'inputs'>): number {
  const inputs: Record<string, any> = deal.inputs || {};
  const dateStr = inputs.closingDate || inputs.loiDate;
  if (dateStr) {
    const match = String(dateStr).match(/(\d{4})/);
    if (match) {
      const yr = parseInt(match[1], 10);
      if (yr >= 1900 && yr <= 2150) return yr;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getFullYear()) && d.getFullYear() >= 1900) return d.getFullYear();
  }
  return new Date().getFullYear();
}

/**
 * The operating year the KPI cards default to: for deals that started in a prior year this is the
 * current calendar year's index, otherwise year 1.
 */
export function getDefaultTargetYear(startYear: number, projectionCount: number, today = new Date()): number {
  const systemYear = today.getFullYear();
  if (startYear <= systemYear) return Math.min(projectionCount, Math.max(1, systemYear - startYear + 1));
  return 1;
}
