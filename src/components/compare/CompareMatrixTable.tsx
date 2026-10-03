import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ComparisonColumn, ComparisonSummary, WinnerAnalysis } from '../../lib/compare/compareTypes';
import { formatCurrency } from '../../lib/format';
import {
  Trophy,
  DollarSign,
  TrendingUp,
  ShieldCheck,
  Tag,
  ExternalLink,
  X,
  Star,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';

interface CompareMatrixTableProps {
  columns: ComparisonColumn[];
  winners: WinnerAnalysis;
  onRemoveColumn: (colId: string) => void;
  onSetBenchmark: (colId: string) => void;
  onOpenAddModal: () => void;
}

interface MetricRowDef {
  key: string;
  label: string;
  description?: string;
  get: (s: ComparisonSummary) => number | null;
  format: (v: number | null) => React.ReactNode;
  isLowerBetter?: boolean;
  isPct?: boolean;
  isCurrency?: boolean;
  highlight?: boolean;
}

export const CompareMatrixTable: React.FC<CompareMatrixTableProps> = ({
  columns,
  winners,
  onRemoveColumn,
  onSetBenchmark,
  onOpenAddModal,
}) => {
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const benchmarkCol = columns.find((c) => c.isBenchmark) || columns[0];

  const formatPct = (v: number | null) => (v !== null && v !== undefined && !isNaN(v) ? `${v.toFixed(2)}%` : '—');
  const formatMultiple = (v: number | null) => (v !== null && v !== undefined && !isNaN(v) ? `${v.toFixed(2)}x` : '—');
  const formatMoney = (v: number | null) => (v !== null && v !== undefined && !isNaN(v) ? formatCurrency(v) : '—');
  const formatNum = (v: number | null, suffix = '') => (v !== null && v !== undefined && !isNaN(v) ? `${v}${suffix}` : '—');

  // Groups and metric definitions
  const CATEGORIES: Array<{
    id: string;
    title: string;
    accentColor: string;
    rows: MetricRowDef[];
  }> = [
    {
      id: 'returns',
      title: 'FINANCIAL RETURNS & INVESTMENT YIELD',
      accentColor: 'text-brand-400',
      rows: [
        {
          key: 'irr',
          label: '10-Year Levered IRR',
          description: 'Annualized rate of return taking into account debt service and 10-year terminal sale equity',
          get: (s) => s.irr,
          format: formatPct,
          isPct: true,
          highlight: true,
        },
        {
          key: 'cashOnCash',
          label: 'Year 1 Cash-on-Cash Return',
          description: 'Year 1 net cash flow divided by total initial cash equity invested',
          get: (s) => s.cashOnCashYear1,
          format: formatPct,
          isPct: true,
          highlight: true,
        },
        {
          key: 'blendedCoC',
          label: '10-Year Blended CoC Yield',
          description: 'Average annual operational cash-on-cash yield over the 10-year holding period',
          get: (s) => s.blendedCoC,
          format: formatPct,
          isPct: true,
        },
        {
          key: 'equityMultiple',
          label: '10-Year Equity Multiple',
          description: 'Total cumulative cash flow plus exit equity divided by initial cash invested',
          get: (s) => s.equityMultiple,
          format: formatMultiple,
          highlight: true,
        },
        {
          key: 'npv',
          label: '10-Year Net Present Value (NPV)',
          description: 'Discounted net present value of all cash flows and residual equity at underwriting hurdle rate',
          get: (s) => s.npv,
          format: formatMoney,
          isCurrency: true,
        },
        {
          key: 'totalWealth',
          label: '10-Year Net Wealth Created',
          description: 'Total net dollars generated after initial equity return',
          get: (s) => s.totalWealthCreated,
          format: formatMoney,
          isCurrency: true,
          highlight: true,
        },
      ],
    },
    {
      id: 'capital',
      title: 'CAPITAL STACK & FINANCING BASIS',
      accentColor: 'text-cyan-400',
      rows: [
        {
          key: 'purchasePrice',
          label: 'Purchase Basis',
          description: 'Total contract purchase price / asset acquisition basis',
          get: (s) => s.purchasePrice,
          format: formatMoney,
          isCurrency: true,
          isLowerBetter: true,
        },
        {
          key: 'initialCash',
          label: 'Initial Cash Equity Required',
          description: 'Total upfront out-of-pocket cash (down payment + closing costs + initial CapEx)',
          get: (s) => s.initialCash,
          format: formatMoney,
          isCurrency: true,
          isLowerBetter: true,
        },
        {
          key: 'loanAmount',
          label: 'Senior Debt Financed',
          description: 'Principal loan balance at acquisition',
          get: (s) => s.loanAmount,
          format: formatMoney,
          isCurrency: true,
        },
        {
          key: 'ltv',
          label: 'Loan-to-Value (LTV %)',
          description: 'Debt divided by purchase price at acquisition',
          get: (s) => (s.purchasePrice > 0 ? (s.loanAmount / s.purchasePrice) * 100 : 0),
          format: formatPct,
          isPct: true,
          isLowerBetter: true,
        },
        {
          key: 'interestRate',
          label: 'Mortgage Interest Rate',
          description: 'Annual interest rate on senior financing',
          get: (s) => s.interestRate,
          format: formatPct,
          isPct: true,
          isLowerBetter: true,
        },
        {
          key: 'loanTerm',
          label: 'Amortization Term',
          description: 'Length of loan amortization schedule in years',
          get: (s) => s.loanTerm,
          format: (v) => formatNum(v, ' yrs'),
        },
        {
          key: 'monthlyDebt',
          label: 'Monthly Debt Service',
          description: 'Monthly principal and interest payment obligation',
          get: (s) => s.monthlyDebt,
          format: (v) => (v !== null ? `${formatCurrency(v)}/mo` : '—'),
          isCurrency: true,
          isLowerBetter: true,
        },
        {
          key: 'annualDebt',
          label: 'Annual Debt Service',
          description: 'Total year 1 debt service payments',
          get: (s) => s.annualDebt,
          format: formatMoney,
          isCurrency: true,
          isLowerBetter: true,
        },
      ],
    },
    {
      id: 'operations',
      title: 'OPERATING CASH FLOW & ASSET HEALTH',
      accentColor: 'text-emerald-400',
      rows: [
        {
          key: 'grossRentAnnual',
          label: 'Gross Potential Rent (Annual)',
          description: 'Top-line gross rent roll scheduled at 100% occupancy',
          get: (s) => s.grossRentAnnual,
          format: formatMoney,
          isCurrency: true,
        },
        {
          key: 'grossRentMonthly',
          label: 'Gross Rent (Monthly)',
          description: 'Monthly scheduled revenue at 100% occupancy',
          get: (s) => s.grossRentMonthly,
          format: (v) => (v !== null ? `${formatCurrency(v)}/mo` : '—'),
          isCurrency: true,
        },
        {
          key: 'vacancyRate',
          label: 'Underwritten Vacancy Rate',
          description: 'Estimated vacancy allowance percentage',
          get: (s) => s.vacancyRate,
          format: formatPct,
          isPct: true,
          isLowerBetter: true,
        },
        {
          key: 'operatingExpenses',
          label: 'Operating Expenses (Yr 1)',
          description: 'Annual property taxes, insurance, repairs, management, and utilities',
          get: (s) => s.operatingExpenses,
          format: formatMoney,
          isCurrency: true,
          isLowerBetter: true,
        },
        {
          key: 'expenseRatio',
          label: 'Operating Expense Ratio',
          description: 'Operating expenses divided by gross revenue',
          get: (s) => s.expenseRatio,
          format: formatPct,
          isPct: true,
          isLowerBetter: true,
        },
        {
          key: 'noi',
          label: 'Net Operating Income (NOI)',
          description: 'Effective gross income minus total operating expenses (pre-debt cash flow)',
          get: (s) => s.noi,
          format: formatMoney,
          isCurrency: true,
          highlight: true,
        },
        {
          key: 'capRateYear1',
          label: 'Going-In Cap Rate Yield',
          description: 'Year 1 Net Operating Income divided by purchase price',
          get: (s) => s.capRateYear1,
          format: formatPct,
          isPct: true,
          highlight: true,
        },
        {
          key: 'exitCapRate',
          label: 'Exit / Terminal Cap Rate',
          description: 'Projected cap rate used to determine Year 10 exit sale valuation',
          get: (s) => s.exitCapRate,
          format: formatPct,
          isPct: true,
        },
        {
          key: 'dscr',
          label: 'Senior DSCR (Debt Coverage)',
          description: 'Net Operating Income divided by annual debt service (lender coverage ratio)',
          get: (s) => s.dscr,
          format: (v) => (v !== null ? `${v.toFixed(2)}x` : 'N/A (All Cash)'),
          highlight: true,
        },
        {
          key: 'cashFlowYear1',
          label: 'Year 1 Net Operational Cash Flow',
          description: 'NOI minus debt service (actual bottom-line cash pocketed in year 1)',
          get: (s) => s.cashFlowYear1,
          format: formatMoney,
          isCurrency: true,
          highlight: true,
        },
      ],
    },
    {
      id: 'projections',
      title: '10-YEAR EXIT & TERMINAL OUTLOOK',
      accentColor: 'text-amber-400',
      rows: [
        {
          key: 'tenYearCashFlow',
          label: '10-Year Cumulative Cash Flow',
          description: 'Total aggregate post-debt cash flows over 10 years of operation',
          get: (s) => s.tenYearCashFlow,
          format: formatMoney,
          isCurrency: true,
        },
        {
          key: 'terminalValue',
          label: 'Year 10 Terminal Value',
          description: 'Projected property resale value in Year 10 based on capitalized NOI',
          get: (s) => s.tenYearTerminalValue,
          format: formatMoney,
          isCurrency: true,
        },
      ],
    },
  ];

  if (columns.length === 0) {
    return (
      <div className="p-12 text-center rounded-3xl bg-slate-900/40 border border-dashed border-slate-800 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-slate-800 text-emerald-400 mx-auto flex items-center justify-center font-bold text-2xl shadow-inner">
          ⚖️
        </div>
        <h3 className="text-base font-black text-white">No Assets Selected for Comparison</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Add properties or scenario variations to compare financial return profiles, capital allocations, and financing terms side-by-side.
        </p>
        <button
          onClick={onOpenAddModal}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-500/20"
        >
          + Select Properties to Compare
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Winner Spotlight Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Best IRR */}
        {winners.maxIrrId && (
          <div className="bg-gradient-to-b from-brand-950/40 to-slate-900/60 border border-brand-800/40 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center space-x-1.5 text-brand-400 text-[10px] font-extrabold uppercase tracking-wider">
              <Trophy className="w-3.5 h-3.5" />
              <span>Highest IRR</span>
            </div>
            {(() => {
              const winCol = columns.find((c) => c.id === winners.maxIrrId);
              if (!winCol) return null;
              return (
                <div className="mt-1">
                  <span className="text-lg font-black text-white block tabular-nums">
                    {winCol.summary.irr.toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-slate-300 font-semibold truncate block">
                    {winCol.dealTitle}
                  </span>
                  <span className="hidden sm:block text-[10px] text-brand-400/80 font-mono">
                    {winCol.scenarioName}
                  </span>
                </div>
              );
            })()}
          </div>
        )}

        {/* Best Cash Flow */}
        {winners.maxCashFlowId && (
          <div className="bg-gradient-to-b from-emerald-950/40 to-slate-900/60 border border-emerald-800/40 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center space-x-1.5 text-emerald-400 text-[10px] font-extrabold uppercase tracking-wider">
              <DollarSign className="w-3.5 h-3.5" />
              <span>Top Cash Flow</span>
            </div>
            {(() => {
              const winCol = columns.find((c) => c.id === winners.maxCashFlowId);
              if (!winCol) return null;
              return (
                <div className="mt-1">
                  <span className="text-lg font-black text-emerald-300 block tabular-nums">
                    {formatCurrency(winCol.summary.cashFlowYear1)}/yr
                  </span>
                  <span className="text-[11px] text-slate-300 font-semibold truncate block">
                    {winCol.dealTitle}
                  </span>
                  <span className="hidden sm:block text-[10px] text-emerald-400/80 font-mono">
                    {winCol.scenarioName}
                  </span>
                </div>
              );
            })()}
          </div>
        )}

        {/* Highest Equity Multiple */}
        {winners.maxMultipleId && (
          <div className="bg-gradient-to-b from-cyan-950/40 to-slate-900/60 border border-cyan-800/40 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center space-x-1.5 text-cyan-400 text-[10px] font-extrabold uppercase tracking-wider">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Top Multiple</span>
            </div>
            {(() => {
              const winCol = columns.find((c) => c.id === winners.maxMultipleId);
              if (!winCol) return null;
              return (
                <div className="mt-1">
                  <span className="text-lg font-black text-white block tabular-nums">
                    {winCol.summary.equityMultiple.toFixed(2)}x
                  </span>
                  <span className="text-[11px] text-slate-300 font-semibold truncate block">
                    {winCol.dealTitle}
                  </span>
                  <span className="hidden sm:block text-[10px] text-cyan-400/80 font-mono">
                    {winCol.scenarioName}
                  </span>
                </div>
              );
            })()}
          </div>
        )}

        {/* Strongest DSCR */}
        {winners.maxDscrId && (
          <div className="bg-gradient-to-b from-violet-950/40 to-slate-900/60 border border-violet-800/40 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center space-x-1.5 text-violet-400 text-[10px] font-extrabold uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Highest DSCR</span>
            </div>
            {(() => {
              const winCol = columns.find((c) => c.id === winners.maxDscrId);
              if (!winCol) return null;
              return (
                <div className="mt-1">
                  <span className="text-lg font-black text-white block tabular-nums">
                    {winCol.summary.dscr !== null ? `${winCol.summary.dscr.toFixed(2)}x` : 'N/A'}
                  </span>
                  <span className="text-[11px] text-slate-300 font-semibold truncate block">
                    {winCol.dealTitle}
                  </span>
                  <span className="hidden sm:block text-[10px] text-violet-400/80 font-mono">
                    {winCol.scenarioName}
                  </span>
                </div>
              );
            })()}
          </div>
        )}

        {/* Lowest Basis */}
        {winners.minPriceId && (
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-3 shadow-lg">
            <div className="flex items-center space-x-1.5 text-amber-400 text-[10px] font-extrabold uppercase tracking-wider">
              <Tag className="w-3.5 h-3.5" />
              <span>Lowest Basis</span>
            </div>
            {(() => {
              const winCol = columns.find((c) => c.id === winners.minPriceId);
              if (!winCol) return null;
              return (
                <div className="mt-1">
                  <span className="text-lg font-black text-white block tabular-nums">
                    {formatCurrency(winCol.summary.purchasePrice)}
                  </span>
                  <span className="text-[11px] text-slate-300 font-semibold truncate block">
                    {winCol.dealTitle}
                  </span>
                  <span className="hidden sm:block text-[10px] text-slate-400 font-mono">
                    {winCol.scenarioName}
                  </span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Main Table Container */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[700px]">
            {/* Table Header: Columns Info */}
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 sticky top-0 z-20">
                <th className="py-4 px-4 sm:px-6 w-64 min-w-[240px] text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                  <span>Metric / Scenario</span>
                </th>

                {columns.map((col, idx) => {
                  const isBench = benchmarkCol?.id === col.id;
                  return (
                    <th key={col.id} className="py-4 px-4 min-w-[200px] align-top relative">
                      <div className="flex flex-col justify-between h-full space-y-2">
                        {/* Top bar with actions */}
                        <div className="flex items-center justify-between gap-1">
                          <button
                            onClick={() => onSetBenchmark(col.id)}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center space-x-1 transition ${
                              isBench
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                            }`}
                            title={isBench ? 'Active benchmark for variance diffs' : 'Set as baseline benchmark'}
                          >
                            <Star className={`w-3 h-3 ${isBench ? 'fill-amber-400 text-amber-400' : ''}`} />
                            <span>{isBench ? 'Benchmark' : 'Set Base'}</span>
                          </button>

                          <div className="flex items-center space-x-1">
                            <Link
                              to={`/project?id=${col.dealId}`}
                              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition"
                              title="Open in Deal Studio"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                            <button
                              onClick={() => onRemoveColumn(col.id)}
                              className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                              title="Remove column"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Title & Badges */}
                        <div>
                          <h4 className="font-extrabold text-sm text-white line-clamp-1">
                            {col.dealTitle}
                          </h4>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 text-emerald-300 border border-slate-700">
                              {col.scenarioName}
                            </span>
                            <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800">
                              {col.assetClass}
                            </span>
                          </div>
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* Categorized Rows */}
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {CATEGORIES.map((cat) => {
                const isCollapsed = !!collapsedCategories[cat.id];
                return (
                  <React.Fragment key={cat.id}>
                    {/* Category Header Row */}
                    <tr
                      onClick={() => toggleCategory(cat.id)}
                      className="bg-slate-950/90 border-t border-b border-slate-800 hover:bg-slate-900 cursor-pointer select-none transition"
                    >
                      <td
                        colSpan={columns.length + 1}
                        className="py-2.5 px-4 sm:px-6 text-[11px] font-extrabold tracking-wider uppercase text-slate-300"
                      >
                        <div className="flex items-center space-x-2">
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span className={cat.accentColor}>{cat.title}</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            ({cat.rows.length} metrics)
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Metric Data Rows */}
                    {!isCollapsed &&
                      cat.rows.map((row) => {
                        const benchVal = benchmarkCol ? row.get(benchmarkCol.summary) : null;

                        return (
                          <tr
                            key={row.key}
                            className={`hover:bg-slate-800/40 transition group ${
                              row.highlight ? 'bg-slate-900/30' : ''
                            }`}
                          >
                            {/* Metric Label & Description */}
                            <td className="py-2.5 px-4 sm:px-6 align-middle border-r border-slate-800/40">
                              <div className="flex flex-col">
                                <span
                                  className={`text-xs ${
                                    row.highlight
                                      ? 'font-bold text-white'
                                      : 'font-semibold text-slate-300'
                                  }`}
                                >
                                  {row.label}
                                </span>
                                {row.description && (
                                  <span className="text-[10px] text-slate-500 line-clamp-1">
                                    {row.description}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Column Values */}
                            {columns.map((col) => {
                              const val = row.get(col.summary);
                              const isBench = benchmarkCol?.id === col.id;

                              // Variance vs Benchmark
                              let varianceBadge: React.ReactNode = null;
                              if (!isBench && benchVal !== null && val !== null && Math.abs(val - benchVal) > 0.001) {
                                const diff = val - benchVal;
                                const isPositive = diff > 0;
                                const isBetter = row.isLowerBetter ? !isPositive : isPositive;
                                const color = isBetter ? 'text-emerald-400' : 'text-rose-400';
                                const sign = isPositive ? '+' : '';

                                let diffStr = '';
                                if (row.isPct) {
                                  diffStr = `${sign}${diff.toFixed(2)}%`;
                                } else if (row.isCurrency) {
                                  diffStr = `${isPositive ? '+$' : '-$'}${Math.abs(Math.round(diff)).toLocaleString()}`;
                                } else {
                                  diffStr = `${sign}${diff.toFixed(2)}`;
                                }

                                varianceBadge = (
                                  <span className={`text-[10px] font-bold ${color} block text-right font-mono`}>
                                    {diffStr}
                                  </span>
                                );
                              }

                              return (
                                <td
                                  key={col.id}
                                  className={`py-2.5 px-4 align-middle tabular-nums ${
                                    isBench ? 'bg-slate-950/40 font-bold' : ''
                                  }`}
                                >
                                  <div className="flex items-center justify-between space-x-2">
                                    <span
                                      className={`text-xs ${
                                        row.highlight
                                          ? 'font-black text-white'
                                          : 'font-semibold text-slate-200'
                                      }`}
                                    >
                                      {row.format(val)}
                                    </span>
                                    {varianceBadge}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="py-3 px-6 bg-slate-950/80 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
          <div className="flex items-center space-x-2">
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span>
              Variances are automatically calculated against the active <strong>Benchmark</strong> column (marked with ★).
            </span>
          </div>
          <button
            onClick={onOpenAddModal}
            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
          >
            + Add Another Asset / Variation
          </button>
        </div>
      </div>
    </div>
  );
};
