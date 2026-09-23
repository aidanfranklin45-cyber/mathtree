import React from 'react';
import { Link } from 'react-router-dom';
import { useDealStore } from '../stores/useDealStore';
import { useDealProjections } from '../lib/supabase/useDealProjections';
import { StudioNavbar } from '../components/studio/StudioNavbar';
import { OverviewTab } from '../components/studio/tabs/OverviewTab';
import { ProFormaTab } from '../components/studio/tabs/ProFormaTab';
import { PropertyTab } from '../components/studio/tabs/PropertyTab';
import { DebtTab } from '../components/studio/tabs/DebtTab';
import { DiligenceTab } from '../components/studio/tabs/DiligenceTab';
import { SensitivityTab } from '../components/studio/tabs/SensitivityTab';
import { TaxTab } from '../components/studio/tabs/TaxTab';
import { EditInputsModal } from '../components/studio/modals/EditInputsModal';
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
  } = useDealStore();

  // All financial math lives here — driven by the Edge Function.
  const {
    metrics,
    tax,
    sensitivity,
    loading: projLoading,
    recalculate,
  } = useDealProjections(deal, {
    // Sensitivity matrix is computed lazily (only when the tab is active)
    computeSensitivity: activeTab === 'sensitivity',
  });

  const isLoading = dealLoading || (projLoading && !metrics);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center p-4">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
        <h2 className="text-base font-black text-white">Opening Deal Studio...</h2>
        <p className="text-xs text-slate-400 mt-1">Loading PostgreSQL deal models and pro-forma projections</p>
      </div>
    );
  }

  if (dealError || !deal || !metrics) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center p-4">
        <div className="p-6 max-w-md bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <h2 className="text-base font-black text-rose-400">Failed to load deal</h2>
          <p className="text-xs text-slate-400">{dealError || 'No active deal found.'}</p>
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative">
      {projLoading && (
        <div className="fixed top-0 left-0 right-0 h-0.5 bg-emerald-500/30 z-50 overflow-hidden">
          <div className="h-full bg-emerald-400 animate-pulse w-full transition-all duration-300" />
        </div>
      )}
      <StudioNavbar
        deal={deal}
        metrics={metrics}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenEditModal={() => setIsEditModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'overview' && <OverviewTab deal={deal} metrics={metrics} onSelectTab={setActiveTab} />}
        {activeTab === 'proforma' && <ProFormaTab deal={deal} metrics={metrics} />}
        {activeTab === 'property' && <PropertyTab deal={deal} metrics={metrics} />}
        {activeTab === 'debt' && <DebtTab deal={deal} metrics={metrics} />}
        {activeTab === 'diligence' && <DiligenceTab deal={deal} metrics={metrics} />}
        {activeTab === 'sensitivity' && (
          <SensitivityTab
            deal={deal}
            metrics={metrics}
            sensitivity={sensitivity}
            sensitivityLoading={projLoading}
          />
        )}
        {activeTab === 'tax' && tax && <TaxTab deal={deal} metrics={metrics} tax={tax} />}
        {activeTab === 'tax' && !tax && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        )}
      </main>

      <EditInputsModal
        isOpen={isEditModalOpen}
        deal={deal}
        onClose={() => setIsEditModalOpen(false)}
        onUpdateInputs={updateInputs}
        onSaveDeal={saveDeal}
      />
    </div>
  );
};
