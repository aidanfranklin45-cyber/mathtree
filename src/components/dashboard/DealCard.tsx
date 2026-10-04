import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { openDealBrief } from '../../lib/export/pdfBrief';
import { exportDealProformaCSV } from '../../lib/export/csvExport';
import { formatCurrency } from '../../lib/format';
import { currentLeases } from '../../lib/leases';
import {
  CheckSquare,
  Square,
  Eye,
  Building,
  Home,
  Warehouse,
  Boxes,
  MapPin,
  ExternalLink,
  MoreVertical,
  Edit2,
  Share2,
  FileText,
  Download,
  Trash2,
  ArrowRightLeft,
} from 'lucide-react';

interface DealCardProps {
  deal: DealRecord;
  entities?: Array<{ id: string; name: string }>;
  onEdit: (deal: DealRecord) => void;
  onDelete: (deal: DealRecord) => void;
  onToggleStatus: (deal: DealRecord) => void;
  onShare?: (deal: DealRecord) => void;
  onPreview?: (deal: DealRecord) => void;
  isSelected?: boolean;
  onToggleSelect?: (dealId: string) => void;
  collectedMonthly?: number;
}

const stageMap: Record<string, { label: string; className: string }> = {
  screening: { label: 'Underwriting', className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
  loi: { label: 'LOI Submitted', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  due_diligence: { label: 'Due Diligence', className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  closing: { label: 'Closing', className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  owned: { label: 'Owned Asset', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  disposition: { label: 'Exited', className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
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
      return <Building className="w-4 h-4 text-cyan-400" />;
    case 'commercial':
      return <Warehouse className="w-4 h-4 text-emerald-400" />;
    case 'storage':
      return <Boxes className="w-4 h-4 text-amber-400" />;
    default:
      return <Home className="w-4 h-4 text-slate-300" />;
  }
};

const menuItem =
  'w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center space-x-2 transition';

const DealCardComponent: React.FC<DealCardProps> = ({
  deal,
  entities = [],
  onEdit,
  onDelete,
  onToggleStatus,
  onShare,
  onPreview,
  isSelected = false,
  onToggleSelect,
  collectedMonthly,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isOwned = deal.status === 'owned';

  // Close the dropdown on any outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

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
  const irrStr = isZeroEq ? 'N/M' : pit.irr > 0 ? `${pit.irr.toFixed(1)}%` : '—';

  // Cash flow & Collected vs Estimated distinction
  const hasCollections = isOwned && collectedMonthly !== undefined && collectedMonthly > 0;
  const monthlyCfVal = hasCollections
    ? collectedMonthly
    : pit.currentCashFlow > 0
    ? pit.currentCashFlow / 12
    : Number(engine?.year1Cashflow) > 0
    ? Number(engine?.year1Cashflow) / 12
    : 0;

  const currentStage = isOwned ? 'owned' : inputs.dealStage && inputs.dealStage !== 'owned' ? inputs.dealStage : 'screening';
  const stInfo = stageMap[currentStage] || (isOwned ? stageMap.owned : stageMap.screening);
  const matchedEntity = entities.find((e) => e.id === deal.entity_id || e.id === inputs.entity_id);

  const leasesList: any[] = currentLeases(inputs);
  const unitCount = parseInt(String(inputs.unitCount || inputs.numUnits || inputs.storageUnitCount || 0), 10);

  const studioUrl = `/project?id=${encodeURIComponent(deal.id)}`;
  const openStudio = (e: React.MouseEvent | React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [data-no-nav]')) return;
    if (typeof window !== 'undefined' && String(window.getSelection?.() ?? '').length > 0) return;
    try {
      sessionStorage.setItem('mathtree_active_deal_id', deal.id);
      localStorage.setItem('mathtree_active_deal_id', deal.id);
    } catch { /* storage unavailable */ }
    navigate(studioUrl);
  };

  const closeThen = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    fn();
  };

  const downloadCsv = () => {
    const m = tryComputeDealMetrics(deal);
    if (m) exportDealProformaCSV(deal, m);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openStudio}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openStudio(e);
      }}
      className={`bg-slate-900/60 border rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col justify-between transition-all duration-200 group hover:shadow-brand-500/10 hover:-translate-y-0.5 cursor-pointer relative overflow-visible w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
        isSelected
          ? 'border-emerald-500 bg-slate-900/90'
          : 'border-slate-800/80 hover:border-emerald-500/40 hover:bg-slate-900/80'
      }`}
    >
      <div className="space-y-3.5">
        {/* Top Meta Row: Checkbox, Asset Type, Status & Actions Menu */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3" data-no-nav>
          <div className="flex items-center space-x-2 min-w-0">
            {onToggleSelect && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(deal.id);
                }}
                className="text-slate-500 hover:text-white transition p-0.5 shrink-0"
                aria-label={`Select ${dealTitle}`}
              >
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-emerald-400" />
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
            <span
              className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${stInfo.className} border whitespace-nowrap shrink-0`}
            >
              {stInfo.label}
            </span>

            {onPreview && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(deal);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="Quick Preview"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((o) => !o);
                }}
                aria-label="Deal Actions"
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 z-50 text-left">
                  <button onClick={closeThen(() => onToggleStatus(deal))} className={menuItem}>
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{isOwned ? 'Move to Pipeline' : 'Mark as Acquired'}</span>
                  </button>
                  <button onClick={closeThen(() => onEdit(deal))} className={menuItem}>
                    <Edit2 className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                    <span>Edit Inputs</span>
                  </button>
                  {onShare && (
                    <button onClick={closeThen(() => onShare(deal))} className={menuItem}>
                      <Share2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>Share Deal</span>
                    </button>
                  )}
                  <button onClick={closeThen(() => { void openDealBrief(deal.id); })} className={menuItem}>
                    <FileText className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span>Executive Brief</span>
                  </button>
                  <button onClick={closeThen(downloadCsv)} className={menuItem}>
                    <Download className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Export CSV</span>
                  </button>
                  <div className="my-1 border-t border-slate-800" />
                  <button
                    onClick={closeThen(() => onDelete(deal))}
                    className="w-full px-3.5 py-2 text-left text-xs font-semibold text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 flex items-center space-x-2 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Delete Project</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Deal Title & Location */}
        <div className="space-y-1">
          <h4 className="text-sm font-extrabold text-white group-hover:text-emerald-400 transition flex items-center justify-between">
            <span className="truncate">{dealTitle}</span>
            <span className="text-slate-500 group-hover:text-emerald-400 transition font-bold shrink-0 ml-2">→</span>
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
            <span className="text-xs font-black text-brand-400 mt-0.5 block tabular-nums">
              {irrStr}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block font-sans">
              {hasCollections ? 'Monthly Rent' : 'Est. Cash Flow'}
            </span>
            <span className="text-xs font-black text-emerald-400 mt-0.5 block tabular-nums">
              {monthlyCfVal > 0 ? `${formatCurrency(monthlyCfVal)}/mo` : '—'}
            </span>
            {monthlyCfVal > 0 ? (
              <span
                className={`text-[8px] font-bold block uppercase tracking-wider font-sans leading-none mt-0.5 ${
                  hasCollections ? 'text-emerald-400' : 'text-slate-400'
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
        <div className="flex items-center space-x-1 text-slate-400 group-hover:text-emerald-400 transition font-semibold">
          <span>Open Studio</span>
          <span>→</span>
        </div>

        <div className="flex items-center space-x-2" data-no-nav>
          {onPreview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(deal);
              }}
              className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 border border-slate-800 transition"
            >
              Preview
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(deal);
            }}
            className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 transition"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
};

export const DealCard = React.memo(DealCardComponent);
