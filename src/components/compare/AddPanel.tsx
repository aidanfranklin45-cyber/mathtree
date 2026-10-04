import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import type { DealInputs, DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { formatCurrency } from '../../lib/format';
import { ComparisonColumn, countDealsByScope } from '../../lib/compare/compareTypes';
import { ScenarioOption, baseScenarioOptions, loadExtraScenarioOptions } from '../../lib/compare/buildColumns';
import { CompareFilters, dealAssetClass, dealPrice } from '../../lib/compare/filters';
import { MAX_BOARD_ENTRIES } from '../../lib/compare/config';
import { SidePanel } from './SidePanel';
import { WhatIfScrubberBar } from './WhatIfScrubberBar';

interface AddPanelProps {
  open: boolean;
  onClose: () => void;
  /** Every deal the user can see (for the status counts). */
  allDeals: DealRecord[];
  /** Deals that pass the current filters: what the list offers. */
  shownDeals: DealRecord[];
  columns: ComparisonColumn[];
  filters: CompareFilters;
  onFiltersChange: (f: CompareFilters) => void;
  onOpenFilters: () => void;
  filterCount: number;
  onToggleScenario: (deal: DealRecord, scenario: string, label: string, on: boolean) => void;
  onAddWhatIf: (deal: DealRecord, overrides: Partial<DealInputs>, name: string) => void;
  onAddAll: (deals: DealRecord[]) => void;
}

const STATUS_CHIPS: Array<{ id: 'all' | 'pipeline' | 'owned'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'owned', label: 'Owned' },
];

const Tick: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${on ? 'bg-emerald-500 border-emerald-400 text-slate-950' : 'border-slate-600 text-transparent'}`}>
    <Check className="w-3.5 h-3.5" strokeWidth={3} />
  </span>
);

/** One deal in the list: tap the row to put its live model on the board, expand for other scenarios. */
const DealRow: React.FC<{
  deal: DealRecord;
  columns: ComparisonColumn[];
  atLimit: boolean;
  onToggleScenario: AddPanelProps['onToggleScenario'];
  onAddWhatIf: AddPanelProps['onAddWhatIf'];
}> = ({ deal, columns, atLimit, onToggleScenario, onAddWhatIf }) => {
  const [expanded, setExpanded] = useState(false);
  const [extra, setExtra] = useState<ScenarioOption[] | null>(null);

  useEffect(() => {
    if (!expanded || extra) return;
    let live = true;
    loadExtraScenarioOptions(deal).then((o) => { if (live) setExtra(o); }).catch(() => { if (live) setExtra([]); });
    return () => { live = false; };
  }, [expanded, extra, deal]);

  const mine = columns.filter((c) => c.dealId === deal.id);
  const has = (key: string) => mine.some((c) => (c.scenarioKey ?? c.scenarioType) === key);
  const whatIfs = mine.filter((c) => (c.scenarioKey ?? c.scenarioType) === 'whatif');
  const title = resolveDealDisplayName(deal);
  const liveOn = has('live');
  const options = [...baseScenarioOptions(deal), ...(extra ?? [])];

  return (
    <li className="border-b border-slate-800/60 last:border-b-0">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onToggleScenario(deal, 'live', 'Live Model', !liveOn)}
          disabled={!liveOn && atLimit}
          className="flex-1 min-w-0 flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-800/40 transition disabled:opacity-40 min-h-[56px]"
          aria-pressed={liveOn}
        >
          <Tick on={liveOn} />
          <span className="min-w-0">
            <span className="block text-sm font-extrabold text-white truncate">{title}</span>
            <span className="block text-xs text-slate-400 truncate">
              {deal.status === 'owned' ? 'Owned' : 'Pipeline'} · {dealAssetClass(deal)} · {formatCurrency(dealPrice(deal))}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="px-4 flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800/40 transition"
          aria-expanded={expanded}
          aria-label={`Scenarios for ${title}`}
        >
          {mine.length > 1 && <span className="px-1.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">{mine.length}</span>}
          <span className="hidden sm:inline">Scenarios</span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-4 pl-14 space-y-1">
          {options.map((o) => {
            const on = has(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => onToggleScenario(deal, o.key, o.label, !on)}
                disabled={!on && atLimit}
                className="w-full flex items-center gap-3 py-2 text-left rounded-lg hover:bg-slate-800/40 transition disabled:opacity-40 min-h-[44px]"
                aria-pressed={on}
              >
                <Tick on={on} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-100">{o.label}</span>
                  {o.hint && <span className="block text-[11px] text-slate-500 truncate">{o.hint}</span>}
                </span>
              </button>
            );
          })}
          {extra === null && <p className="text-[11px] text-slate-500 py-1">Looking for saved runs and baselines…</p>}
          {whatIfs.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2 min-h-[44px]">
              <Tick on />
              <span className="text-sm font-bold text-slate-100 truncate">{c.scenarioName}</span>
              <span className="text-[11px] text-slate-500">What-if on the board (remove with the x on its column)</span>
            </div>
          ))}
          <div className="pt-1">
            <WhatIfScrubberBar deal={deal} onAddWhatIfColumn={(overrides, name) => onAddWhatIf(deal, overrides, name)} />
          </div>
        </div>
      )}
    </li>
  );
};

export const AddPanel: React.FC<AddPanelProps> = ({
  open,
  onClose,
  allDeals,
  shownDeals,
  columns,
  filters,
  onFiltersChange,
  onOpenFilters,
  filterCount,
  onToggleScenario,
  onAddWhatIf,
  onAddAll,
}) => {
  const counts = useMemo(() => countDealsByScope(allDeals), [allDeals]);
  const atLimit = columns.length >= MAX_BOARD_ENTRIES;
  const notOnBoard = shownDeals.filter((d) => !columns.some((c) => c.dealId === d.id && (c.scenarioKey ?? c.scenarioType) === 'live'));

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Add to comparison"
      subtitle="Tap a property to add or remove it. Open Scenarios for other cases."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{columns.length} on the board{atLimit ? ` (limit ${MAX_BOARD_ENTRIES})` : ''}</span>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black transition">Done</button>
        </div>
      }
    >
      <div className="px-5 py-3 space-y-3 border-b border-slate-800/80 sticky top-0 bg-slate-900 z-10">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            value={filters.text}
            onChange={(e) => onFiltersChange({ ...filters, text: e.target.value })}
            placeholder="Search name, city or asset class"
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800" role="group" aria-label="Deal status">
            {STATUS_CHIPS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onFiltersChange({ ...filters, status: s.id })}
                aria-pressed={filters.status === s.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${filters.status === s.id ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60' : 'text-slate-400 hover:text-white'}`}
              >
                {s.label} <span className="font-mono text-[10px] text-slate-500">{counts[s.id]}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onOpenFilters} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-950 border border-slate-800 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>More filters</span>
            {filterCount > 0 && <span className="px-1.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">{filterCount}</span>}
          </button>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Showing {shownDeals.length} of {allDeals.length}</span>
          {notOnBoard.length > 0 && !atLimit && (
            <button type="button" onClick={() => onAddAll(notOnBoard)} className="font-bold text-emerald-400 hover:text-emerald-300">
              Add all {notOnBoard.length} shown
            </button>
          )}
        </div>
      </div>

      {shownDeals.length === 0 ? (
        <div className="py-14 px-6 text-center text-sm text-slate-400">
          Nothing matches these filters.
          <div>
            <button
              type="button"
              onClick={() => onFiltersChange({ status: 'all', assetClasses: [], minPrice: null, maxPrice: null, text: '', thresholds: [] })}
              className="mt-2 font-bold text-emerald-400 hover:text-emerald-300"
            >
              Clear all filters
            </button>
          </div>
        </div>
      ) : (
        <ul>
          {shownDeals.map((d) => (
            <DealRow key={d.id} deal={d} columns={columns} atLimit={atLimit} onToggleScenario={onToggleScenario} onAddWhatIf={onAddWhatIf} />
          ))}
        </ul>
      )}
    </SidePanel>
  );
};
