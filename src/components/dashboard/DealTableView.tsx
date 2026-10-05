import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { checkEngineInputs } from '../../lib/engine';
import { formatCurrency } from '../../lib/format';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
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
  onOpenActions: (deal: DealRecord) => void;
  onEdit?: (deal: DealRecord) => void;
  onDelete?: (deal: DealRecord) => void;
  onToggleStatus?: (deal: DealRecord) => void;
  onPreview?: (deal: DealRecord) => void;
  onShare?: (deal: DealRecord) => void;
  entities?: Array<{ id: string; name: string }>;
  collectedMonthlyMap?: Map<string, number>;
  sortField: SortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  hideStatusColumn?: boolean;
  colorTheme?: 'emerald' | 'blue' | 'slate';
}

const AssetClassBadge: React.FC<{ assetClass: string }> = ({ assetClass }) => {
  const normalized = assetClass.toLowerCase();
  let label = 'SFR';
  let Icon = Home;
  if (normalized === 'multi-unit' || normalized === 'multi_family') {
    label = 'Multi-Unit';
    Icon = Building;
  } else if (normalized === 'commercial') {
    label = 'Commercial';
    Icon = Warehouse;
  } else if (normalized === 'storage') {
    label = 'Storage';
    Icon = Boxes;
  }
  return (
    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 border border-slate-800 text-[11px] font-medium">
      <Icon className="w-3 h-3 text-slate-400" />
      <span>{label}</span>
    </span>
  );
};

export const DealTableView: React.FC<DealTableViewProps> = ({
  deals,
  selectedDealIds,
  onToggleSelect,
  onSelectAll,
  allSelected,
  onOpenActions,
  entities = [],
  collectedMonthlyMap,
  sortField,
  sortDirection,
  onSort,
  hideStatusColumn = false,
  colorTheme = 'emerald',
}) => {
  const navigate = useNavigate();

  const openStudio = (dealId: string) => {
    try {
      sessionStorage.setItem('mathtree_active_deal_id', dealId);
      localStorage.setItem('mathtree_active_deal_id', dealId);
    } catch {
      /* storage unavailable */
    }
    navigate(`/project?id=${encodeURIComponent(dealId)}`);
  };

  const textHoverClass =
    colorTheme === 'blue'
      ? 'group-hover:text-blue-400'
      : colorTheme === 'slate'
      ? 'group-hover:text-slate-200'
      : 'group-hover:text-emerald-400';

  const checkTextClass =
    colorTheme === 'blue'
      ? 'text-blue-400'
      : colorTheme === 'slate'
      ? 'text-slate-300'
      : 'text-emerald-400';

  const selectedBgClass =
    colorTheme === 'blue'
      ? 'bg-blue-950/20'
      : colorTheme === 'slate'
      ? 'bg-slate-800/40'
      : 'bg-emerald-950/20';

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
              {!hideStatusColumn && renderSortHeader('Status', 'status')}
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
            {deals.map((deal, idx) => {
              const isSelected = selectedDealIds.has(deal.id);
              const isOwned = deal.status === 'owned';
              const pit = resolvePointInTimeDealMetrics(deal, new Date());
              const engine = tryComputeDealMetrics(deal);
              const inputs = deal.inputs || {};
              const dealTitle = resolveDealDisplayName(deal);
              const locStr = deal.location || inputs.propertyAddress || deal.address || '—';
              const aClass = String(deal.asset_class || deal.assetType || 'commercial');
              const missingInputs = checkEngineInputs(aClass, deal.inputs || {});
              const needsInputs = missingInputs.length > 0;

              // Value & Equity
              const valueFormatted = pit.currentVal > 0 ? formatCurrency(pit.currentVal) : '—';
              const debtFormatted = pit.currentDebt > 0 ? formatCurrency(pit.currentDebt) : '—';
              const equityFormatted = pit.currentEquity > 0 ? formatCurrency(pit.currentEquity) : '—';

              // Cash Flow & Collected vs. Estimated distinction
              const collectedMonthly = collectedMonthlyMap?.get(deal.id);
              const hasCollections = isOwned && collectedMonthly !== undefined;
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
                    isSelected ? selectedBgClass : ''
                  }`}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('button, a, input, select, textarea, [data-no-row-click]')) return;
                    if (typeof window !== 'undefined' && String(window.getSelection?.() ?? '').length > 0) return;
                    openStudio(deal.id);
                  }}
                  title={`Open ${dealTitle} in Deal Studio`}
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
                        <CheckSquare className={`w-4 h-4 ${checkTextClass}`} />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                      )}
                    </button>
                  </td>

                  {/* Title & Location */}
                  <td className="py-3 px-3">
                    <div className="flex flex-col min-w-[180px] max-w-[280px]">
                      <span className={`font-extrabold text-white text-xs truncate ${textHoverClass} transition`}>
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
                  {!hideStatusColumn && (
                    <td className="py-3 px-3 whitespace-nowrap">
                      {isOwned ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 text-[10px] font-semibold uppercase tracking-wider">
                          <span>Owned</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-950/40 text-blue-400 border border-blue-800/50 text-[10px] font-semibold uppercase tracking-wider">
                          <span>Pipeline</span>
                        </span>
                      )}
                    </td>
                  )}

                  {needsInputs ? (
                    <td colSpan={6} className="py-3 px-3">
                      <div className="flex items-center space-x-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap">
                          Inputs needed ({missingInputs.length})
                        </span>
                        <span
                          className="text-[11px] text-slate-300 truncate max-w-[340px] cursor-help"
                          title={missingInputs.map((m) => m.label).join(', ')}
                        >
                          {missingInputs.slice(0, 3).map((m) => m.label).join(' · ')}
                          {missingInputs.length > 3 ? ' …' : ''}
                        </span>
                      </div>
                    </td>
                  ) : (
                    <>
                      {/* Current Value */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-white tabular-nums">
                        {valueFormatted}
                      </td>

                      {/* Debt */}
                      <td className="py-3 px-3 text-right font-mono text-slate-300 tabular-nums">
                        {debtFormatted}
                      </td>

                      {/* Equity */}
                      <td className="py-3 px-3 text-right font-mono text-white font-bold tabular-nums">
                        {equityFormatted}
                      </td>

                      {/* Monthly Cash Flow with Estimated/Collected label */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {cashFlowFormatted === '—' ? (
                          <span className="font-mono text-slate-500">—</span>
                        ) : (
                          <div className="inline-flex flex-col items-end">
                            <span className={`font-mono font-bold tabular-nums ${monthlyCashFlowVal < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {cashFlowFormatted}<span className="text-slate-400 font-sans text-[10px]">/mo</span>
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1 rounded ${
                                hasCollections
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                                  : monthlyCashFlowVal < 0
                                  ? 'bg-red-500/10 text-red-400'
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
                        returnFormatted === '—' || returnFormatted === 'N/M' ? 'text-slate-400' : isReturnNegative ? 'text-red-400' : 'text-emerald-400'
                      }`}>
                        {returnFormatted}
                      </td>
                    </>
                  )}

                  {/* Actions Column */}
                  <td className="py-3 px-3 text-center whitespace-nowrap" data-no-row-click>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenActions(deal);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      title="Manage Actions"
                      aria-label="Deal Actions"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
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
