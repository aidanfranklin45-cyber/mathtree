import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { formatCurrency } from '../../lib/format';
import { openDealBrief } from '../../lib/export/pdfBrief';
import { exportDealProformaCSV } from '../../lib/export/csvExport';
import { currentLeases } from '../../lib/leases';
import {
  X,
  ExternalLink,
  FileText,
  Download,
  Edit3,
  TrendingUp,
  DollarSign,
  Landmark,
  Building,
  Users,
  Percent,
} from 'lucide-react';

interface DealSidePreviewProps {
  deal: DealRecord | null;
  onClose: () => void;
  onEdit: (deal: DealRecord) => void;
  onToggleStatus: (deal: DealRecord) => void;
  collectedMonthly?: number;
}

export const DealSidePreview: React.FC<DealSidePreviewProps> = ({
  deal,
  onClose,
  onEdit,
  onToggleStatus,
  collectedMonthly,
}) => {
  const navigate = useNavigate();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!deal) return null;

  const isOwned = deal.status === 'owned';
  const pit = resolvePointInTimeDealMetrics(deal, new Date());
  const engine = tryComputeDealMetrics(deal);
  const inputs = deal.inputs || {};
  const dealTitle = resolveDealDisplayName(deal);
  const locStr = deal.location || inputs.propertyAddress || deal.address || '—';
  const aClass = String(deal.asset_class || deal.assetType || 'commercial');

  const purchasePrice = Number(deal.purchase_price || inputs.purchasePrice || 0);
  const currentVal = pit.currentVal > 0 ? pit.currentVal : purchasePrice;
  const currentDebt = pit.currentDebt;
  const currentEquity = pit.currentEquity;
  const ltv = pit.ltv;

  // Cash flow & Collected vs Estimated
  const hasCollections = isOwned && collectedMonthly !== undefined && collectedMonthly > 0;
  const monthlyCf = hasCollections
    ? collectedMonthly
    : pit.currentCashFlow !== 0
    ? pit.currentCashFlow / 12
    : Number(engine?.year1Cashflow || 0) !== 0
    ? Number(engine?.year1Cashflow) / 12
    : 0;

  // Annual CF
  const annualCf = hasCollections ? collectedMonthly * 12 : pit.currentCashFlow || Number(engine?.year1Cashflow) || 0;

  // DSCR
  const rawDscr = engine?.dscr;
  let dscrStr = '—';
  if (rawDscr !== undefined && rawDscr !== null && rawDscr !== 'N/A') {
    const num = Number(rawDscr);
    if (!isNaN(num) && num > 0) dscrStr = `${num.toFixed(2)}x`;
  }

  // Returns
  const isZeroEq = !!engine?.isZeroEquity && currentVal > 0;
  const rawIrr = engine?.irr !== undefined ? Number(engine.irr) : pit.irr !== undefined ? Number(pit.irr) : undefined;
  const hasIrr = rawIrr !== undefined && !isNaN(rawIrr);
  const irrStr = isZeroEq ? 'N/M' : hasIrr ? `${rawIrr.toFixed(1)}%` : '—';

  const rawCoc = engine?.cashOnCash !== undefined ? Number(engine.cashOnCash) : (pit.currentCashFlow && currentEquity > 0 ? (pit.currentCashFlow / currentEquity) * 100 : undefined);
  const hasCoc = rawCoc !== undefined && !isNaN(rawCoc);
  const cocStr = isZeroEq ? 'N/M' : hasCoc ? `${rawCoc.toFixed(1)}%` : '—';

  const equityMult = Number(engine?.equityMultiplier);
  const eqMultStr = equityMult > 0 ? `${equityMult.toFixed(2)}x` : '—';

  // Leases
  const leasesList = currentLeases(inputs);
  const unitCount = parseInt(String(inputs.unitCount || inputs.numUnits || inputs.storageUnitCount || 0), 10);

  const handleOpenStudio = () => {
    try {
      sessionStorage.setItem('mathtree_active_deal_id', deal.id);
      localStorage.setItem('mathtree_active_deal_id', deal.id);
    } catch { /* ignore */ }
    navigate(`/project?id=${encodeURIComponent(deal.id)}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-out Drawer */}
      <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full z-10 overflow-hidden font-sans text-slate-100">
        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span
                className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  isOwned
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                }`}
              >
                {isOwned ? 'Owned Asset' : 'Pipeline Prospect'}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/60">
                {aClass.replace('-', ' ')}
              </span>
            </div>
            <h3 className="text-base font-black text-white truncate" title={dealTitle}>
              {dealTitle}
            </h3>
            <p className="text-xs text-slate-400 truncate">{locStr}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Button Strip */}
        <div className="px-4 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={handleOpenStudio}
            className="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black transition shadow-sm"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Studio</span>
          </button>
          <button
            type="button"
            onClick={() => { void openDealBrief(deal.id); }}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700"
            title="Print Executive Memo (PDF)"
          >
            <FileText className="w-3.5 h-3.5 text-violet-400" />
            <span>Brief</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (engine) exportDealProformaCSV(deal, engine);
            }}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700"
            title="Download CSV"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onEdit(deal);
            }}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700"
            title="Edit Inputs"
          >
            <Edit3 className="w-3.5 h-3.5 text-brand-400" />
            <span>Edit</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Section 1: Valuation & Capital Structure */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Landmark className="w-3.5 h-3.5 text-emerald-400" />
                <span>Capital & Valuation</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {isOwned ? 'Mark-to-Market' : 'Acquisition Basis'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Current Value</span>
                <span className="text-base font-black text-white font-mono tabular-nums">
                  {currentVal > 0 ? formatCurrency(currentVal) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Net Equity</span>
                <span className="text-base font-black text-emerald-400 font-mono tabular-nums">
                  {currentEquity > 0 ? formatCurrency(currentEquity) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Debt Balance</span>
                <span className="text-sm font-bold text-slate-200 font-mono tabular-nums">
                  {currentDebt > 0 ? formatCurrency(currentDebt) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">LTV</span>
                <span className="text-sm font-bold text-slate-200 font-mono tabular-nums">
                  {ltv > 0 ? `${ltv}%` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Cash Flow & Operations */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-slate-400">
              <span className="flex items-center space-x-1.5">
                <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
                <span>Income & Cash Flow</span>
              </span>
              <span
                className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  hasCollections
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {hasCollections ? 'Collected Basis' : 'Estimated Pro-Forma'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Monthly Cash Flow</span>
                <span className={`text-base font-black font-mono tabular-nums ${monthlyCf < 0 ? 'text-amber-400' : 'text-white'}`}>
                  {monthlyCf !== 0 ? `${formatCurrency(monthlyCf)}/mo` : '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Annual Cash Flow</span>
                <span className={`text-base font-black font-mono tabular-nums ${annualCf < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {annualCf !== 0 ? `${formatCurrency(annualCf)}/yr` : '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Net Operating Income</span>
                <span className="text-sm font-bold text-slate-200 font-mono tabular-nums">
                  {pit.currentNoi !== 0
                    ? formatCurrency(pit.currentNoi)
                    : Number(engine?.noi) !== 0
                    ? formatCurrency(Number(engine?.noi))
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">DSCR</span>
                <span className="text-sm font-bold text-slate-200 font-mono tabular-nums">
                  {dscrStr}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Investment Returns */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-slate-400">
              <span className="flex items-center space-x-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
                <span>Return Metrics</span>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[9px] uppercase font-bold text-slate-500 block">10-Yr IRR</span>
                <span className={`text-sm font-black font-mono tabular-nums block mt-0.5 ${
                  !hasIrr || isZeroEq ? 'text-slate-400' : (rawIrr ?? 0) < 0 ? 'text-amber-400' : 'text-brand-400'
                }`}>
                  {irrStr}
                </span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[9px] uppercase font-bold text-slate-500 block">CoC Yield</span>
                <span className={`text-sm font-black font-mono tabular-nums block mt-0.5 ${
                  !hasCoc || isZeroEq ? 'text-slate-400' : (rawCoc ?? 0) < 0 ? 'text-amber-400' : 'text-cyan-400'
                }`}>
                  {cocStr}
                </span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[9px] uppercase font-bold text-slate-500 block">Equity Multiple</span>
                <span className="text-sm font-black text-white font-mono tabular-nums block mt-0.5">
                  {eqMultStr}
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Tenancy & Leases */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Users className="w-3.5 h-3.5 text-amber-400" />
                <span>Rent Roll & Leases</span>
              </span>
              <span className="text-[10px] text-slate-400 font-bold">
                {leasesList.length > 0 ? `${leasesList.length} Leases` : unitCount > 0 ? `${unitCount} Units` : 'Single Asset'}
              </span>
            </div>

            {leasesList.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                {leasesList.slice(0, 5).map((lease: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs bg-slate-900/70 px-3 py-2 rounded-xl border border-slate-800/80"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-bold text-white block truncate">
                        {lease.tenantName || `Tenant #${idx + 1}`}
                      </span>
                      <span className="text-[10px] text-slate-400 block truncate">
                        {lease.leaseType || 'Standard'} • Expires {lease.leaseEndDate || '—'}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-white tabular-nums shrink-0">
                      {lease.monthlyRent ? `${formatCurrency(lease.monthlyRent)}/mo` : '—'}
                    </span>
                  </div>
                ))}
                {leasesList.length > 5 && (
                  <p className="text-[11px] text-slate-500 text-center pt-1">
                    +{leasesList.length - 5} more leases in studio
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-1">No active lease records configured.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => onToggleStatus(deal)}
            className="text-slate-400 hover:text-white transition font-semibold"
          >
            {isOwned ? 'Move to Pipeline' : 'Mark as Acquired'}
          </button>
          <button
            type="button"
            onClick={handleOpenStudio}
            className="text-emerald-400 hover:text-emerald-300 font-bold inline-flex items-center space-x-1"
          >
            <span>Launch Deep Modeler</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
};
