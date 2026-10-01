import React, { useState, useMemo, useEffect } from 'react';
import { DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { formatCurrency } from '../../lib/format';
import { ScenarioPresetType, dealScope } from '../../lib/compare/compareTypes';
import { Search, X, Plus, Building, Layers } from 'lucide-react';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  deals: DealRecord[];
  onSelectDeal: (deal: DealRecord, preset: ScenarioPresetType, customName?: string) => void;
  alreadySelectedDealIds: string[];
  /** Which group the list opens on (follows the page's Pipeline / Owned / All scope). */
  initialStatusFilter?: 'all' | 'owned' | 'prospect';
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  deals,
  onSelectDeal,
  alreadySelectedDealIds,
  initialStatusFilter = 'all',
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'owned' | 'prospect'>(initialStatusFilter);
  useEffect(() => {
    if (isOpen) setStatusFilter(initialStatusFilter);
  }, [isOpen, initialStatusFilter]);
  const [selectedPreset, setSelectedPreset] = useState<ScenarioPresetType>('live');

  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      // Same rule as the page scope: owned vs pipeline (archived deals only show under All)
      if (statusFilter === 'owned' && dealScope(d) !== 'owned') return false;
      if (statusFilter === 'prospect' && dealScope(d) !== 'pipeline') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const title = resolveDealDisplayName(d).toLowerCase();
        const loc = (d.location || '').toLowerCase();
        const asset = (d.asset_class || d.assetType || '').toLowerCase();
        if (!title.includes(q) && !loc.includes(q) && !asset.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [deals, search, statusFilter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Add Property to Comparison</h3>
              <p className="text-xs text-slate-400">Select an asset from your portfolio or pipeline</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/40 space-y-3">
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by property title, city, or asset class..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3.5 py-2 pl-9 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition"
              autoFocus
            />
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {(['all', 'owned', 'prospect'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-lg font-bold text-[11px] capitalize transition ${
                    statusFilter === s
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s === 'all' ? 'All Assets' : s === 'owned' ? 'Owned Portfolio' : 'Pipeline'}
                </button>
              ))}
            </div>

            {/* Scenario Preset Selector */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] font-bold text-slate-400">Underwriting Case:</span>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value as ScenarioPresetType)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] font-bold text-emerald-400 focus:outline-none"
              >
                <option value="live">Live Active Model</option>
                <option value="baseline">Acquisition Baseline</option>
                <option value="bull">Bull Case (+8% Rent)</option>
                <option value="bear">Bear Case (-8% Rent, +3% Vacancy)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Deals List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 divide-y divide-slate-800/40">
          {filteredDeals.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No matching properties found.
            </div>
          ) : (
            filteredDeals.map((deal) => {
              const title = resolveDealDisplayName(deal);
              const price = Number(deal.purchase_price || deal.inputs?.purchasePrice || 0);
              const isAlreadyAdded = alreadySelectedDealIds.includes(deal.id);
              const assetClass = String(deal.asset_class || deal.assetType || 'single-family');

              return (
                <div
                  key={deal.id}
                  className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 p-2.5 rounded-2xl hover:bg-slate-800/40 transition group"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-extrabold text-sm text-white group-hover:text-emerald-400 transition truncate">
                        {title}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0 bg-slate-800 text-slate-300 border-slate-700">
                        {assetClass}
                      </span>
                      {deal.status === 'owned' ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0">
                          Owned
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-cyan-500/10 text-cyan-400 border-cyan-500/20 shrink-0">
                          Pipeline
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-3 text-xs text-slate-400">
                      <span>{deal.location || 'Yakima, WA'}</span>
                      <span>•</span>
                      <span className="font-mono text-slate-300 font-bold">{formatCurrency(price)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onSelectDeal(deal, selectedPreset);
                      onClose();
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shrink-0 shadow-sm ${
                      isAlreadyAdded
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isAlreadyAdded ? 'Add Again' : 'Add to Compare'}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <span>Click "Add to Compare" to insert into the matrix.</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-bold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
