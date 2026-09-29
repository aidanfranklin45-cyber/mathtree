import React, { useState, useEffect } from 'react';
import { DealRecord, DealInputs } from '../../../lib/math/types';
import { fetchScenarioHistory, ScenarioRunRecord } from '../../../lib/supabase/edgeFunctions';
import {
  X,
  History,
  RotateCcw,
  TrendingUp,
  Loader2,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowRight,
  Layers,
} from 'lucide-react';

interface ParameterHistoryModalProps {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  onRestore: (inputs: DealInputs) => Promise<void>;
}

export const ParameterHistoryModal: React.FC<ParameterHistoryModalProps> = ({
  isOpen,
  deal,
  onClose,
  onRestore,
}) => {
  const [runs, setRuns] = useState<ScenarioRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<ScenarioRunRecord | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchScenarioHistory(deal.id)
      .then((data) => {
        setRuns(data);
        if (data.length > 0) setSelectedRun(data[0]);
      })
      .catch((err) => {
        console.error('Failed to load scenario history:', err);
      })
      .finally(() => setLoading(false));
  }, [isOpen, deal.id]);

  if (!isOpen) return null;

  const handleRestore = async () => {
    if (!selectedRun) return;
    setIsRestoring(true);
    try {
      await onRestore(selectedRun.inputs);
      onClose();
    } catch (err) {
      console.error('Restore error:', err);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">Underwriting Parameter History</h2>
              <p className="text-xs text-slate-400">
                Audit trail of input adjustments & scenario snapshots powered by Deno Edge Function
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="w-7 h-7 text-emerald-400 animate-spin mb-3" />
              <p className="text-xs text-slate-400">Loading parameter run history...</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex-1 p-12 text-center flex flex-col items-center justify-center space-y-3">
              <Clock className="w-10 h-10 text-slate-600" />
              <h3 className="text-sm font-black text-white">No Parameter Snapshots Found</h3>
              <p className="text-xs text-slate-400 max-w-sm">
                As you edit underwriting inputs in Deal Studio, snapshot versions and variance diffs will be
                automatically recorded here.
              </p>
            </div>
          ) : (
            <>
              {/* Left Column: Runs List */}
              <div className="w-full md:w-64 border-r border-slate-800/80 overflow-y-auto max-h-[500px] divide-y divide-slate-800/60">
                {runs.map((r) => {
                  const isSelected = selectedRun?.id === r.id;
                  const dateStr = new Date(r.created_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  });

                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedRun(r)}
                      className={`w-full text-left p-3.5 transition flex flex-col space-y-1 ${
                        isSelected
                          ? 'bg-emerald-500/10 border-l-2 border-emerald-500 text-white'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className={isSelected ? 'text-emerald-400' : 'text-slate-300'}>
                          Run #{r.run_number}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">{dateStr}</span>
                      </div>
                      <div className="text-[11px] font-mono">
                        Price: ${((r.inputs?.purchasePrice || 0) as number).toLocaleString()}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Column: Run Details & Diffs */}
              {selectedRun && (
                <div className="flex-1 p-5 overflow-y-auto space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-sm font-black text-white">Run #{selectedRun.run_number} Details</h4>
                      <p className="text-[11px] text-slate-400">
                        Recorded on {new Date(selectedRun.created_at).toLocaleString()}
                      </p>
                    </div>

                    <button
                      onClick={handleRestore}
                      disabled={isRestoring}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shadow-sm disabled:opacity-50"
                    >
                      {isRestoring ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      <span>Restore Snapshot</span>
                    </button>
                  </div>

                  {/* Input Variances */}
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Input Variances (vs. Previous Run)
                    </h5>
                    {selectedRun.diff_from_previous && selectedRun.diff_from_previous.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {selectedRun.diff_from_previous.map((diff, i) => (
                          <div
                            key={i}
                            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono flex items-center justify-between"
                          >
                            <span className="text-slate-400 font-sans">{diff.label}</span>
                            <div className="flex items-center space-x-1.5">
                              <span className="text-slate-500 line-through">
                                {diff.isCurrency ? `$${diff.oldValue?.toLocaleString()}` : `${diff.oldValue}${diff.suffix || ''}`}
                              </span>
                              <ArrowRight className="w-3 h-3 text-slate-500" />
                              <span className="text-emerald-400 font-bold">
                                {diff.isCurrency ? `$${diff.newValue?.toLocaleString()}` : `${diff.newValue}${diff.suffix || ''}`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No input changes detected from prior run.</p>
                    )}
                  </div>

                  {/* Selected Snapshot Inputs Summary */}
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Underwriting Parameters
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] uppercase font-sans text-slate-500">Purchase Price</div>
                        <div className="font-bold text-white">
                          ${((selectedRun.inputs.purchasePrice || 0) as number).toLocaleString()}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] uppercase font-sans text-slate-500">Down Payment</div>
                        <div className="font-bold text-white">{selectedRun.inputs.downPaymentPercent || 25}%</div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] uppercase font-sans text-slate-500">Interest Rate</div>
                        <div className="font-bold text-emerald-400">{selectedRun.inputs.interestRate || 6.5}%</div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] uppercase font-sans text-slate-500">Loan Term</div>
                        <div className="font-bold text-white">{selectedRun.inputs.loanTermYears || (selectedRun.inputs as any).loanTerm || 30} Yrs</div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] uppercase font-sans text-slate-500">Gross Rent / Mo</div>
                        <div className="font-bold text-emerald-300">
                          ${((selectedRun.inputs.monthlyRent || (selectedRun.inputs.grossRentAnnual ? selectedRun.inputs.grossRentAnnual / 12 : 0)) as number).toLocaleString()}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] uppercase font-sans text-slate-500">Vacancy Rate</div>
                        <div className="font-bold text-white">{selectedRun.inputs.vacancyRatePercent || (selectedRun.inputs as any).vacancyRate || 5}%</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
