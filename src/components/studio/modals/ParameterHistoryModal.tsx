import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DealRecord, DealInputs, DealMetrics } from '../../../lib/math/types';
import {
  deleteScenarioRun, diffInputs, listScenarioRuns, recordScenarioRun, withComputedDiffs,
  type DiffItem, type ScenarioRun, type ScenarioRunView,
} from '../../../lib/scenarios';
import { computeDealMetrics } from '../../../lib/engine/compute';

interface Props {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  onRestore: (inputs: DealInputs) => Promise<void>;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Parameter + KPI summary of one scenario, all derived from its inputs by the engine (nothing stored). */
function summarize(inputs: Record<string, any>, m: DealMetrics | null) {
  const n = (v: unknown): number | null => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
  const purchasePrice = Number(inputs.purchasePrice || 0);
  const downPaymentPct = Number(inputs.downPaymentPercent != null ? inputs.downPaymentPercent : 20);
  const p0: any = m?.projections?.[0];
  const firstFull: any = p0 && Number(p0.operatingMonths) < 12 && m?.projections?.[1] ? m.projections[1] : p0;
  const grossRentAnnual = Number(inputs.grossRentAnnual || (inputs.monthlyRent ? inputs.monthlyRent * 12 : 0));
  return {
    purchasePrice,
    downPaymentPct,
    loanAmount: n((m as any)?.loanAmount) ?? purchasePrice * (1 - downPaymentPct / 100),
    interestRate: Number(inputs.interestRate || 0),
    loanTerm: Number(inputs.loanTerm || 30),
    monthlyDebt: n((m as any)?.monthlyMortgagePayment) ?? (firstFull?.debtService ? Number(firstFull.debtService) / 12 : null),
    rehabCosts: Number(inputs.rehabBudget || inputs.rehabCosts || 0),
    grossRentAnnual,
    grossRentMonthly: grossRentAnnual > 0 ? grossRentAnnual / 12 : Number(inputs.monthlyRent || 0),
    vacancyRate: Number(inputs.vacancyRate != null ? inputs.vacancyRate : 5),
    noi: n((m as any)?.noi) ?? n(firstFull?.netOperatingIncome),
    dscr: n((m as any)?.dscr) ?? n(firstFull?.dscr),
    cashFlow: n((m as any)?.year1Cashflow) ?? n(firstFull?.cashFlow),
    capRate: n((m as any)?.capRate),
    exitCapRate: n(inputs.targetCapRate ?? inputs.targetExitCapRate ?? inputs.exitCapRate),
    cashOnCash: n((m as any)?.cashOnCash),
    irr: n((m as any)?.irr),
    equityMultiple: n((m as any)?.equityMultiplier),
  };
}
type Summary = ReturnType<typeof summarize>;

interface Row { label: string; get: (s: Summary) => number | null; isCurrency?: boolean; isPct?: boolean; suffix?: string; isLowerBetter?: boolean; isHighlight?: boolean }
const GROUPS: { category: string; rows: Row[] }[] = [
  {
    category: 'FINANCING & CAPITAL STACK',
    rows: [
      { label: 'Purchase Basis', get: (s) => s.purchasePrice, isCurrency: true, isLowerBetter: true },
      { label: 'Down Payment %', get: (s) => s.downPaymentPct, isPct: true },
      { label: 'Senior Loan Amount', get: (s) => s.loanAmount, isCurrency: true },
      { label: 'Interest Rate %', get: (s) => s.interestRate, isPct: true, isLowerBetter: true },
      { label: 'Loan Term (Yrs)', get: (s) => s.loanTerm },
      { label: 'Monthly Debt Service', get: (s) => s.monthlyDebt, isCurrency: true, suffix: '/mo', isLowerBetter: true },
      { label: 'Rehab / CapEx Budget', get: (s) => s.rehabCosts, isCurrency: true, isLowerBetter: true },
    ],
  },
  {
    category: 'PROPERTY OPERATIONS & CASH FLOW',
    rows: [
      { label: 'Gross Annual Rent', get: (s) => s.grossRentAnnual, isCurrency: true, suffix: '/yr', isHighlight: true },
      { label: 'Gross Monthly Rent', get: (s) => s.grossRentMonthly, isCurrency: true, suffix: '/mo' },
      { label: 'Vacancy Rate %', get: (s) => s.vacancyRate, isPct: true, isLowerBetter: true },
      { label: 'Net Operating Income (NOI)', get: (s) => s.noi, isCurrency: true, suffix: '/yr', isHighlight: true },
      { label: 'Senior DSCR', get: (s) => s.dscr, suffix: 'x', isHighlight: true },
      { label: 'Year 1 Net Cash Flow', get: (s) => s.cashFlow, isCurrency: true, suffix: '/yr', isHighlight: true },
    ],
  },
  {
    category: 'RETURN & PERFORMANCE METRICS',
    rows: [
      { label: 'In-Place Cap Rate %', get: (s) => s.capRate, isPct: true, isHighlight: true },
      { label: 'Exit Cap Rate %', get: (s) => s.exitCapRate, isPct: true },
      { label: 'Cash-on-Cash Return %', get: (s) => s.cashOnCash, isPct: true, isHighlight: true },
      { label: 'Target IRR %', get: (s) => s.irr, isPct: true, isHighlight: true },
      { label: 'Equity Multiple', get: (s) => s.equityMultiple, suffix: 'x', isHighlight: true },
    ],
  },
];

const valid = (v: number | null | undefined): v is number => v !== null && v !== undefined && !isNaN(v);
const differs = (v: number | null, live: number | null) => valid(v) && valid(live) && Math.abs(v - live) >= 0.001;

function formatVal(v: number | null, r: Row): React.ReactNode {
  if (!valid(v)) return <span className="text-slate-600">—</span>;
  if (r.isCurrency) return `${usd(v)}${r.suffix || ''}`;
  if (r.isPct) return `${v.toFixed(2)}%`;
  if (r.suffix) return `${v.toFixed(2)}${r.suffix}`;
  return String(v);
}

function VarianceBadge({ val, live, r }: { val: number | null; live: number | null; r: Row }) {
  if (!valid(val) || !valid(live)) return null;
  const diff = val - live;
  if (Math.abs(diff) < 0.001) return null;
  let better: boolean | null = null;
  if (r.isHighlight) better = diff > 0;
  else if (r.isLowerBetter) better = diff < 0;
  const color = better === true ? 'text-emerald-400 font-bold' : better === false ? 'text-rose-400 font-bold' : 'text-slate-400';
  const sign = diff > 0 ? '+' : '';
  const text = r.isCurrency ? `${diff > 0 ? '+$' : '-$'}${Math.abs(Math.round(diff)).toLocaleString()}`
    : r.isPct ? `${sign}${diff.toFixed(2)}%`
    : r.suffix ? `${sign}${diff.toFixed(2)}${r.suffix}`
    : `${sign}${diff.toFixed(1)}`;
  return <span className={`ml-1.5 text-[10px] ${color} bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800`}>({text})</span>;
}

const inputChip = (d: DiffItem) => {
  let val = String(d.newValue ?? '');
  let delta = '';
  if (d.isCurrency) {
    if (d.delta != null) delta = `${d.delta > 0 ? '+$' : '-$'}${Math.abs(Math.round(d.delta)).toLocaleString()}`;
    val = `$${Number(d.newValue || 0).toLocaleString()}`;
  } else if (d.isPct) {
    if (d.delta != null) delta = `${d.delta > 0 ? '+' : ''}${d.delta.toFixed(2)}%`;
    val = `${Number(d.newValue || 0).toFixed(2)}%`;
  } else {
    if (d.delta != null) delta = `${d.delta > 0 ? '+' : ''}${d.delta}${d.suffix || ''}`;
    val = `${val}${d.suffix || ''}`;
  }
  return (
    <span key={d.key} className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700/80 text-[11px] font-mono text-slate-200">
      <span className="text-slate-400">{d.label}:</span>
      <span className="font-bold text-white">{val}</span>
      {delta && <span className="text-cyan-400 font-semibold text-[10px]">({delta})</span>}
    </span>
  );
};

const metricChip = (d: DiffItem) => {
  const delta = d.delta ?? 0;
  const color = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-300';
  let text = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
  if (d.isPct) text += '% pts';
  else if (d.isCurrency) text = `${delta > 0 ? '+$' : '-$'}${Math.abs(Math.round(delta)).toLocaleString()}/yr`;
  else text += d.suffix || 'x';
  return (
    <span key={d.key} className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700/80 text-[11px] font-mono">
      <span className="text-slate-400">Δ {d.label}:</span>
      <span className={`font-bold ${color}`}>{text}</span>
    </span>
  );
};

const catBadge = (c?: string | null) => {
  if (c === 'financing') return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">Debt & Financing</span>;
  if (c === 'valuation') return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Valuation & Pricing</span>;
  if (c === 'operations') return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">Operations</span>;
  return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Full Underwriting</span>;
};

/**
 * Parameter History & Scenario Engine (legacy layout). Each run stores only its inputs; parameter changes,
 * return impacts and the side-by-side matrix are recomputed here by the engine on every open.
 */
export const ParameterHistoryModal: React.FC<Props> = ({ isOpen, deal, onClose, onRestore }) => {
  const [rawRuns, setRawRuns] = useState<ScenarioRun[]>([]);
  const [tab, setTab] = useState<'timeline' | 'diff'>('timeline');
  const [diffOnly, setDiffOnly] = useState(false);
  const [selA, setSelA] = useState('');
  const [selB, setSelB] = useState('');
  const [snapOpen, setSnapOpen] = useState(false);
  const [snap, setSnap] = useState({ name: '', category: 'financing', notes: '', baseline: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => setRawRuns(await listScenarioRuns(deal.id, 25)), [deal.id]);
  useEffect(() => { if (isOpen) { setToast(null); setTab('timeline'); void load(); } }, [isOpen, load]);

  const runs: ScenarioRunView[] = useMemo(() => withComputedDiffs(deal, rawRuns), [deal, rawRuns]);
  const liveMetrics = useMemo(() => { try { return computeDealMetrics(deal); } catch { return null; } }, [deal]);
  const liveSummary = useMemo(() => summarize(deal.inputs as any, liveMetrics), [deal.inputs, liveMetrics]);

  const isActive = (r: ScenarioRunView) => diffInputs(r.inputs, deal.inputs).length === 0;
  const variationRuns = runs.filter((r) => !isActive(r));
  const runA = variationRuns.find((r) => r.id === selA) || variationRuns[0] || null;
  const runB = selB ? variationRuns.find((r) => r.id === selB) || null : null;
  const hasA = !!runA;
  const hasB = !!(runB && runB.id !== runA?.id);
  const sumA = runA ? summarize(runA.inputs as any, runA.metrics) : null;
  const sumB = runB ? summarize(runB.inputs as any, runB.metrics) : null;

  if (!isOpen) return null;

  const dateStr = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const apply = async (r: ScenarioRunView) => {
    setBusy(r.id);
    try {
      await onRestore(r.inputs);
      setToast(`Active scenario switched to "${r.name}". Baseline inputs and returns updated.`);
      await load();
    } finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this scenario?')) return;
    await deleteScenarioRun(id);
    await load();
  };

  const saveSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snap.name.trim()) return;
    setBusy('snap');
    const res = await recordScenarioRun(deal, { name: snap.name.trim(), notes: snap.notes.trim() || undefined, category: snap.category, baseline: snap.baseline, force: true });
    setBusy(null);
    if (res === 'error') { window.alert('Failed to save snapshot.'); return; }
    setSnapOpen(false);
    setSnap({ name: '', category: 'financing', notes: '', baseline: false });
    await load();
    window.alert(`Scenario snapshot saved: "${snap.name.trim()}"`);
  };

  const colSpan = 2 + (hasA ? 1 : 0) + (hasB ? 1 : 0);
  let rendered = 0;

  const matrixBody = GROUPS.map((g) => {
    const rows = g.rows.filter((r) => {
      const live = r.get(liveSummary); const a = sumA ? r.get(sumA) : null; const b = sumB ? r.get(sumB) : null;
      const allEmpty = !valid(live) && (!hasA || !valid(a)) && (!hasB || !valid(b));
      if (allEmpty) return false;
      if (diffOnly) return (hasA && differs(a, live)) || (hasB && differs(b, live));
      return true;
    });
    if (rows.length === 0) return null;
    return (
      <React.Fragment key={g.category}>
        <tr className="bg-slate-950/90 border-t border-b border-slate-800/80">
          <td colSpan={colSpan} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-sans">{g.category}</td>
        </tr>
        {rows.map((r) => {
          rendered++;
          const live = r.get(liveSummary); const a = sumA ? r.get(sumA) : null; const b = sumB ? r.get(sumB) : null;
          const anyDiff = (hasA && differs(a, live)) || (hasB && differs(b, live));
          return (
            <tr key={r.label} className={`hover:bg-slate-800/30 transition ${anyDiff ? 'bg-slate-900/30' : ''}`}>
              <td className="py-2.5 px-3 font-semibold text-slate-300 font-sans text-xs">{r.label}</td>
              <td className="py-2.5 px-3 font-bold text-white bg-slate-900/60">{formatVal(live, r)}</td>
              {hasA && <td className="py-2.5 px-3 font-medium text-emerald-300">{formatVal(a, r)} <VarianceBadge val={a} live={live} r={r} /></td>}
              {hasB && <td className="py-2.5 px-3 font-medium text-cyan-300">{formatVal(b, r)} <VarianceBadge val={b} live={live} r={r} /></td>}
            </tr>
          );
        })}
      </React.Fragment>
    );
  });

  return (
    <>
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-4 sm:p-6 space-y-5 shadow-2xl my-2 sm:my-6 max-h-[94vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20 font-black text-lg shrink-0">⚡</div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-base font-extrabold text-white">Parameter History &amp; Scenario Engine</h3>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded">{deal.title || 'Deal Scenarios'}</span>
                </div>
                <p className="text-xs text-slate-400">Track, compare, and revert alternative financing structures and prospective underwriting runs</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg text-lg">✕</button>
          </div>

          {toast && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-500/40 rounded-2xl text-xs text-emerald-200 font-bold flex items-center justify-between shadow-xl">
              <span>{toast}</span>
              <button type="button" onClick={() => setToast(null)} className="text-emerald-400 hover:text-white">✕</button>
            </div>
          )}

          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <button type="button" onClick={() => setTab('timeline')}
                className={`px-3.5 py-1.5 rounded-xl text-xs transition ${tab === 'timeline' ? 'font-bold bg-emerald-600 text-white shadow-sm' : 'font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800'}`}>
                Saved Scenarios ({runs.length})
              </button>
              <button type="button" onClick={() => setTab('diff')}
                className={`px-3.5 py-1.5 rounded-xl text-xs transition ${tab === 'diff' ? 'font-bold bg-emerald-600 text-white shadow-sm' : 'font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800'}`}>
                Side-by-Side Diff Matrix
              </button>
            </div>
            <button type="button" onClick={() => setSnapOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-400 bg-emerald-950/40 hover:bg-emerald-950/70 border border-emerald-900/50 transition flex items-center space-x-1">
              <span>+ Snapshot Current Model</span>
            </button>
          </div>

          {tab === 'timeline' && (
            <div className="space-y-3">
              <div className="space-y-3 max-h-[58vh] overflow-y-auto pr-1">
                {runs.length === 0 ? (
                  <div className="text-center py-10 bg-slate-950/50 rounded-2xl border border-slate-800 space-y-3">
                    <h4 className="text-sm font-bold text-slate-300">No Parameter Snapshots Recorded</h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">Capture debt structures, interest rate variations, and pro-forma models to compare side-by-side or restore at any time.</p>
                    <button type="button" onClick={() => setSnapOpen(true)} className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 hover:bg-emerald-900/50 transition">+ Snapshot Current Model</button>
                  </div>
                ) : runs.map((s) => {
                  const active = isActive(s);
                  const m: any = s.metrics;
                  const inp: any = s.inputs || {};
                  const hasDiff = s.inputDiff.length > 0 || s.metricDiff.length > 0;
                  return (
                    <div key={s.id} className={`bg-slate-950/80 border ${active ? 'border-emerald-500/60 bg-emerald-950/10' : 'border-slate-800'} rounded-2xl p-4 space-y-3.5 hover:border-slate-700 transition shadow-sm`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <h4 className="text-sm font-bold text-white">{s.name}</h4>
                            {catBadge(s.category)}
                            {s.is_baseline && <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Primary Baseline</span>}
                          </div>
                          <div className="flex items-center space-x-3 text-[11px] text-slate-400 font-mono">
                            <span>Saved: {dateStr(s.created_at)}</span><span>•</span><span>Run #{s.runNumber}</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => remove(s.id)} className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition shrink-0" title="Delete snapshot">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>

                      {s.notes && <p className="text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80 italic font-sans">{s.notes}</p>}

                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs font-mono pt-1">
                        {[
                          ['Basis', inp.purchasePrice ? `$${Number(inp.purchasePrice).toLocaleString()}` : 'N/A', 'text-white'],
                          ['Down Pay', inp.downPaymentPercent != null ? `${inp.downPaymentPercent}%` : 'N/A', 'text-cyan-400'],
                          ['Interest', inp.interestRate != null ? `${inp.interestRate}%` : 'N/A', 'text-amber-400'],
                          ['Amort', inp.loanTerm != null ? `${inp.loanTerm} yrs` : 'N/A', 'text-slate-300'],
                          ['Target IRR', m?.irr != null ? `${m.irr}%` : 'N/A', 'text-emerald-400'],
                          ['CoC Return', m?.cashOnCash != null ? `${m.cashOnCash}%` : 'N/A', 'text-emerald-400'],
                        ].map(([lab, val, cls]) => (
                          <div key={lab} className="bg-slate-900 p-2 rounded-xl border border-slate-800">
                            <span className="block text-[9px] uppercase font-bold text-slate-500">{lab}</span>
                            <span className={`${cls} font-bold`}>{val}</span>
                          </div>
                        ))}
                      </div>

                      {hasDiff && (
                        <div className="bg-slate-900/50 p-2.5 rounded-xl border border-slate-800/70 space-y-1.5">
                          <span className="block text-[10px] uppercase font-bold text-slate-400">Variances vs Previous Run:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {s.inputDiff.map(inputChip)}
                            {s.metricDiff.map(metricChip)}
                          </div>
                        </div>
                      )}

                      <div className="border-t border-slate-800/80 pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          {active
                            ? <span className="px-2.5 py-1 rounded-xl text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center space-x-1.5 shadow-sm"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span>Active Underwriting Scenario</span></span>
                            : <span className="text-[11px] text-slate-500 font-mono italic">Alternate Underwriting Scenario</span>}
                        </div>
                        <div>
                          {active
                            ? <button type="button" disabled className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 opacity-90 cursor-default flex items-center justify-center space-x-1.5"><span>✓ Currently Active</span></button>
                            : <button type="button" onClick={() => apply(s)} disabled={busy === s.id} title="Put this scenario on the front burner and load parameters into live underwriting"
                                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-black text-slate-950 bg-emerald-400 hover:bg-emerald-300 shadow-md shadow-emerald-500/20 transition flex items-center justify-center space-x-1.5 disabled:opacity-60">
                                <span>{busy === s.id ? 'Applying…' : 'Set as Active Underwriting Scenario'}</span>
                              </button>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'diff' && (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 p-3 rounded-2xl border border-slate-800 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-400 font-bold">Compare Live With:</span>
                  <select value={runA?.id || ''} onChange={(e) => setSelA(e.target.value)} className="bg-slate-900 border border-slate-700 text-emerald-300 rounded-lg px-2.5 py-1 text-xs font-bold focus:outline-none focus:border-emerald-500">
                    {variationRuns.length === 0 && <option value="">No variations</option>}
                    {variationRuns.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <span className="text-slate-500 font-bold">and:</span>
                  <select value={selB} onChange={(e) => setSelB(e.target.value)} className="bg-slate-900 border border-slate-700 text-cyan-300 rounded-lg px-2.5 py-1 text-xs font-bold focus:outline-none focus:border-cyan-500">
                    <option value="">(None - Compare Single Run)</option>
                    {variationRuns.filter((r) => r.id !== runA?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <button type="button" onClick={() => setDiffOnly((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition flex items-center space-x-1.5 cursor-pointer ${diffOnly ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm' : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'}`}>
                    <span>{diffOnly ? 'Showing Changes Only' : 'Show Changes Only'}</span>
                  </button>
                  <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">• Live Underwriting vs Saved Runs</span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/90 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-bold uppercase text-[10px] w-2/5">Underwriting Parameter / KPI</th>
                      <th className="py-2.5 px-3 font-bold text-white bg-slate-900/80">Active Live Model</th>
                      {hasA && <th className="py-2.5 px-3 font-bold text-emerald-400">{runA!.name}</th>}
                      {hasB && <th className="py-2.5 px-3 font-bold text-cyan-400">{runB!.name}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/40 text-slate-300">
                    {!hasA && !hasB ? (
                      <tr><td colSpan={2} className="py-8 text-center text-slate-500 font-sans text-xs">All saved scenarios match the Active Live Model. Adjust underwriting inputs to test parameter variations.</td></tr>
                    ) : (
                      <>
                        {matrixBody}
                        {rendered === 0 && (
                          <tr><td colSpan={colSpan} className="py-8 text-center text-slate-500 font-sans text-xs">
                            {diffOnly ? 'No parameter differences between selected variation and active model.' : 'No scenario data available to compare.'}
                          </td></tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {snapOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <span className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-sm">📸</span>
                <div>
                  <h4 className="text-sm font-extrabold text-white">Save Parameter Snapshot</h4>
                  <p className="text-[11px] text-slate-400">Record current financing and model assumptions</p>
                </div>
              </div>
              <button type="button" onClick={() => setSnapOpen(false)} className="text-slate-500 hover:text-white text-base">✕</button>
            </div>
            <form onSubmit={saveSnapshot} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">Scenario Label / Title *</label>
                <input type="text" required autoFocus value={snap.name} onChange={(e) => setSnap({ ...snap, name: e.target.value })} placeholder="e.g. Bank Mini-Perm 7.25% 5-Yr or Value-Add 80% LTC"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1">Scenario Category</label>
                <select value={snap.category} onChange={(e) => setSnap({ ...snap, category: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
                  <option value="financing">Financing &amp; Debt Structure (LTV, Rate, Amort)</option>
                  <option value="valuation">Acquisition &amp; Valuation (Purchase Basis, Cap Rates)</option>
                  <option value="operations">Operating Assumptions (Rent Roll, OpEx, Vacancy)</option>
                  <option value="full_scenario">Full Deal Scenario (Comprehensive Underwriting)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1">Underwriter Notes (Optional)</label>
                <textarea rows={2} value={snap.notes} onChange={(e) => setSnap({ ...snap, notes: e.target.value })} placeholder="e.g. Quote from First Interstate Bank, 30-yr amort, 1.25x DSCR covenant"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <input type="checkbox" id="snapshot-input-baseline" checked={snap.baseline} onChange={(e) => setSnap({ ...snap, baseline: e.target.checked })} className="rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-0" />
                <label htmlFor="snapshot-input-baseline" className="text-slate-300 font-medium">Designate as Primary Baseline Scenario</label>
              </div>
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button type="button" onClick={() => setSnapOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-950 border border-slate-800 transition">Cancel</button>
                <button type="submit" disabled={busy === 'snap'} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 shadow-md shadow-emerald-500/20 transition disabled:opacity-60">{busy === 'snap' ? 'Saving...' : 'Save Snapshot'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
