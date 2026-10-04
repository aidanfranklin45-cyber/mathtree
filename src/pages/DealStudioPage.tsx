import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDealStore } from '../stores/useDealStore';
import { useComputedMetrics } from '../lib/engine/useComputedMetrics';
import { StudioNavbar } from '../components/studio/StudioNavbar';
import { OverviewTab } from '../components/studio/tabs/OverviewTab';
import { ProFormaTab } from '../components/studio/tabs/ProFormaTab';
import { PropertyTab } from '../components/studio/tabs/PropertyTab';
import { DebtTab } from '../components/studio/tabs/DebtTab';
import { DiligenceTab } from '../components/studio/tabs/DiligenceTab';
import { SensitivityTab } from '../components/studio/tabs/SensitivityTab';
import { PerformanceTab } from '../components/studio/tabs/PerformanceTab';
import { OperateTab } from '../components/studio/tabs/OperateTab';
import { getStageLens, resolveTab } from '../lib/studio/stageLens';
import { EditInputsModal } from '../components/studio/modals/EditInputsModal';
import { ParameterHistoryModal } from '../components/studio/modals/ParameterHistoryModal';
import { DealAuditorBanner } from '../components/studio/DealAuditorBanner';
import { ScenarioSummaryCard } from '../components/studio/ScenarioSummaryCard';
import { RemodelModal } from '../components/studio/modals/RemodelModal';
import { ShareDealModal } from '../components/collaboration/ShareDealModal';
import { listScenarioRuns, recordScenarioRun, withComputedDiffs, type ScenarioRun } from '../lib/scenarios';
import { DealInputs, DealRecord } from '../lib/math/types';
import { ensureBaseline } from '../lib/baselines/db';
import { Loader2 } from 'lucide-react';

export const DealStudioPage: React.FC = () => {
  const {
    deal,
    loading: dealLoading,
    error: dealError,
    activeTab,
    isEditModalOpen,
    setActiveTab,
    setIsEditModalOpen,
    updateInputs,
    saveDeal,
    patchDeal,
    loadDeal,
  } = useDealStore();

  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isRemodelOpen, setIsRemodelOpen] = useState(false);
  const [rawRuns, setRawRuns] = useState<ScenarioRun[]>([]);
  const [runsVersion, setRunsVersion] = useState(0);

  // All financial math is derived on the fly from the deal's inputs; nothing is stored or fetched.
  const { metrics, error: engineError } = useComputedMetrics(deal);

  // JIT 30-Day GIS Cache check: evaluates cache freshness once per active session per day
  React.useEffect(() => {
    if (deal) {
      import('../lib/services/gisSyncService').then(({ syncDealCountyGisInBackground }) => {
        syncDealCountyGisInBackground(deal);
      });
    }
  }, [deal?.id]);

  // Parameter runs store inputs only; diffs and return impacts are recomputed from them by the engine
  React.useEffect(() => {
    if (!deal?.id) return;
    let live = true;
    listScenarioRuns(deal.id, 5).then((r) => { if (live) setRawRuns(r); }).catch(() => { if (live) setRawRuns([]); });
    return () => { live = false; };
  }, [deal?.id, runsVersion, isHistoryModalOpen]);

  const runs = React.useMemo(() => (deal ? withComputedDiffs(deal, rawRuns) : []), [deal, rawRuns]);

  /** Persist the deal, then log a scenario run if a tracked parameter actually changed. */
  const saveAndRecord = async (): Promise<boolean> => {
    const ok = await saveDeal();
    if (ok && deal) {
      await recordScenarioRun(deal);
      setRunsVersion((v) => v + 1);
    }
    return ok;
  };

  /** Property-tab edits (price, linked parcel ...) persist immediately and are logged as runs too. */
  const patchAndRecord: typeof patchDeal = async (inputsPatch, top) => {
    const ok = await patchDeal(inputsPatch, top);
    if (ok && deal) {
      const next = { ...deal, ...top, inputs: { ...deal.inputs, ...inputsPatch } } as DealRecord;
      await recordScenarioRun(next);
      if (next.status === 'owned') void ensureBaseline(next);
      setRunsVersion((v) => v + 1);
    }
    return ok;
  };

  const handleRestoreInputs = async (restoredInputs: DealInputs) => {
    updateInputs(restoredInputs);
    await saveDeal();
    setRunsVersion((v) => v + 1);
  };

  const isLoading = dealLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center p-4">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
        <h2 className="text-base font-black text-white">Opening Deal Studio...</h2>
        <p className="text-xs text-slate-400 mt-1">Loading deal</p>
      </div>
    );
  }

  if (dealError || !deal || !metrics) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center p-4">
        <div className="p-6 max-w-md bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <h2 className="text-base font-black text-rose-400">Failed to load deal</h2>
          <p className="text-xs text-slate-400">{dealError || engineError || 'No active deal found.'}</p>
          <Link
            to="/"
            className="inline-block px-4 py-2 rounded-xl bg-emerald-600 text-slate-950 text-xs font-bold"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // The stage decides which tabs exist and which one opens first; a stored or linked tab this stage does not show falls back to its default
  const lens = getStageLens(deal);
  const tab = resolveTab(lens, activeTab);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative">
      <StudioNavbar
        deal={deal}
        metrics={metrics}
        lens={lens}
        activeTab={tab}
        onSelectTab={setActiveTab}
        onOpenEditModal={() => setIsEditModalOpen(true)}
        onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
        onOpenShare={() => setIsShareOpen(true)}
        onOpenRemodel={() => setIsRemodelOpen(true)}
        scenarioCount={runs.length}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-20 md:pb-6 flex flex-col space-y-5">
        <ScenarioSummaryCard
          runs={runs}
          isOwned={deal.status === 'owned'}
          onOpenHistory={() => setIsHistoryModalOpen(true)}
          onRestore={handleRestoreInputs}
        />
        <DealAuditorBanner deal={deal} metrics={metrics} />

        {tab === 'performance' && <PerformanceTab deal={deal} metrics={metrics} />}
        {tab === 'operate' && <OperateTab deal={deal} />}
        {tab === 'overview' && <OverviewTab deal={deal} metrics={metrics} onSelectTab={setActiveTab} onOpenEdit={() => setIsEditModalOpen(true)} />}
        {tab === 'proforma' && <ProFormaTab deal={deal} metrics={metrics} onUpdateInputs={updateInputs} onReloadDeal={() => { void loadDeal(); }} />}
        {tab === 'property' && <PropertyTab deal={deal} metrics={metrics} onPatchDeal={patchAndRecord} />}
        {tab === 'debt' && <DebtTab deal={deal} metrics={metrics} onUpdateInputs={updateInputs} />}
        {tab === 'diligence' && <DiligenceTab deal={deal} metrics={metrics} onPatchDeal={patchAndRecord} />}
        {tab === 'sensitivity' && <SensitivityTab deal={deal} metrics={metrics} onUpdateInputs={updateInputs} />}
      </main>

      <EditInputsModal
        isOpen={isEditModalOpen}
        deal={deal}
        onClose={() => setIsEditModalOpen(false)}
        onSave={patchAndRecord}
      />

      <RemodelModal isOpen={isRemodelOpen} deal={deal} onClose={() => setIsRemodelOpen(false)} onSave={(patch) => patchDeal(patch)} />

      <ShareDealModal deal={isShareOpen ? deal : null} onClose={() => setIsShareOpen(false)} />

      <ParameterHistoryModal
        isOpen={isHistoryModalOpen}
        deal={deal}
        onClose={() => setIsHistoryModalOpen(false)}
        onRestore={handleRestoreInputs}
      />
    </div>
  );
};
