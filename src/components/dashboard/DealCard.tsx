import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { exportDealBriefPDF } from '../../lib/export/pdfBrief';
import {
  Building,
  Home,
  Store,
  Warehouse,
  FileDown,
  ArrowUpRight,
  MoreVertical,
  Edit2,
  Trash2,
  ArrowRightLeft,
  MapPin,
  Users,
} from 'lucide-react';

interface DealCardProps {
  deal: DealRecord;
  entities?: Array<{ id: string; name: string }>;
  onEdit: (deal: DealRecord) => void;
  onDelete: (deal: DealRecord) => void;
  onToggleStatus: (deal: DealRecord) => void;
}

export const DealCard: React.FC<DealCardProps> = ({
  deal,
  entities = [],
  onEdit,
  onDelete,
  onToggleStatus,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOwned = deal.status === 'owned';

  // Compute dynamic month-by-month point-in-time metrics in memory
  const pit = resolvePointInTimeDealMetrics(deal, new Date());
  const displayName = resolveDealDisplayName(deal);

  const getAssetIcon = (assetClass: string) => {
    switch (assetClass) {
      case 'commercial':
        return <Store className="w-3.5 h-3.5 text-amber-400" />;
      case 'storage':
        return <Warehouse className="w-3.5 h-3.5 text-purple-400" />;
      case 'multi_family':
      case 'multi-unit':
        return <Building className="w-3.5 h-3.5 text-cyan-400" />;
      default:
        return <Home className="w-3.5 h-3.5 text-emerald-400" />;
    }
  };

  const formatAssetClass = (ac: string) => {
    switch (ac) {
      case 'commercial':
        return 'Commercial';
      case 'storage':
        return 'Self-Storage';
      case 'multi_family':
      case 'multi-unit':
        return 'Multi-Family';
      default:
        return 'Single-Family';
    }
  };

  const stageMap: Record<string, { label: string; className: string }> = {
    screening: { label: 'Underwriting', className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
    loi: { label: 'LOI Submitted', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    due_diligence: { label: 'Due Diligence', className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
    closing: { label: 'Closing', className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    owned: { label: 'Owned Asset', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    disposition: { label: 'Exited', className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  };

  const currentStage = isOwned ? 'owned' : ((deal.inputs?.dealStage && deal.inputs.dealStage !== 'owned') ? deal.inputs.dealStage : 'screening');
  const stageInfo = stageMap[currentStage] || (isOwned ? stageMap.owned : stageMap.screening);

  // Holding Entity match
  const matchedEntity = entities.find((e) => e.id === deal.entity_id || e.id === deal.inputs?.entity_id);

  // Multi-Parcel / Multi-Address detection
  const parcels = Array.isArray(deal.inputs?.parcels) && deal.inputs.parcels.length > 1
    ? deal.inputs.parcels
    : (Array.isArray(deal.inputs?.adjacentParcels) && deal.inputs.adjacentParcels.length > 0)
    ? [deal.location, ...deal.inputs.adjacentParcels]
    : [];
  const isMultiParcel = parcels.length > 1;

  // Tenancy summary
  const leasesList = Array.isArray(deal.inputs?.leases)
    ? deal.inputs.leases.filter((l: any) => l && (l.tenantName || Number(l.monthlyRent) > 0 || Number(l.annualRent) > 0))
    : [];
  const unitCount = parseInt(String(deal.inputs?.unitCount || deal.inputs?.numUnits || deal.inputs?.storageUnitCount || 0), 10);

  // Financial calculations
  const totalEq = Number(deal.total_equity ?? deal.inputs?.initialEquity ?? 0);
  const downPct = Number(deal.inputs?.downPaymentPercent ?? 25);
  const closingCosts = Number(deal.inputs?.closingCosts ?? 0);
  const rehabCosts = Number(deal.inputs?.rehabCosts ?? 0);
  const purchasePrice = Number(deal.purchase_price || deal.inputs?.purchasePrice || 0);

  const isZeroEq = (totalEq <= 0 || (deal.total_equity === undefined && downPct === 0 && !closingCosts && !rehabCosts)) && purchasePrice > 0;
  const irrStr = isZeroEq ? 'N/M' : `${(pit.irr || 0).toFixed(1)}%`;
  const cocVal = deal.cash_on_cash !== undefined && deal.cash_on_cash !== null && !isNaN(Number(deal.cash_on_cash))
    ? Number(deal.cash_on_cash)
    : (Number(deal.metrics?.cashOnCash ?? (deal.metrics as any)?.cash_on_cash) || (pit.currentCashFlow && pit.currentEquity > 0 ? (pit.currentCashFlow / pit.currentEquity * 100) : 0));
  const cocStr = isZeroEq ? 'N/M' : `${cocVal.toFixed(1)}%`;

  const isCashPositive = pit.currentCashFlow >= 0;
  const monthlyCashflow = pit.currentCashFlow / 12;

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 transition shadow-sm flex flex-col justify-between group relative backdrop-blur-sm">
      <div>
        {/* Top Header: Badge, Asset Class, Entity & Actions Menu */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${stageInfo.className} border shrink-0`}>
              {stageInfo.label}
            </span>

            <div className="flex items-center space-x-1 text-[11px] font-bold text-slate-400 px-1.5 py-0.5 rounded-md bg-slate-950/60 border border-slate-800/80 shrink-0">
              {getAssetIcon(deal.asset_class)}
              <span>{formatAssetClass(deal.asset_class)}</span>
            </div>

            {matchedEntity && (
              <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/50 border border-emerald-800/50 px-2 py-0.5 rounded-md inline-flex items-center space-x-1 shrink-0 truncate max-w-[130px]" title={`Owned by ${matchedEntity.name}`}>
                <span>🏛️</span>
                <span className="truncate">{matchedEntity.name}</span>
              </span>
            )}

            {isMultiParcel && (
              <span className="text-[10px] font-semibold text-cyan-300 bg-cyan-950/60 border border-cyan-800/50 px-2 py-0.5 rounded-md inline-flex items-center space-x-1 shrink-0" title={`${parcels.length} linked parcels / addresses`}>
                <MapPin className="w-3 h-3 text-cyan-400" />
                <span>{parcels.length} Parcels</span>
              </span>
            )}
          </div>

          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Deal Actions"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-48 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-30"
                onClick={() => setMenuOpen(false)}
              >
                <button
                  onClick={() => onToggleStatus(deal)}
                  className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 flex items-center space-x-2"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{isOwned ? 'Move to Pipeline' : 'Mark as Acquired'}</span>
                </button>
                <button
                  onClick={() => onEdit(deal)}
                  className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 flex items-center space-x-2"
                >
                  <Edit2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Edit Project Details</span>
                </button>
                <button
                  onClick={() => onDelete(deal)}
                  className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-slate-900 flex items-center space-x-2 border-t border-slate-900 mt-1 pt-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Project</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Title & Location */}
        <h3 className="text-sm font-black text-white group-hover:text-emerald-400 transition tracking-tight line-clamp-1">
          {displayName}
        </h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-2.5 line-clamp-1">
          {deal.location || `${deal.city || 'Yakima'}, ${deal.state || 'WA'}`}
        </p>

        {/* Tenancy Strip (if leases or units exist) */}
        {leasesList.length > 0 ? (
          <div className="mb-2.5 flex items-center justify-between text-[11px] bg-slate-950/60 px-2.5 py-1.5 rounded-xl border border-slate-900/80 text-slate-300">
            <span className="flex items-center space-x-1.5 truncate max-w-[200px]" title={leasesList.map((l: any) => l.tenantName).filter(Boolean).join(', ')}>
              <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-bold text-slate-200 whitespace-nowrap">{leasesList.length} {leasesList.length === 1 ? 'Tenant' : 'Tenants'}</span>
              <span className="text-slate-500 truncate">• {leasesList[0]?.tenantName || 'Active'}</span>
            </span>
            <span className="text-emerald-400 font-semibold text-[10px] whitespace-nowrap">Contract Rent</span>
          </div>
        ) : unitCount > 1 ? (
          <div className="mb-2.5 flex items-center justify-between text-[11px] bg-slate-950/60 px-2.5 py-1.5 rounded-xl border border-slate-900/80 text-slate-300">
            <span className="flex items-center space-x-1.5">
              <Building className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-bold text-slate-200">{unitCount} Operating Units</span>
            </span>
            <span className="text-cyan-400 font-semibold text-[10px]">Multi-Unit</span>
          </div>
        ) : null}

        {/* Dynamic Point-in-Time Score Grid */}
        <div className="grid grid-cols-2 gap-2.5 py-2.5 border-y border-slate-800/80 text-xs font-mono">
          <div>
            <div className="text-[10px] uppercase font-sans text-slate-400 flex items-center justify-between">
              <span>{isOwned ? 'Current Value' : 'Purchase Basis'}</span>
              {isOwned && (
                <span className="text-[9px] font-mono text-emerald-400 font-bold">
                  Mo {pit.monthsElapsed}
                </span>
              )}
            </div>
            <div className="font-bold text-white text-sm">
              ${Math.round(pit.currentVal).toLocaleString()}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-sans text-slate-400">Target IRR</div>
            <div className="font-bold text-emerald-400 text-sm">
              {irrStr}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-sans text-slate-400 flex items-center justify-between">
              <span>Remaining Debt</span>
              <span className="text-[9px] font-mono text-slate-400 font-normal">
                {pit.ltv > 0 ? `${pit.ltv}% LTV` : ''}
              </span>
            </div>
            <div className="font-bold text-slate-200">
              ${Math.round(pit.currentDebt).toLocaleString()}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-sans text-slate-400">Built Equity</div>
            <div className="font-bold text-emerald-300">
              ${Math.round(pit.currentEquity).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Quick Secondary Stats: Annual & Monthly Cashflow + CoC */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 py-2 border-b border-slate-800/50">
          <span className="flex items-center space-x-1.5">
            <span>Cashflow:</span>
            <strong className={`font-mono font-bold ${isCashPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${Math.round(pit.currentCashFlow).toLocaleString()}/yr
            </strong>
            <span className={`text-[9px] font-mono font-semibold ${isCashPositive ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
              ({isCashPositive ? '+' : ''}${Math.round(monthlyCashflow).toLocaleString()}/mo)
            </span>
          </span>
          <span>
            CoC:{' '}
            <strong className="text-white font-mono font-bold">
              {cocStr}
            </strong>
          </span>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 mt-3.5 pt-1">
        <button
          onClick={() => exportDealBriefPDF(deal.id)}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold flex items-center gap-1.5 transition border border-slate-700/60"
          title="Export Institutional PDF"
        >
          <FileDown className="w-3.5 h-3.5 text-slate-400" />
          <span>PDF Brief</span>
        </button>

        <Link
          to={`/project?id=${encodeURIComponent(deal.id)}`}
          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center gap-1 transition shadow-sm"
        >
          <span>Open Studio</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
};
