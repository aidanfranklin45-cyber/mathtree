import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { mapSupabaseDeal } from '../stores/useDealStore';
import { DealRecord, DealInputs } from '../lib/math/types';
import { resolveDealDisplayName } from '../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../lib/engine/compute';
import { ConnectedHeader } from '../components/layout/ConnectedHeader';
import { CompareMatrixTable, MatrixSort } from '../components/compare/CompareMatrixTable';
import { CompareCards } from '../components/compare/CompareCards';
import { CompareCharts } from '../components/compare/CompareCharts';
import { CompareStarter } from '../components/compare/CompareStarter';
import { BuilderStrip } from '../components/compare/BuilderStrip';
import { AddPanel } from '../components/compare/AddPanel';
import { MetricsPanel } from '../components/compare/MetricsPanel';
import { FiltersPanel } from '../components/compare/FiltersPanel';
import { SavedPanel } from '../components/compare/SavedPanel';
import { UpdateBaselineModal } from '../components/compare/UpdateBaselineModal';
import {
  ComparisonColumn,
  MergedColumnNote,
  describeMergedNote,
  columnFingerprint,
  scenarioShortLabel,
  extractComparisonSummary,
  evaluateWinners,
} from '../lib/compare/compareTypes';
import { exportComparisonCSV } from '../lib/compare/compareExport';
import {
  BUILT_IN_PRESETS,
  CompareConfig,
  CompareView,
  MAX_BOARD_ENTRIES,
  configSignature,
  decodeConfig,
  emptyConfig,
  encodeConfig,
} from '../lib/compare/config';
import { buildColumn, buildScenarioSet, columnForEntry, columnsForConfig, configFromColumns, findTwin } from '../lib/compare/buildColumns';
import { CORE_METRIC_KEYS, getMetric, matchingMetricSet, rankColumns } from '../lib/compare/metrics';
import { CompareFilters, NO_FILTERS, activeFilterCount, dealPassesFilters, filterChips } from '../lib/compare/filters';
import {
  RecentBoard,
  SavedView,
  createSavedView,
  deleteSavedView,
  listSavedViews,
  loadDraft,
  loadRecents,
  pushRecent,
  saveDraft,
  updateSavedView,
} from '../lib/compare/savedViews';
import { getInitialBaseline, replaceBaseline } from '../lib/baselines/db';
import { dealFromBaseline, dealWithScenario } from '../lib/compare/baselineColumn';
import { useIsPhone } from '../hooks/useMediaQuery';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { InquiryCommandBar } from '../components/compare/guided/InquiryCommandBar';
import { ComparativeStoryCard } from '../components/compare/guided/ComparativeStoryCard';
import { InquiryVisualizer } from '../components/compare/guided/InquiryVisualizer';
import {
  GuidedQuestionId,
  getGuidedQuestionsWithProfile,
} from '../lib/compare/guidedQuestions';
import { fetchProfile, InvestorProfile, DEFAULT_PROFILE } from '../lib/profile';
import {
  executeBankabilityInquiry,
  executeExpenseRatioInquiry,
  executeLeverageInquiry,
  executeStrikePriceInquiry,
  executeStressInquiry,
  executeAllocationInquiry,
  InquiryExecutionResult,
} from '../lib/compare/inquiries';
import {
  executeConfiguredInquiry,
  CustomInquiryConfig,
} from '../lib/compare/inquiryConfigurator';

/** What the page needs to know about the focus deal's recorded acquisition baseline. */
interface BaselineInfo {
  capturedAt: string;
  fingerprint: string;
  irr: number;
}

type PanelName = 'add' | 'metrics' | 'filters' | 'saved' | null;

const DEAL_FIELDS = 'id, user_id, title, location, asset_type, status, purchase_price, is_demo, inputs, created_at, updated_at, entity_id';

export const ComparePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isPhone = useIsPhone();

  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [profile, setProfile] = useState<InvestorProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);

  // The board
  const [columns, setColumns] = useState<ComparisonColumn[]>([]);
  const [metrics, setMetrics] = useState<string[]>([...CORE_METRIC_KEYS]);
  const [view, setView] = useState<CompareView>('matrix');
  const [phoneTable, setPhoneTable] = useState(false);
  const [sort, setSort] = useState<MatrixSort | null>(null);
  const [mergeNotes, setMergeNotes] = useState<MergedColumnNote[]>([]);
  const [infoNotes, setInfoNotes] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ message: string; columns: ComparisonColumn[] } | null>(null);
  const undoTimer = useRef<number | null>(null);

  // Panels and filters
  const [panel, setPanel] = useState<PanelName>(null);
  // Filters opened from the Add panel return to it when closed
  const [filtersReturnTo, setFiltersReturnTo] = useState<PanelName>(null);
  const [filters, setFilters] = useState<CompareFilters>(NO_FILTERS);

  // Saved boards
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [activeSaved, setActiveSaved] = useState<{ id: string; name: string; signature: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [recents, setRecents] = useState<RecentBoard[]>(() => loadRecents());
  const [draft] = useState<CompareConfig | null>(() => loadDraft());

  // Guided Underwriting Inquiries
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<GuidedQuestionId>('bankability_down_payment');
  const [inquiryDealId, setInquiryDealId] = useState<string | null>(null);
  const [isCustomConfigMode, setIsCustomConfigMode] = useState(false);
  const [customInquiryConfig, setCustomInquiryConfig] = useState<CustomInquiryConfig | null>(null);

  // Baseline (owned deal, single-property board)
  const [baselineInfo, setBaselineInfo] = useState<BaselineInfo | null>(null);
  const [isBaselineModalOpen, setIsBaselineModalOpen] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);

  // --- Loading -------------------------------------------------------------

  const loadDeals = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const user = sessionRes?.session?.user;

      let list: DealRecord[] = [];
      if (user) {
        const { data: userDeals } = await supabase.from('deals').select(DEAL_FIELDS).eq('user_id', user.id).order('created_at', { ascending: false });
        if (userDeals && userDeals.length > 0) list = (userDeals as any[]).map(mapSupabaseDeal);
      }
      if (list.length === 0) {
        const { data: publicDeals } = await supabase.from('deals').select(DEAL_FIELDS).order('created_at', { ascending: false }).limit(10);
        list = publicDeals && publicDeals.length > 0 ? (publicDeals as any[]).map(mapSupabaseDeal) : [mapSupabaseDeal(BENCHMARK_DEAL)];
      }
      setDeals(list);

      // Load active investor profile for comparison assumptions
      try {
        const prof = await fetchProfile(supabase, user);
        setProfile(prof);
      } catch (profErr) {
        console.warn('[compare] Could not fetch profile, using defaults:', profErr);
      }
    } catch (err) {
      console.error('[compare] Failed to load deals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDeals(); }, [loadDeals]);

  useEffect(() => {
    let live = true;
    listSavedViews().then((v) => { if (live) { setSaved(v); setSavedLoading(false); } }).catch(() => { if (live) setSavedLoading(false); });
    return () => { live = false; };
  }, []);

  const config = useMemo(() => configFromColumns(columns, metrics, view), [columns, metrics, view]);
  const signature = useMemo(() => configSignature(config), [config]);
  const dirty = !!activeSaved && activeSaved.signature !== signature;

  // --- Links: a plain visit is blank; a link can pre-fill the board ---------------

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || loading || deals.length === 0) return;
    seeded.current = true;
    const shared = decodeConfig(searchParams.get('c'));
    const ids = searchParams.get('deals')?.split(',').filter(Boolean) ?? [];
    const dealId = searchParams.get('dealId');
    const scope = searchParams.get('scope');
    if (scope === 'pipeline' || scope === 'owned') setFilters((f) => ({ ...f, status: scope }));
    const inq = searchParams.get('inquiry') as GuidedQuestionId;
    if (inq) {
      setInquiryOpen(true);
      setActiveQuestionId(inq);
      if (dealId) setInquiryDealId(dealId);
    }
    const hasSeed = !!shared || ids.length > 0 || !!dealId;
    if (!hasSeed) return;
    setSearchParams({}, { replace: true });

    (async () => {
      if (shared) {
        const built = await columnsForConfig(shared, deals);
        setColumns(built.columns);
        setMetrics(shared.metrics);
        setView(shared.view);
        setInfoNotes(built.missing);
      } else if (dealId) {
        const deal = deals.find((d) => d.id === dealId);
        if (deal) await showScenarioSet(deal);
      } else {
        const picked = deals.filter((d) => ids.includes(d.id));
        setColumns(picked.map((d, i) => buildColumn(d, 'live', undefined, undefined, i === 0, 'live')));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, deals]);

  // Keep the unsaved board as a draft (a convenience; the page still opens blank)
  useEffect(() => {
    if (!seeded.current) return;
    saveDraft(columns.length > 0 ? config : null);
  }, [columns, config]);

  // --- Board changes -------------------------------------------------------------

  const offerUndo = useCallback((message: string, previous: ComparisonColumn[]) => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo({ message, columns: previous });
    undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
  }, []);

  useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);

  // Latest board for handlers that run after an await (adding a scenario looks things up first)
  const columnsRef = useRef<ComparisonColumn[]>([]);
  columnsRef.current = columns;

  const addColumns = useCallback((incoming: ComparisonColumn[]) => {
    const next = [...columnsRef.current];
    const notes: MergedColumnNote[] = [];
    for (const col of incoming) {
      if (next.length >= MAX_BOARD_ENTRIES) break;
      const twin = findTwin(next.filter((c) => c.dealId === col.dealId), col);
      if (twin) {
        // Same figures as a column already shown: say so instead of repeating it
        notes.push({ kept: scenarioShortLabel(twin), dropped: [scenarioShortLabel(col)], noRent: twin.summary.grossRentAnnual <= 0 });
        continue;
      }
      next.push({ ...col, isBenchmark: next.length === 0 });
    }
    columnsRef.current = next;
    setColumns(next);
    if (notes.length > 0) setMergeNotes((m) => [...m, ...notes]);
  }, []);

  const showScenarioSet = useCallback(async (deal: DealRecord) => {
    const built = await buildScenarioSet(deal);
    setColumns(built.columns);
    setMergeNotes(built.notes);
    setInfoNotes(built.infos);
    setActiveSaved(null);
  }, []);

  const handleToggleScenario = useCallback(async (deal: DealRecord, scenario: string, _label: string, on: boolean) => {
    if (!on) {
      setColumns((prev) => {
        const next = prev.filter((c) => !(c.dealId === deal.id && (c.scenarioKey ?? c.scenarioType) === scenario));
        if (next.length > 0 && !next.some((c) => c.isBenchmark)) next[0] = { ...next[0], isBenchmark: true };
        return next;
      });
      return;
    }
    const r = await columnForEntry(deal, { dealId: deal.id, scenario });
    if (r.column) addColumns([r.column]);
    else if (r.missing) setInfoNotes((n) => [...n, r.missing!]);
  }, [addColumns]);

  const handleAddWhatIf = useCallback((deal: DealRecord, overrides: Partial<DealInputs>, name: string) => {
    addColumns([buildColumn(deal, 'custom', name, overrides, false, 'whatif')]);
  }, [addColumns]);

  const handleAddAll = useCallback((list: DealRecord[]) => {
    addColumns(list.map((d) => buildColumn(d, 'live', undefined, undefined, false, 'live')));
  }, [addColumns]);

  const handleRemoveColumn = (colId: string) => {
    const col = columns.find((c) => c.id === colId);
    if (!col) return;
    offerUndo(`Removed ${col.dealTitle} (${col.scenarioName}).`, columns);
    setColumns((prev) => {
      const next = prev.filter((c) => c.id !== colId);
      if (next.length > 0 && !next.some((c) => c.isBenchmark)) next[0] = { ...next[0], isBenchmark: true };
      return next;
    });
  };

  const handleSetBenchmark = (colId: string) => setColumns((prev) => prev.map((c) => ({ ...c, isBenchmark: c.id === colId })));

  const handleClearBoard = () => {
    if (columns.length === 0) return;
    setRecents(pushRecent(config));
    offerUndo('Cleared the board.', columns);
    setColumns([]);
    setMergeNotes([]);
    setInfoNotes([]);
    setActiveSaved(null);
    setSort(null);
  };

  const handleUndo = () => {
    if (!undo) return;
    setColumns(undo.columns);
    setUndo(null);
  };

  const handleSort = (key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: 'best' } : s.dir === 'best' ? { key, dir: 'worst' } : null));
  };

  // --- Presets, saved boards, links ---------------------------------------------

  const openConfig = useCallback(async (cfg: CompareConfig, _label: string, savedId?: string) => {
    if (columns.length > 0) setRecents(pushRecent(config));
    const built = await columnsForConfig(cfg, deals);
    setColumns(built.columns);
    setMetrics(cfg.metrics);
    setView(cfg.view);
    setMergeNotes([]);
    setInfoNotes(built.missing);
    setSort(null);
    const view = savedId ? saved.find((s) => s.id === savedId) : undefined;
    setActiveSaved(view ? { id: view.id, name: view.name, signature: configSignature(configFromColumns(built.columns, cfg.metrics, cfg.view)) } : null);
  }, [columns.length, config, deals, saved]);

  const presets = useMemo(() => {
    if (panel !== 'saved') return [];
    const irrOf = (d: DealRecord) => tryComputeDealMetrics(d)?.irr || 0;
    return BUILT_IN_PRESETS.map((preset) => ({ preset, config: preset.build(deals, irrOf) }));
  }, [deals, panel]);

  const handleSaveNew = async (name: string) => {
    setSaveBusy(true);
    setSaveError(null);
    const r = await createSavedView(name, config);
    if (r.ok) {
      setSaved((s) => [r.value, ...s]);
      setActiveSaved({ id: r.value.id, name: r.value.name, signature });
    } else setSaveError(r.error);
    setSaveBusy(false);
  };

  const handleUpdateSaved = async () => {
    if (!activeSaved) return;
    setSaveBusy(true);
    setSaveError(null);
    const r = await updateSavedView(activeSaved.id, { config });
    if (r.ok) {
      setSaved((s) => s.map((v) => (v.id === r.value.id ? r.value : v)));
      setActiveSaved({ id: r.value.id, name: r.value.name, signature });
    } else setSaveError(r.error);
    setSaveBusy(false);
  };

  const handleRename = async (id: string, name: string) => {
    const r = await updateSavedView(id, { name });
    if (r.ok) {
      setSaved((s) => s.map((v) => (v.id === id ? r.value : v)));
      setActiveSaved((a) => (a && a.id === id ? { ...a, name: r.value.name } : a));
    } else setSaveError(r.error);
  };

  const handleDuplicate = async (v: SavedView) => {
    const r = await createSavedView(`${v.name} copy`, v.config);
    if (r.ok) setSaved((s) => [r.value, ...s]);
    else setSaveError(r.error);
  };

  const handleDelete = async (v: SavedView) => {
    if (await deleteSavedView(v.id)) {
      setSaved((s) => s.filter((x) => x.id !== v.id));
      setActiveSaved((a) => (a && a.id === v.id ? null : a));
    } else setSaveError('The comparison could not be deleted. Try again.');
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?c=${encodeConfig(config)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // No clipboard permission: put the link in the address bar so it can be copied from there
      setSearchParams({ c: encodeConfig(config) }, { replace: true });
    }
  };

  // --- Filters ----------------------------------------------------------------------

  const thresholdSummaries = useMemo(() => {
    if (filters.thresholds.length === 0) return null;
    const map = new Map<string, ReturnType<typeof extractComparisonSummary>['summary']>();
    for (const d of deals) {
      try { map.set(d.id, extractComparisonSummary(d).summary); } catch { /* a deal that cannot be modeled fails the threshold */ }
    }
    return map;
  }, [deals, filters.thresholds]);

  const shownDeals = useMemo(
    () => deals.filter((d) => dealPassesFilters(d, filters, thresholdSummaries ? thresholdSummaries.get(d.id) ?? null : null) && (!thresholdSummaries || thresholdSummaries.has(d.id))),
    [deals, filters, thresholdSummaries],
  );
  const chips = useMemo(() => filterChips(filters), [filters]);
  const filterCount = activeFilterCount(filters);

  // --- Baseline (owned deal, board of one property) ---------------------------------

  const focusDeal = useMemo(() => {
    const ids = new Set(columns.map((c) => c.dealId));
    if (ids.size !== 1) return null;
    const d = deals.find((x) => x.id === columns[0].dealId);
    return d && d.status === 'owned' && !d.is_demo && !d.is_shared ? d : null;
  }, [columns, deals]);

  useEffect(() => {
    if (!focusDeal) { setBaselineInfo(null); return; }
    let live = true;
    getInitialBaseline(focusDeal.id).then((row) => {
      if (!live) return;
      if (!row) { setBaselineInfo(null); return; }
      const col = buildColumn(dealFromBaseline(focusDeal, row), 'baseline');
      setBaselineInfo({ capturedAt: row.captured_at, fingerprint: columnFingerprint(col), irr: col.summary.irr });
    }).catch(() => { if (live) setBaselineInfo(null); });
    return () => { live = false; };
  }, [focusDeal]);

  const handleConfirmBaseline = async (column: ComparisonColumn) => {
    if (!focusDeal) return;
    setBaselineBusy(true);
    setBaselineError(null);
    const result = await replaceBaseline(dealWithScenario(focusDeal, column.overrides));
    if (result === 'created') {
      // Rebuild every column from its settings so the new baseline shows, keeping the what-ifs and the benchmark
      const rebuilt = await Promise.all(configFromColumns(columns, metrics, view).entries.map((e) => columnForEntry(focusDeal, e)));
      const next = rebuilt.map((r, i) => (r.column ? { ...r.column, isBenchmark: columns[i].isBenchmark } : columns[i]));
      setColumns(next);
      setIsBaselineModalOpen(false);
      const row = await getInitialBaseline(focusDeal.id);
      if (row) {
        const col = buildColumn(dealFromBaseline(focusDeal, row), 'baseline');
        setBaselineInfo({ capturedAt: row.captured_at, fingerprint: columnFingerprint(col), irr: col.summary.irr });
      }
    } else if (result === 'skipped') {
      setBaselineError('Only the owner of an owned deal can change its baseline.');
    } else {
      setBaselineError('The baseline could not be saved, and nothing was changed. Try again.');
    }
    setBaselineBusy(false);
  };

  // --- Render ---------------------------------------------------------------------------

  const selectedInquiryDeal = useMemo(() => {
    if (deals.length === 0) return null;
    return (inquiryDealId ? deals.find((d) => d.id === inquiryDealId) : null) || deals[0];
  }, [deals, inquiryDealId]);

  const inquiryResult = useMemo<InquiryExecutionResult | null>(() => {
    if (!selectedInquiryDeal) return null;
    try {
      if (isCustomConfigMode && customInquiryConfig) {
        const customRes = executeConfiguredInquiry(selectedInquiryDeal, customInquiryConfig);
        return {
          questionId: 'expense_ratio_bankability',
          story: customRes.story,
          columns: customRes.columns,
          rawResult: {
            points: customRes.points,
            baselineValue: customRes.baselineValue,
            targetThreshold: customInquiryConfig.targetThreshold ?? 1.25,
            variableKey: customInquiryConfig.variableKey,
          },
        };
      }

      const userDscr = profile.comparisonAssumptions?.targetDscr ?? 1.25;
      const userIrr = profile.comparisonAssumptions?.hurdleIrr ?? 15.0;
      const userRateShockBps = profile.comparisonAssumptions?.stressRateShockBps ?? 100;
      const userVacShockPct = profile.comparisonAssumptions?.stressVacancyShockPct ?? 5.0;

      switch (activeQuestionId) {
        case 'bankability_down_payment':
          return executeBankabilityInquiry(selectedInquiryDeal, userDscr);
        case 'expense_ratio_bankability':
          return executeExpenseRatioInquiry(selectedInquiryDeal, userDscr);
        case 'financial_leverage':
          return executeLeverageInquiry(selectedInquiryDeal);
        case 'max_offer_dscr':
          return executeStrikePriceInquiry(selectedInquiryDeal, 'dscr', userDscr);
        case 'max_offer_irr':
          return executeStrikePriceInquiry(selectedInquiryDeal, 'irr', userIrr);
        case 'rate_and_vacancy_stress':
          return executeStressInquiry(selectedInquiryDeal, userRateShockBps, userVacShockPct);
        case 'pipeline_allocation':
          return executeAllocationInquiry(deals.slice(0, 5));
        default:
          return executeBankabilityInquiry(selectedInquiryDeal, userDscr);
      }
    } catch (err) {
      console.warn('[compare] Inquiry computation error:', err);
      return null;
    }
  }, [selectedInquiryDeal, activeQuestionId, deals, isCustomConfigMode, customInquiryConfig]);

  const isCurrentInquiryPromoted = useMemo(() => {
    if (!inquiryResult || columns.length === 0) return false;
    return inquiryResult.columns.every((c) =>
      columns.some((b) => b.dealId === c.dealId && (b.scenarioKey === c.scenarioKey || b.scenarioName === c.scenarioName))
    );
  }, [inquiryResult, columns]);

  const handlePromoteInquiryToBoard = () => {
    if (!inquiryResult) return;
    setColumns(inquiryResult.columns);
    setInquiryOpen(false);
  };

  const winners = useMemo(() => evaluateWinners(columns), [columns]);
  const displayColumns = useMemo(() => {
    const m = sort ? getMetric(sort.key) : undefined;
    return m && sort ? rankColumns(columns, m, sort.dir) : columns;
  }, [columns, sort]);

  const metricSet = matchingMetricSet(metrics);
  const metricsLabel = metricSet ? metricSet.label : `${metrics.length} selected`;
  const draftSummary = (() => {
    if (!draft) return null;
    const ids = Array.from(new Set(draft.entries.map((e) => e.dealId)));
    const names = ids.map((id) => {
      const d = deals.find((x) => x.id === id);
      return d ? (d.title || d.address || '').trim() : '';
    }).filter(Boolean);
    const cols = `${draft.entries.length} ${draft.entries.length === 1 ? 'column' : 'columns'}`;
    if (names.length === 0) return `${cols}, ${ids.length} ${ids.length === 1 ? 'property' : 'properties'}`;
    const label = names.length === 1 ? names[0] : `${names[0]} +${names.length - 1} more`;
    return `${label} (${cols})`;
  })();
  const showStarter = columns.length === 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <ConnectedHeader active="compare" deals={deals} onDealsChanged={() => { void loadDeals(); }} />

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Compare</h1>
            <p className="text-xs text-slate-400 mt-0.5">Underwrite prospective deals side by side, or compare the properties you own.</p>
          </div>
        </div>

        {showStarter ? (
          loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
              <p className="text-xs font-bold text-slate-300">Loading your properties…</p>
            </div>
          ) : inquiryOpen ? (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setInquiryOpen(false)}
                  className="text-xs font-bold text-slate-400 hover:text-white flex items-center space-x-1.5 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Comparison Starters</span>
                </button>
              </div>

              <InquiryCommandBar
                deals={deals}
                activeDeal={selectedInquiryDeal}
                activeQuestionId={activeQuestionId}
                isCustomMode={isCustomConfigMode}
                questions={getGuidedQuestionsWithProfile(profile.comparisonAssumptions)}
                onSelectDeal={setInquiryDealId}
                onSelectQuestion={(qId) => {
                  setActiveQuestionId(qId);
                  setIsCustomConfigMode(false);
                }}
                onToggleCustomMode={setIsCustomConfigMode}
                onExecuteCustom={(cfg) => setCustomInquiryConfig(cfg)}
              />

              {inquiryResult && (
                <div className="space-y-4">
                  <ComparativeStoryCard
                    story={inquiryResult.story}
                    onPromoteToBoard={handlePromoteInquiryToBoard}
                    isPromoted={isCurrentInquiryPromoted}
                  />
                  <InquiryVisualizer inquiryResult={inquiryResult} />
                </div>
              )}
            </div>
          ) : (
            <>
              {infoNotes.length > 0 && (
                <div className="rounded-2xl border border-cyan-900/60 bg-cyan-950/20 px-4 py-3 text-xs text-slate-300 space-y-1">
                  {infoNotes.map((t, i) => <p key={i}>{t}</p>)}
                </div>
              )}
              <CompareStarter
                loading={loading}
                deals={deals}
                savedCount={saved.length}
                readyMadeCount={BUILT_IN_PRESETS.length}
                draftSummary={draftSummary}
                onPickDeals={() => setPanel('add')}
                onPickScenarioDeal={(d) => { void showScenarioSet(d); }}
                onOpenSaved={() => setPanel('saved')}
                onContinueDraft={() => { if (draft) void openConfig(draft, 'Last board'); }}
                onOpenInquiry={() => setInquiryOpen(true)}
              />
            </>
          )
        ) : (
          <>
            <BuilderStrip
              columnsCount={columns.length}
              metricsLabel={metricsLabel}
              filterCount={filterCount}
              chips={chips}
              onClearChip={(c) => setFilters(c.clear(filters))}
              onClearAllFilters={() => setFilters({ ...NO_FILTERS, text: filters.text })}
              shownDealCount={shownDeals.length}
              totalDealCount={deals.length}
              isPhone={isPhone}
              view={view}
              onViewChange={setView}
              phoneTable={phoneTable}
              onPhoneTableChange={setPhoneTable}
              savedName={activeSaved?.name ?? null}
              dirty={dirty}
              saveError={saveError}
              saveBusy={saveBusy}
              onOpenAdd={() => setPanel('add')}
              onOpenMetrics={() => setPanel('metrics')}
              onOpenFilters={() => { setFiltersReturnTo(null); setPanel('filters'); }}
              onOpenSaved={() => setPanel('saved')}
              onOpenInquiry={() => setInquiryOpen((v) => !v)}
              inquiryActive={inquiryOpen}
              onSaveNew={(name) => { void handleSaveNew(name); }}
              onUpdateSaved={() => { void handleUpdateSaved(); }}
              onExportCsv={() => exportComparisonCSV(displayColumns, metrics)}
              onCopyLink={() => { void handleCopyLink(); }}
              onClearBoard={handleClearBoard}
            />

            {inquiryOpen && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <InquiryCommandBar
                  deals={deals}
                  activeDeal={selectedInquiryDeal}
                  activeQuestionId={activeQuestionId}
                  isCustomMode={isCustomConfigMode}
                  onSelectDeal={setInquiryDealId}
                  onSelectQuestion={(qId) => {
                    setActiveQuestionId(qId);
                    setIsCustomConfigMode(false);
                  }}
                  onToggleCustomMode={setIsCustomConfigMode}
                  onExecuteCustom={(cfg) => setCustomInquiryConfig(cfg)}
                />

                {inquiryResult && (
                  <div className="space-y-4">
                    <ComparativeStoryCard
                      story={inquiryResult.story}
                      onPromoteToBoard={handlePromoteInquiryToBoard}
                      isPromoted={isCurrentInquiryPromoted}
                    />
                    <InquiryVisualizer inquiryResult={inquiryResult} />
                  </div>
                )}
              </div>
            )}

            {focusDeal && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
                <span>
                  {baselineInfo
                    ? `Acquisition baseline recorded ${new Date(baselineInfo.capturedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}. Projections changed since? Update it.`
                    : 'No acquisition baseline is recorded for this property yet.'}
                </span>
                <button type="button" onClick={() => { setBaselineError(null); setIsBaselineModalOpen(true); }} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold transition">
                  {baselineInfo ? 'Update baseline…' : 'Record baseline…'}
                </button>
              </div>
            )}

            {(mergeNotes.length > 0 || infoNotes.length > 0) && (
              <div className="rounded-2xl border border-cyan-900/60 bg-cyan-950/20 px-4 py-3 text-xs text-slate-300 space-y-1">
                {infoNotes.map((t, i) => <p key={`i${i}`}>{t}</p>)}
                {mergeNotes.map((n, i) => <p key={`m${i}`}>{describeMergedNote(n)}</p>)}
              </div>
            )}

            {isPhone ? (
              phoneTable ? (
                <CompareMatrixTable columns={displayColumns} winners={winners} metricKeys={metrics} sort={sort} onSort={handleSort} onRemoveColumn={handleRemoveColumn} onSetBenchmark={handleSetBenchmark} onOpenAdd={() => setPanel('add')} />
              ) : (
                <CompareCards columns={columns} metricKeys={metrics} onRemoveColumn={handleRemoveColumn} onSetBenchmark={handleSetBenchmark} />
              )
            ) : view === 'charts' ? (
              <CompareCharts columns={displayColumns} metricKeys={metrics} />
            ) : (
              <CompareMatrixTable columns={displayColumns} winners={winners} metricKeys={metrics} sort={sort} onSort={handleSort} onRemoveColumn={handleRemoveColumn} onSetBenchmark={handleSetBenchmark} onOpenAdd={() => setPanel('add')} />
            )}
          </>
        )}
      </main>

      {undo && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-40 flex items-center gap-3 rounded-2xl bg-slate-800 border border-slate-700 shadow-2xl px-4 py-3 text-xs text-slate-100 max-w-[92vw]" style={{ marginBottom: 'env(safe-area-inset-bottom)' }} role="status">
          <span className="truncate">{undo.message}</span>
          <button type="button" onClick={handleUndo} className="font-black text-emerald-400 hover:text-emerald-300 whitespace-nowrap">Undo</button>
        </div>
      )}

      <AddPanel
        open={panel === 'add'}
        onClose={() => setPanel(null)}
        allDeals={deals}
        shownDeals={shownDeals}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        onOpenFilters={() => { setFiltersReturnTo('add'); setPanel('filters'); }}
        filterCount={filterCount}
        onToggleScenario={(d, s, l, on) => { void handleToggleScenario(d, s, l, on); }}
        onAddWhatIf={handleAddWhatIf}
        onAddAll={handleAddAll}
      />
      <MetricsPanel open={panel === 'metrics'} onClose={() => setPanel(null)} selected={metrics} onChange={setMetrics} />
      <FiltersPanel
        open={panel === 'filters'}
        onClose={() => setPanel(filtersReturnTo)}
        deals={deals}
        filters={filters}
        onChange={setFilters}
        shownCount={shownDeals.length}
      />
      <SavedPanel
        open={panel === 'saved'}
        onClose={() => setPanel(null)}
        presets={presets}
        saved={saved}
        savedLoading={savedLoading}
        recents={recents}
        onOpenConfig={(c, l, id) => { void openConfig(c, l, id); }}
        onRename={(id, name) => { void handleRename(id, name); }}
        onDuplicate={(v) => { void handleDuplicate(v); }}
        onDelete={(v) => { void handleDelete(v); }}
      />

      {focusDeal && (
        <UpdateBaselineModal
          isOpen={isBaselineModalOpen}
          onClose={() => setIsBaselineModalOpen(false)}
          dealTitle={resolveDealDisplayName(focusDeal)}
          candidates={columns.filter((c) => c.dealId === focusDeal.id && c.scenarioType !== 'baseline' && c.scenarioType !== 'remodel')}
          baselineFingerprint={baselineInfo?.fingerprint ?? null}
          baselineCapturedAt={baselineInfo?.capturedAt ?? null}
          baselineIrr={baselineInfo?.irr ?? null}
          busy={baselineBusy}
          error={baselineError}
          onConfirm={(c) => { void handleConfirmBaseline(c); }}
        />
      )}
    </div>
  );
};

