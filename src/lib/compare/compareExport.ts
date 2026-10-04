import { ComparisonColumn } from './compareTypes';
import { METRIC_GROUPS, groupsForKeys } from './metrics';

/**
 * Generates and downloads a clean CSV spreadsheet comparing all active columns.
 */
export function exportComparisonCSV(columns: ComparisonColumn[], metricKeys?: string[]): void {
  if (!columns || columns.length === 0) return;

  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headers = ['Category', 'Metric', ...columns.map((c) => `${c.dealTitle} (${c.scenarioName})`)];

  const rows: Array<[string, string, ...string[]]> = [
    ['PROPERTY IDENTITY', 'Asset Class', ...columns.map((c) => c.assetClass)],
    ['PROPERTY IDENTITY', 'Status', ...columns.map((c) => (c.status === 'owned' ? 'Owned' : 'Pipeline'))],
    ['PROPERTY IDENTITY', 'Location', ...columns.map((c) => c.location)],
    ['PROPERTY IDENTITY', 'Scenario Name', ...columns.map((c) => c.scenarioName)],
  ];
  // The metrics the board shows (all of them when none are given), in the same order and wording as the matrix
  for (const g of metricKeys ? groupsForKeys(metricKeys) : METRIC_GROUPS) {
    for (const m of g.metrics) rows.push([g.title, m.label, ...columns.map((c) => m.format(m.get(c.summary)))]);
  }

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `MathTree_Project_Comparison_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
