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
  Calendar,
  DollarSign,
  TrendingUp,
} from 'lucide-react';

interface DealCardProps {
  deal: DealRecord;
  onEdit: (deal: DealRecord) => void;
  onDelete: (deal: DealRecord) => void;
  onToggleStatus: (deal: DealRecord) => void;
}

export const DealCard: React.FC<DealCardProps> = ({
  deal,
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
        return <Store className="w-4 h-4 text-amber-400" />;
      case 'storage':
        return <Warehouse className="w-4 h-4 text-purple-400" />;
      case 'multi_family':
        return <Building className="w-4 h-4 text-cyan-400" />;
      default:
        return <Home className="w-4 h-4 text-emerald-400" />;
    }
  };

  const formatAssetClass = (ac: string) => {
    switch (ac) {
      case 'commercial':
        return 'Commercial';
      case 'storage':
        return 'Self-Storage';
      case 'multi_family':
        return 'Multi-Family';
      default:
        return 'Single-Family';
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 transition shadow-sm flex flex-col justify-between group relative">
      <div>
        {/* Top Header: Badge, Asset Class, Menu */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center space-x-2">
            <span
              className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${
                isOwned
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
              }`}
            >
              {isOwned ? 'Owned Asset' : 'Pipeline'}
            </span>
            <div className="flex items-center space-x-1 text-[11px] font-bold text-slate-400">
              {getAssetIcon(deal.asset_class)}
              <span>{formatAssetClass(deal.asset_class)}</span>
            </div>
          </div>

          <div className="relative">
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
        <p className="text-xs text-slate-400 mt-0.5 mb-3 line-clamp-1">
          {deal.location || `${deal.city || 'Union Gap'}, ${deal.state || 'WA'}`}
        </p>

        {/* Dynamic Point-in-Time Score Grid */}
        <div className="grid grid-cols-2 gap-2.5 py-3 border-y border-slate-800/80 text-xs font-mono">
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
            <div className="text-[10px] uppercase font-sans text-slate-400">Underwritten IRR</div>
            <div className="font-bold text-emerald-400 text-sm">
              {pit.irr > 0 ? `${pit.irr.toFixed(1)}%` : 'N/A'}
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

        {/* Quick Secondary Stats */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 py-2 border-b border-slate-800/50">
          <span>
            Cashflow:{' '}
            <strong className="text-emerald-400 font-mono">
              ${Math.round(pit.currentCashFlow).toLocaleString()}/yr
            </strong>
          </span>
          <span>
            CoC:{' '}
            <strong className="text-white font-mono">
              {deal.cash_on_cash ? `${deal.cash_on_cash.toFixed(1)}%` : 'N/A'}
            </strong>
          </span>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 mt-4 pt-1">
        <button
          onClick={() => exportDealBriefPDF(deal.id)}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold flex items-center gap-1.5 transition"
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
