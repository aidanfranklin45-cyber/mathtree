import { ComparisonColumn } from './compareTypes';
import { formatCurrency } from '../format';

/**
 * Generates and downloads a clean CSV spreadsheet comparing all active columns.
 */
export function exportComparisonCSV(columns: ComparisonColumn[]): void {
  if (!columns || columns.length === 0) return;

  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headers = ['Category', 'Metric', ...columns.map((c) => `${c.dealTitle} (${c.scenarioName})`)];

  const rows: Array<[string, string, ...string[]]> = [
    // Identity
    ['PROPERTY IDENTITY', 'Asset Class', ...columns.map((c) => c.assetClass)],
    ['PROPERTY IDENTITY', 'Status', ...columns.map((c) => (c.status === 'owned' ? 'Owned' : 'Pipeline'))],
    ['PROPERTY IDENTITY', 'Location', ...columns.map((c) => c.location)],
    ['PROPERTY IDENTITY', 'Scenario Name', ...columns.map((c) => c.scenarioName)],

    // Returns
    ['RETURNS & PERFORMANCE', '10-Yr Levered IRR (%)', ...columns.map((c) => `${c.summary.irr.toFixed(2)}%`)],
    ['RETURNS & PERFORMANCE', 'Year 1 Cash-on-Cash (%)', ...columns.map((c) => `${c.summary.cashOnCashYear1.toFixed(2)}%`)],
    ['RETURNS & PERFORMANCE', '10-Yr Blended CoC (%)', ...columns.map((c) => `${c.summary.blendedCoC.toFixed(2)}%`)],
    ['RETURNS & PERFORMANCE', 'Equity Multiple', ...columns.map((c) => `${c.summary.equityMultiple.toFixed(2)}x`)],
    ['RETURNS & PERFORMANCE', '10-Yr Net Present Value (NPV)', ...columns.map((c) => formatCurrency(c.summary.npv))],
    ['RETURNS & PERFORMANCE', '10-Yr Net Wealth Created', ...columns.map((c) => formatCurrency(c.summary.totalWealthCreated))],

    // Valuation & Capital
    ['CAPITAL & FINANCING', 'Purchase Basis', ...columns.map((c) => formatCurrency(c.summary.purchasePrice))],
    ['CAPITAL & FINANCING', 'Initial Cash Invested', ...columns.map((c) => formatCurrency(c.summary.initialCash))],
    ['CAPITAL & FINANCING', 'Loan Amount', ...columns.map((c) => formatCurrency(c.summary.loanAmount))],
    ['CAPITAL & FINANCING', 'Interest Rate (%)', ...columns.map((c) => `${c.summary.interestRate.toFixed(2)}%`)],
    ['CAPITAL & FINANCING', 'Loan Term (Yrs)', ...columns.map((c) => `${c.summary.loanTerm}`)],
    ['CAPITAL & FINANCING', 'Monthly Debt Service', ...columns.map((c) => formatCurrency(c.summary.monthlyDebt))],
    ['CAPITAL & FINANCING', 'Annual Debt Service', ...columns.map((c) => formatCurrency(c.summary.annualDebt))],

    // Operations
    ['OPERATIONS & INCOME', 'Gross Annual Rent', ...columns.map((c) => formatCurrency(c.summary.grossRentAnnual))],
    ['OPERATIONS & INCOME', 'Gross Monthly Rent', ...columns.map((c) => formatCurrency(c.summary.grossRentMonthly))],
    ['OPERATIONS & INCOME', 'Underwritten Vacancy (%)', ...columns.map((c) => `${c.summary.vacancyRate.toFixed(1)}%`)],
    ['OPERATIONS & INCOME', 'Operating Expenses (Yr 1)', ...columns.map((c) => formatCurrency(c.summary.operatingExpenses))],
    ['OPERATIONS & INCOME', 'Operating Expense Ratio (%)', ...columns.map((c) => `${c.summary.expenseRatio.toFixed(1)}%`)],
    ['OPERATIONS & INCOME', 'Net Operating Income (NOI)', ...columns.map((c) => formatCurrency(c.summary.noi))],
    ['OPERATIONS & INCOME', 'Year 1 Going-In Cap Rate (%)', ...columns.map((c) => `${c.summary.capRateYear1.toFixed(2)}%`)],
    ['OPERATIONS & INCOME', 'Exit Cap Rate (%)', ...columns.map((c) => `${c.summary.exitCapRate.toFixed(2)}%`)],
    ['OPERATIONS & INCOME', 'Year 1 DSCR', ...columns.map((c) => (c.summary.dscr !== null ? `${c.summary.dscr.toFixed(2)}x` : 'N/A'))],
    ['OPERATIONS & INCOME', 'Year 1 Net Cash Flow', ...columns.map((c) => formatCurrency(c.summary.cashFlowYear1))],

    // 10-Yr Outlook
    ['10-YEAR OUTLOOK', '10-Yr Cumulative Cash Flow', ...columns.map((c) => formatCurrency(c.summary.tenYearCashFlow))],
    ['10-YEAR OUTLOOK', 'Year 10 Terminal Value', ...columns.map((c) => formatCurrency(c.summary.tenYearTerminalValue))],
  ];

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
