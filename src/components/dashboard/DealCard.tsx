import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { formatCurrency } from '../../lib/format';
import { currentLeases } from '../../lib/leases';
import {
  CheckSquare,
  Square,
  Building,
  Home,
  Warehouse,
  Boxes,
  MapPin,
  MoreVertical,
} from 'lucide-react';

export type DealCardTheme = 'emerald' | 'blue' | 'slate';

const themeStyles: Record<
  DealCardTheme,
  {
    hoverBorder: string;
    selectedBorder: string;
    focusRing: string;
    textHover: string;
    arrowHover: string;
    checkText: string;
    editHoverBorder: string;
    hoverShadow: string;
  }
> = {
  emerald: {
    hoverBorder: 'hover:border-emerald-500/40',
    selectedBorder: 'border-emerald-500',
    focusRing: 'focus-visible:ring-emerald-500/60',
    textHover: 'group-hover:text-emerald-400',
    arrowHover: 'group-hover:text-emerald-400',
    checkText: 'text-emerald-400',
    editHoverBorder: 'hover:border-emerald-500/40',
    hoverShadow: 'hover:shadow-brand-500/10',
  },
  blue: {
    hoverBorder: 'hover:border-blue-500/40',
    selectedBorder: 'border-blue-500',
    focusRing: 'focus-visible:ring-blue-500/60',
    textHover: 'group-hover:text-blue-400',
    arrowHover: 'group-hover:text-blue-400',
    checkText: 'text-blue-400',
    editHoverBorder: 'hover:border-blue-500/40',
    hoverShadow: 'hover:shadow-blue-500/10',
  },
  slate: {
    hoverBorder: 'hover:border-slate-600/80',
    selectedBorder: 'border-slate-500',
    focusRing: 'focus-visible:ring-slate-400/60',
    textHover: 'group-hover:text-slate-200',
    arrowHover: 'group-hover:text-slate-200',
    checkText: 'text-slate-300',
    editHoverBorder: 'hover:border-slate-600',
    hoverShadow: 'hover:shadow-slate-500/10',
  },
};

interface DealCardProps {
  deal: DealRecord;
  entities?: Array<{ id: string; name: string }>;
  onOpenActions?: (deal: DealRecord) => void;
  onEdit?: (deal: DealRecord) => void;
  onDelete?: (deal: DealRecord) => void;
  onToggleStatus?: (deal: DealRecord) => void;
  onShare?: (deal: DealRecord) => void;
  onPreview?: (deal: DealRecord) => void;
  isSelected?: boolean;
  onToggleSelect?: (dealId: string) => void;
  collectedMonthly?: number;
  hideStatusBadge?: boolean;
  /** Owner-only; the menu entry only shows when provided. */
  onTransfer?: (deal: DealRecord) => void;
  colorTheme?: DealCardTheme;
}

const stageMap: Record<string, { label: string; className: string }> = {
  screening: { label: 'Underwriting', className: 'bg-slate-900 text-slate-400 border-slate-800' },
  loi: { label: 'LOI Submitted', className: 'bg-blue-950/40 text-blue-300 border-blue-800/40' },
  due_diligence: { label: 'Due Diligence', className: 'bg-indigo-950/40 text-indigo-300 border-indigo-800/40' },
  closing: { label: 'Closing', className: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50' },
  owned: { label: 'Owned Asset', className: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60' },
  disposition: { label: 'Exited', className: 'bg-slate-900 text-slate-400 border-slate-800' },
};

const assetDisplayMap: Record<string, string> = {
  'single-family': 'SFR',
  residential: 'SFR',
  'multi-unit': 'Multi-Unit',
  multi_family: 'Multi-Unit',
  commercial: 'Commercial',
  storage: 'Storage',
};

const AssetIcon: React.FC<{ assetClass: string }> = ({ assetClass }) => {
  switch (assetClass) {
    case 'multi-unit':
    case 'multi_family':
      return <Building className="w-4 h-4 text-slate-400" />;
    case 'commercial':
      return <Warehouse className="w-4 h-4 text-slate-400" />;
    case 'storage':
      return <Boxes className="w-4 h-4 text-slate-400" />;
    default:
      return <Home className="w-4 h-4 text-slate-400" />;
  }
};

const DealCardComponent: React.FC<DealCardProps> = ({
  deal,
  entities = [],
  onOpenActions,
  onEdit,
  onDelete,
  onToggleStatus,
  onShare,
  onPreview,
  isSelected = false,
  onToggleSelect,
  collectedMonthly,
  hideStatusBadge = false,
  onTransfer,
  colorTheme,
}) => {
  const navigate = useNavigate();
  const isOwned = deal.status === 'owned';
  const activeTheme: DealCardTheme = colorTheme || (isOwned ? 'emerald' : 'blue');
  const theme = themeStyles[activeTheme];

  // Derived metrics from engine
  const pit = useMemo(() => resolvePointInTimeDealMetrics(deal, new Date()), [deal]);
  const engine = useMemo(() => tryComputeDealMetrics(deal), [deal]);
  const inputs = deal.inputs || {};
  const aClass = String(deal.asset_class || deal.assetType || 'single-family');
  const dealTitle = resolveDealDisplayName(deal);
  const locStr = deal.location || inputs.propertyAddress || deal.address || '—';

  const purchasePrice = Number(deal.purchase_price || inputs.purchasePrice || 0);
  const currentVal = pit.currentVal > 0 ? pit.currentVal : purchasePrice;
  const isZeroEq = !!engine?.isZeroEquity && purchasePrice > 0;
  const rawIrr = engine?.irr !== undefined ? Number(engine.irr) : pit.irr !== undefined ? Number(pit.irr) : undefined;
  const hasIrr = rawIrr !== undefined && !isNaN(rawIrr);
  const irrStr = isZeroEq ? 'N/M' : hasIrr ? `${rawIrr.toFixed(1)}%` : '—';

  // Cash flow & Collected vs Estimated distinction
  const hasCollections = isOwned && collectedMonthly !== undefined;
  const monthlyCfVal = hasCollections
    ? collectedMonthly
    : pit.currentCashFlow !== 0
    ? pit.currentCashFlow / 12
    : Number(engine?.year1Cashflow || 0) !== 0
    ? Number(engine?.year1Cashflow) / 12
    : 0;
  const hasCashFlow = hasCollections || monthlyCfVal !== 0;

  const currentStage = isOwned ? 'owned' : inputs.dealStage && inputs.dealStage !== 'owned' ? inputs.dealStage : 'screening';
  const stInfo = stageMap[currentStage] || (isOwned ? stageMap.owned : stageMap.screening);
  const matchedEntity = entities.find((e) => e.id === deal.entity_id || e.id === inputs.entity_id);

  const leasesList: any[] = currentLeases(inputs);
  const unitCount = parseInt(String(inputs.unitCount || inputs.numUnits || inputs.storageUnitCount || 0), 10);

  const studioUrl = `/project?id=${encodeURIComponent(deal.id)}`;
  const openStudio = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, select, textarea, [data-no-nav]')) return;
      if (typeof window !== 'undefined' && String(window.getSelection?.() ?? '').length > 0) return;
    }
    try {
      sessionStorage.setItem('mathtree_active_deal_id', deal.id);
      localStorage.setItem('mathtree_active_deal_id', deal.id);
    } catch {
      /* storage unavailable */
    }
    navigate(studioUrl);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openStudio}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openStudio(e);
      }}
      className={`bg-slate-900/60 border rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col justify-between transition-all duration-200 group ${theme.hoverShadow} hover:-translate-y-0.5 cursor-pointer relative overflow-visible w-full focus:outline-none focus-visible:ring-2 ${theme.focusRing} ${
        isSelected
          ? `${theme.selectedBorder} bg-slate-900/90`
          : `border-slate-800/80 ${theme.hoverBorder} hover:bg-slate-900/80`
      }`}
    >
      <div className="space-y-3.5">
        {/* Top Meta Row: Checkbox, Asset Type, Status & Actions Menu */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2 min-w-0">
            {onToggleSelect && (
              <button
                type="button"
                data-no-nav
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(deal.id);
                }}
                className="text-slate-500 hover:text-white transition p-0.5 shrink-0"
                aria-label={`Select ${dealTitle}`}
              >
                {isSelected ? (
                  <CheckSquare className={`w-4 h-4 ${theme.checkText}`} />
                ) : (
                  <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                )}
              </button>
            )}

            <div className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
              <AssetIcon assetClass={aClass} />
            </div>

            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800 whitespace-nowrap">
              {assetDisplayMap[aClass] || aClass.replace('-', ' ')}
            </span>

            {deal.is_shared && (
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 whitespace-nowrap shrink-0">
                Shared
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5 shrink-0 ml-auto">
            {!hideStatusBadge && (
              <span
                className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${stInfo.className} border whitespace-nowrap shrink-0`}
              >
                {stInfo.label}
              </span>
            )}

            {onOpenActions && (
              <button
                type="button"
                data-no-nav
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenActions(deal);
                }}
                aria-label="Deal Actions"
                title="Manage Actions"
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Deal Title & Location */}
        <div className="space-y-1">
          <h4 className={`text-sm font-extrabold text-white ${theme.textHover} transition flex items-center justify-between`}>
            <span className="truncate">{dealTitle}</span>
            <span className={`text-slate-500 ${theme.arrowHover} transition font-bold shrink-0 ml-2`}>&rarr;</span>
          </h4>
          <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 truncate">
            <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
            <span className="truncate">{locStr}</span>
            {matchedEntity && (
              <span className="text-[10px] text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 shrink-0 truncate max-w-[120px]">
                {matchedEntity.name}
              </span>
            )}
          </div>
        </div>

        {/* Dense Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 text-center font-mono">
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block font-sans">
              {isOwned ? 'Current Value' : 'Price'}
            </span>
            <span className="text-xs font-black text-white mt-0.5 block tabular-nums">
              {currentVal > 0 ? formatCurrency(currentVal) : '—'}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block font-sans">Target IRR</span>
            <span className={`text-xs font-black mt-0.5 block tabular-nums ${
              !hasIrr || isZeroEq ? 'text-slate-400' : (rawIrr ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'
            }`}>
              {irrStr}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block font-sans">
              {hasCollections ? 'Monthly Rent' : 'Est. Cash Flow'}
            </span>
            <span className={`text-xs font-black mt-0.5 block tabular-nums ${
              monthlyCfVal < 0 ? 'text-red-400' : 'text-emerald-400'
            }`}>
              {hasCashFlow ? `${formatCurrency(monthlyCfVal)}/mo` : '—'}
            </span>
            {hasCashFlow ? (
              <span
                className={`text-[8px] font-bold block uppercase tracking-wider font-sans leading-none mt-0.5 ${
                  hasCollections ? 'text-emerald-400' : monthlyCfVal < 0 ? 'text-red-400' : 'text-slate-400'
                }`}
              >
                {hasCollections ? 'Collected' : 'Estimated'}
              </span>
            ) : (
              <span className="text-[8px] text-slate-500 block font-sans leading-none mt-0.5">
                No Income
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Card Footer */}
      <div className="pt-3 mt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
        <div className={`flex items-center space-x-1 text-slate-400 ${theme.textHover} transition font-semibold`}>
          <span>Open Studio</span>
          <span>&rarr;</span>
        </div>

        <div className="flex items-center space-x-2" data-no-nav>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(deal);
            }}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-950 hover:bg-slate-800 border border-slate-800 ${theme.editHoverBorder} transition`}
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
};

export const DealCard = React.memo(DealCardComponent);
