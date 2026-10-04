import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { formatCurrency } from '../../lib/format';
import { openDealBrief } from '../../lib/export/pdfBrief';
import { exportDealProformaCSV } from '../../lib/export/csvExport';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  ExternalLink,
  MoreVertical,
  CheckSquare,
  Square,
  Building,
  Home,
  Warehouse,
  Boxes,
} from 'lucide-react';

export type SortField =
  | 'title'
  | 'asset_class'
  | 'status'
  | 'value'
  | 'debt'
  | 'equity'
  | 'cashflow'
  | 'dscr'
  | 'return';

interface DealTableViewProps {
  deals: DealRecord[];
  selectedDealIds: Set<string>;
  onToggleSelect: (dealId: string) => void;
  onSelectAll: () => void;
  allSelected: boolean;
  onEdit: (deal: DealRecord) => void;
  onDelete: (deal: DealRecord) => void;
  onToggleStatus: (deal: DealRecord) => void;
  onPreview: (deal: DealRecord) => void;
  onShare?: (deal: DealRecord) => void;
  entities?: Array<{ id: string; name: string }>;
  collectedMonthlyMap?: Map<string, number>;
  sortField: SortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortField) => void;
}

const AssetClassBadge: React.FC<{ assetClass: string }> = ({ assetClass }) => {
  const normalized = assetClass.toLowerCase();
  if (normalized === 'multi-unit' || normalized === 'multi_family') {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[11px] font-bold">
        <Building className="w-3 h-3" />
        <span>Multi-Unit</span>
      </span>
    );
  }
  if (normalized === 'commercial') {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold">
        <Warehouse className="w-3 h-3" />
        <span>Commercial</span>
      </span>
    );
  }
  if (normalized === 'storage') {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-bold">
        <Boxes className="w-3 h-3" />
        <span>Storage</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-bold">
      <Home className="w-3 h-3" />
      <span>SFR</span>
    </span>
  );
};

export const DealTableView: React.FC<DealTableViewProps> = ({
  deals,
  selectedDealIds,
  onToggleSelect,
  onSelectAll,
  allSelected,
  onEdit,
  onDelete,
  onToggleStatus,
  onPreview,
  onShare,
  entities = [],
  collectedMonthlyMap,
  sortField,
  sortDirection,
  onSort,
}) => {
  const navigate = useNavigate();
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!activeMenuId) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [activeMenuId]);

  const renderSortHeader = (label: string, field: SortField, align: 'left' | 'right' = 'left') => {
    const isSorted = sortField === field;
    return (
      <th
        onClick={() => onSort(field)}
        className={`py-3 px-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white cursor-pointer select-none transition ${
          align === 'right' ? 'text-right' : 'text-left'
        }`}
      >
        <div className={`inline-flex items-center space-x-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
          <span>{label}</span>
          {isSorted ? (
            sortDirection === 'asc' ? (
              <ArrowUp className="w-3 h-3 text-emerald-400" />
            ) : (
              <ArrowDown className="w-3 h-3 text-emerald-400" />
            )
          ) : (
            <ArrowUpDown className="w-2.5 h-2.5 text-slate-600 hover:text-slate-400" />
          )}
        </div>
      </th>
    );
  };

  return (
    <div className="w-full bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/80 sticky top-0 z-10">
              <th className="py-3 px-3 w-10 text-center">
                <button
                  type="button"
                  onClick={onSelectAll}
                  aria-label="Select all deals"
                  className="text-slate-400 hover:text-white transition"
                >
                  {allSelected && deals.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </button>
              </th>
              {renderSortHeader('Property / Asset', 'title')}
              {renderSortHeader('Type', 'asset_class')}
              {renderSortHeader('Status', 'status')}
              {renderSortHeader('Current Value', 'value', 'right')}
              {renderSortHeader('Debt', 'debt', 'right')}
              {renderSortHeader('Equity', 'equity', 'right')}
              {renderSortHeader('Monthly Cash Flow', 'cashflow', 'right')}
              {renderSortHeader('DSCR', 'dscr', 'right')}
              {renderSortHeader('Return', 'return', 'right')}
              <th className="py-3 px-3 text-center text-[11px] font-extrabold uppercase tracking-wider text-slate-400 w-24">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {deals.map((deal) => {
              const isSelected = selectedDealIds.has(deal.id);
              const isOwned = deal.status === 'owned';
              const pit = resolvePointInTimeDealMetrics(deal, new Date());
              const engine = tryComputeDealMetrics(deal);
              const inputs = deal.inputs || {};
              const dealTitle = resolveDealDisplayName(deal);
              const locStr = deal.location || inputs.propertyAddress || deal.address || '—';
              const aClass = String(deal.asset_class || deal.assetType || 'commercial');

              // Value & Equity
              const valueFormatted = pit.currentVal > 0 ? formatCurrency(pit.currentVal) : '—';
              const debtFormatted = pit.currentDebt > 0 ? formatCurrency(pit.currentDebt) : '—';
              const equityFormatted = pit.currentEquity > 0 ? formatCurrency(pit.currentEquity) : '—';

              // Cash Flow & Collected vs. Estimated distinction
              const collectedMonthly = collectedMonthlyMap?.get(deal.id);
              const hasCollections = isOwned && collectedMonthly !== undefined && collectedMonthly > 0;
              const monthlyCashFlowVal = hasCollections
                ? collectedMonthly
                : pit.currentCashFlow !== 0
                ? pit.currentCashFlow / 12
                : Number(engine?.year1Cashflow || 0) !== 0
                ? Number(engine?.year1Cashflow) / 12
                : 0;
              const hasCashFlow = hasCollections || monthlyCashFlowVal !== 0;
              const cashFlowFormatted = hasCashFlow ? formatCurrency(monthlyCashFlowVal) : '—';

              // DSCR: blank when not applicable or unleveraged
              const rawDscr = engine?.dscr;
              let dscrFormatted = '—';
              if (rawDscr !== undefined && rawDscr !== null && rawDscr !== 'N/A') {
                const num = Number(rawDscr);
                if (!isNaN(num) && num > 0) {
                  dscrFormatted = `${num.toFixed(2)}x`;
                }
              }

              // Return (IRR for pipeline / CoC for owned)
              const isZeroEq = !!engine?.isZeroEquity && pit.currentVal > 0;
              let returnFormatted = '—';
              let isReturnNegative = false;
              if (isZeroEq) {
                returnFormatted = 'N/M';
              } else if (isOwned) {
                const cocRaw = engine?.cashOnCash !== undefined ? Number(engine.cashOnCash) : (pit.currentCashFlow && pit.currentEquity > 0 ? (pit.currentCashFlow / pit.currentEquity) * 100 : undefined);
                if (cocRaw !== undefined && !isNaN(cocRaw)) {
                  returnFormatted = `${cocRaw.toFixed(1)}% CoC`;
                  isReturnNegative = cocRaw < 0;
                }
              } else {
                const irrRaw = engine?.irr !== undefined ? Number(engine.irr) : pit.irr !== undefined ? Number(pit.irr) : undefined;
                if (irrRaw !== undefined && !isNaN(irrRaw)) {
                  returnFormatted = `${irrRaw.toFixed(1)}% IRR`;
                  isReturnNegative = irrRaw < 0;
                }
              }

              return (
                <tr
                  key={deal.id}
                  className={`hover:bg-slate-800/40 transition group cursor-pointer ${
                    isSelected ? 'bg-emerald-950/20' : ''
                  }`}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('button, a, input, [data-no-row-click]')) return;
                    onPreview(deal);
                  }}
                >
                  {/* Multi-select Checkbox */}
                  <td className="py-3 px-3 text-center" data-no-row-click>
                    <button
                      type="button"
                      onClick={() => onToggleSelect(deal.id)}
                      className="text-slate-500 hover:text-white transition p-0.5"
                      aria-label={`Select ${dealTitle}`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                      )}
                    </button>
                  </td>

                  {/* Title & Location */}
                  <td className="py-3 px-3">
                    <div className="flex flex-col min-w-[180px] max-w-[280px]">
                      <span className="font-extrabold text-white text-xs truncate group-hover:text-emerald-400 transition">
                        {dealTitle}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">{locStr}</span>
                    </div>
                  </td>

                  {/* Asset Class */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    <AssetClassBadge assetClass={aClass} />
                  </td>

                  {/* Status / Stage */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    {isOwned ? (
                      <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-extrabold uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>Owned</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-extrabold uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <span>Pipeline</span>
                      </span>
                    )}
                  </td>

                  {/* Current Value */}
                  <td className="py-3 px-3 text-right font-mono font-bold text-white tabular-nums">
                    {valueFormatted}
                  </td>

                  {/* Debt */}
                  <td className="py-3 px-3 text-right font-mono text-slate-300 tabular-nums">
                    {debtFormatted}
                  </td>

                  {/* Equity */}
                  <td className="py-3 px-3 text-right font-mono text-emerald-400 font-bold tabular-nums">
                    {equityFormatted}
                  </td>

                  {/* Monthly Cash Flow with Estimated/Collected label */}
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    {cashFlowFormatted === '—' ? (
                      <span className="font-mono text-slate-500">—</span>
                    ) : (
                      <div className="inline-flex flex-col items-end">
                        <span className={`font-mono font-bold tabular-nums ${monthlyCashFlowVal < 0 ? 'text-amber-400' : 'text-white'}`}>
                          {cashFlowFormatted}<span className="text-slate-400 font-sans text-[10px]">/mo</span>
                        </span>
                        <span
                          className={`text-[9px] font-extrabold uppercase tracking-wider px-1 rounded ${
                            hasCollections
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : monthlyCashFlowVal < 0
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {hasCollections ? 'Collected' : 'Estimated'}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* DSCR */}
                  <td className="py-3 px-3 text-right font-mono font-semibold text-slate-300 tabular-nums">
                    {dscrFormatted}
                  </td>

                  {/* Target Return (IRR / CoC) */}
                  <td className={`py-3 px-3 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                    returnFormatted === '—' || returnFormatted === 'N/M' ? 'text-slate-400' : isReturnNegative ? 'text-amber-400' : 'text-cyan-400'
                  }`}>
                    {returnFormatted}
                  </td>

                  {/* Actions Column */}
                  <td className="py-3 px-3 text-center whitespace-nowrap" data-no-row-click>
                    <div className="inline-flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => onPreview(deal)}
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Quick Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => navigate(`/project?id=${encodeURIComponent(deal.id)}`)}
                        className="p-1 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"
                        title="Open in Studio"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setActiveMenuId(activeMenuId === deal.id ? null : deal.id)}
                          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title="More actions"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>

                        {activeMenuId === deal.id && (
                          <div
                            ref={menuRef}
                            className="absolute right-0 top-7 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 z-50 text-left"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onToggleStatus(deal);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white block text-left"
                            >
                              {isOwned ? 'Move to Pipeline' : 'Mark as Acquired (Owned)'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onEdit(deal);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 hover:text-white block text-left"
                            >
                              Edit Inputs
                            </button>
                            {onShare && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onShare(deal);
                                }}
                                className="w-full px-3 py-1.5 text-xs text-cyan-400 hover:bg-slate-800 block text-left"
                              >
                                Share Deal
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                void openDealBrief(deal.id);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-violet-400 hover:bg-slate-800 block text-left"
                            >
                              Print Executive Brief
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                const m = tryComputeDealMetrics(deal);
                                if (m) exportDealProformaCSV(deal, m);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-emerald-400 hover:bg-slate-800 block text-left"
                            >
                              Export CSV
                            </button>
                            <div className="border-t border-slate-800 my-1" />
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onDelete(deal);
                              }}
                              className="w-full px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 block text-left"
                            >
                              Delete Project
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
