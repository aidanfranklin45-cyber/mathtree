import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { mapSupabaseDeal } from '../stores/useDealStore';
import { DealRecord, DealInputs } from '../lib/math/types';
import { resolveDealDisplayName } from '../lib/math/pointInTime';
import { ConnectedHeader } from '../components/layout/ConnectedHeader';
import { CompareHeader } from '../components/compare/CompareHeader';
import { CompareMatrixTable } from '../components/compare/CompareMatrixTable';
import { CompareCharts } from '../components/compare/CompareCharts';
import { AddProjectModal } from '../components/compare/AddProjectModal';
import { WhatIfScrubberBar } from '../components/compare/WhatIfScrubberBar';
import {
  ComparisonMode,
  ComparisonColumn,
  CompareScope,
  filterDealsByScope,
  countDealsByScope,
  resolveInitialScope,
  ScenarioPresetType,
  extractComparisonSummary,
  evaluateWinners,
  getPresetOverrides,
} from '../lib/compare/compareTypes';
import { exportComparisonCSV } from '../lib/compare/compareExport';
import { listScenarioRuns, ScenarioRun } from '../lib/scenarios';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';

const DEAL_FIELDS = 'id, user_id, title, location, asset_type, status, purchase_price, is_demo, inputs, created_at, updated_at, entity_id';

export const ComparePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // View state
  const initialMode = (searchParams.get('mode') as ComparisonMode) || (searchParams.get('dealId') ? 'versions' : 'properties');
  const [mode, setMode] = useState<ComparisonMode>(initialMode);
  const [viewType, setViewType] = useState<'table' | 'charts'>('table');
  const [selectedSingleDealId, setSelectedSingleDealId] = useState<string | null>(searchParams.get('dealId') || null);

  // Columns & custom overrides
  const [columns, setColumns] = useState<ComparisonColumn[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Scope: prospective deals by default; Owned and All are one click away. Resolved once the deals have loaded.
  const [scope, setScope] = useState<CompareScope>('pipeline');
  const [scopeReady, setScopeReady] = useState(false);
  const linkHonored = useRef(false);
  const scopedDeals = useMemo(() => filterDealsByScope(deals, scope), [deals, scope]);
  const scopeCounts = useMemo(() => countDealsByScope(deals), [deals]);

  useEffect(() => {
    if (scopeReady || deals.length === 0) return;
    const dealParam = searchParams.get('dealId');
    const asked = [...(searchParams.get('deals')?.split(',').filter(Boolean) || []), ...(dealParam ? [dealParam] : [])];
    setScope(resolveInitialScope(deals, searchParams.get('scope'), asked));
    setScopeReady(true);
  }, [deals, scopeReady, searchParams]);

  // Load all deals
  const loadDeals = async () => {
    setLoading(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const user = sessionRes?.session?.user;

      let list: DealRecord[] = [];
      if (user) {
        const { data: userDeals } = await supabase
          .from('deals')
          .select(DEAL_FIELDS)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (userDeals && userDeals.length > 0) {
          list = (userDeals as any[]).map(mapSupabaseDeal);
        }
      }

      if (list.length === 0) {
        const { data: publicDeals } = await supabase
          .from('deals')
          .select(DEAL_FIELDS)
          .order('created_at', { ascending: false })
          .limit(10);
        if (publicDeals && publicDeals.length > 0) {
          list = (publicDeals as any[]).map(mapSupabaseDeal);
        } else {
          list = [mapSupabaseDeal(BENCHMARK_DEAL)];
        }
      }

      setDeals(list);
    } catch (err) {
      console.error('[compare] Failed to load deals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDeals();
  }, []);

  // Update URL params when mode or single deal changes
  const updateUrlParams = (newMode: ComparisonMode, dealId: string | null, nextScope: CompareScope = scope) => {
    const params = new URLSearchParams();
    params.set('mode', newMode);
    params.set('scope', nextScope);
    if (dealId) params.set('dealId', dealId);
    setSearchParams(params, { replace: true });
  };

  // Helper: Build a single comparison column
  const buildColumn = useCallback(
    (
      deal: DealRecord,
      scenarioType: ScenarioPresetType,
      scenarioName?: string,
      customOverrides?: Partial<DealInputs>,
      isBenchmark = false,
    ): ComparisonColumn => {
      const overrides = customOverrides ?? getPresetOverrides(scenarioType, deal.inputs || {});
      const { metrics, summary } = extractComparisonSummary(deal, overrides);
      const title = resolveDealDisplayName(deal);
      const aClass = String(deal.asset_class || deal.assetType || 'single-family');

      let name = scenarioName;
      if (!name) {
        switch (scenarioType) {
          case 'live':
            name = 'Live Model';
            break;
          case 'baseline':
            name = 'Acquisition Baseline';
            break;
          case 'bull':
            name = 'Bull (+8% Rent)';
            break;
          case 'bear':
            name = 'Bear (-8% Rent, +3% Vac)';
            break;
          case 'history':
            name = 'Saved Run';
            break;
          default:
            name = 'Custom';
        }
      }

      return {
        id: `${deal.id}-${scenarioType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dealId: deal.id,
        dealTitle: title,
        assetClass: aClass,
        status: deal.status === 'owned' ? 'owned' : 'prospect',
        location: deal.location || deal.address || 'Yakima, WA',
        scenarioName: name,
        scenarioType,
        overrides,
        deal,
        metrics,
        summary,
        isBenchmark,
      };
    },
    [],
  );

  // Initialize columns when deals load or mode changes
  useEffect(() => {
    if (!scopeReady) return;

    if (mode === 'properties') {
      // A ?deals=id1,id2,id3 link is honored on the first build only; later scope changes use the scope's own defaults
      const requestedIds = linkHonored.current ? [] : (searchParams.get('deals')?.split(',').filter(Boolean) || []);
      linkHonored.current = true;
      const selected = requestedIds.length > 0
        ? scopedDeals.filter((d) => requestedIds.includes(d.id))
        : scopedDeals.slice(0, 3); // default to the top 3 deals in scope

      const cols = (selected.length > 0 ? selected : scopedDeals.slice(0, 1)).map((d, idx) =>
        buildColumn(d, 'live', 'Live Active Model', undefined, idx === 0),
      );
      setColumns(cols);
    } else if (mode === 'versions') {
      // Pick focus deal
      const focusId = selectedSingleDealId || searchParams.get('dealId') || scopedDeals[0]?.id;
      const targetDeal = scopedDeals.find((d) => d.id === focusId) || scopedDeals[0];
      if (!targetDeal) {
        setColumns([]);
        return;
      }

      // Also corrects a focus deal that the current scope no longer includes
      if (selectedSingleDealId !== targetDeal.id) setSelectedSingleDealId(targetDeal.id);

      // Load scenario runs from DB for this deal, plus standard presets
      let isLive = true;
      (async () => {
        const historyRuns = await listScenarioRuns(targetDeal.id, 3);
        if (!isLive) return;

        const defaultCols: ComparisonColumn[] = [
          buildColumn(targetDeal, 'live', 'Active Live Model', undefined, true),
          buildColumn(targetDeal, 'baseline', 'Acquisition Baseline', undefined, false),
          buildColumn(targetDeal, 'bull', 'Bull Case (+8% Rent)', undefined, false),
          buildColumn(targetDeal, 'bear', 'Bear Case (-8% Rent, +3% Vac)', undefined, false),
        ];

        // Add history runs if available
        if (historyRuns && historyRuns.length > 0) {
          historyRuns.forEach((run) => {
            defaultCols.push(
              buildColumn(
                targetDeal,
                'history',
                run.name || 'Historical Run',
                run.inputs,
                false,
              ),
            );
          });
        }

        setColumns(defaultCols);
      })();

      return () => {
        isLive = false;
      };
    }
  }, [scopedDeals, scopeReady, mode, selectedSingleDealId, buildColumn]);

  // Mode change handler
  const handleSetMode = (nextMode: ComparisonMode) => {
    setMode(nextMode);
    updateUrlParams(nextMode, selectedSingleDealId);
  };

  // Scope change: the columns rebuild from the new scope's defaults
  const handleSetScope = (next: CompareScope) => {
    setScope(next);
    updateUrlParams(mode, selectedSingleDealId, next);
  };

  // Focus deal change in version mode
  const handleSelectSingleDeal = (dealId: string) => {
    setSelectedSingleDealId(dealId);
    updateUrlParams('versions', dealId);
  };

  // Add deal from modal
  const handleAddDeal = (deal: DealRecord, preset: ScenarioPresetType, customName?: string) => {
    const newCol = buildColumn(deal, preset, customName, undefined, columns.length === 0);
    setColumns((prev) => [...prev, newCol]);
  };

  // Remove column
  const handleRemoveColumn = (colId: string) => {
    setColumns((prev) => {
      const next = prev.filter((c) => c.id !== colId);
      // Ensure at least one benchmark remains
      if (next.length > 0 && !next.some((c) => c.isBenchmark)) {
        next[0].isBenchmark = true;
      }
      return next;
    });
  };

  // Set benchmark column
  const handleSetBenchmark = (colId: string) => {
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        isBenchmark: c.id === colId,
      })),
    );
  };

  // Reset columns
  const handleReset = () => {
    if (mode === 'properties') {
      const top = scopedDeals.slice(0, 3).map((d, idx) =>
        buildColumn(d, 'live', 'Live Active Model', undefined, idx === 0),
      );
      setColumns(top);
    } else if (mode === 'versions' && selectedSingleDealId) {
      const deal = scopedDeals.find((d) => d.id === selectedSingleDealId) || scopedDeals[0];
      if (deal) {
        setColumns([
          buildColumn(deal, 'live', 'Active Live Model', undefined, true),
          buildColumn(deal, 'baseline', 'Acquisition Baseline', undefined, false),
          buildColumn(deal, 'bull', 'Bull Case (+8% Rent)', undefined, false),
          buildColumn(deal, 'bear', 'Bear Case (-8% Rent, +3% Vac)', undefined, false),
        ]);
      }
    } else {
      setColumns([]);
    }
  };

  const currentFocusDeal = useMemo(() => {
    return scopedDeals.find((d) => d.id === selectedSingleDealId) || scopedDeals[0];
  }, [scopedDeals, selectedSingleDealId]);

  const handleAddWhatIf = (overrides: Partial<DealInputs>, name: string) => {
    if (!currentFocusDeal) return;
    const newCol = buildColumn(currentFocusDeal, 'custom', name, overrides, false);
    setColumns((prev) => [...prev, newCol]);
  };

  // Winners calculation
  const winners = useMemo(() => evaluateWinners(columns), [columns]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <ConnectedHeader active="compare" deals={deals} onDealsChanged={() => { void loadDeals(); }} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-6">
        {/* Header Controls */}
        <CompareHeader
          mode={mode}
          onSetMode={handleSetMode}
          viewType={viewType}
          onSetViewType={setViewType}
          columnsCount={columns.length}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          onExportCsv={() => exportComparisonCSV(columns)}
          onReset={handleReset}
          deals={scopedDeals}
          selectedSingleDealId={selectedSingleDealId}
          onSelectSingleDeal={handleSelectSingleDeal}
          scope={scope}
          onSetScope={handleSetScope}
          scopeCounts={scopeCounts}
        />

        {!loading && deals.length > 0 && scopedDeals.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
            No {scope === 'owned' ? 'owned' : 'pipeline'} deals yet.{' '}
            <button type="button" onClick={() => handleSetScope('all')} className="font-bold text-emerald-400 hover:text-emerald-300 underline">Show all deals</button>
          </div>
        )}

        {/* Interactive What-If Scrubber in Scenario / Version Mode */}
        {mode === 'versions' && currentFocusDeal && (
          <WhatIfScrubberBar
            deal={currentFocusDeal}
            onAddWhatIfColumn={handleAddWhatIf}
          />
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
            <p className="text-xs font-bold text-slate-300">Loading portfolio properties and engine models...</p>
          </div>
        ) : viewType === 'table' ? (
          <CompareMatrixTable
            columns={columns}
            winners={winners}
            onRemoveColumn={handleRemoveColumn}
            onSetBenchmark={handleSetBenchmark}
            onOpenAddModal={() => setIsAddModalOpen(true)}
          />
        ) : (
          <CompareCharts columns={columns} />
        )}
      </main>

      {/* Add Deal Modal */}
      <AddProjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        deals={deals}
        onSelectDeal={handleAddDeal}
        alreadySelectedDealIds={columns.map((c) => c.dealId)}
        initialStatusFilter={scope === 'owned' ? 'owned' : scope === 'pipeline' ? 'prospect' : 'all'}
      />
    </div>
  );
};
