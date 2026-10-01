import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DealRecord, DealMetrics, DealInputs } from '../../../lib/math/types';
import { calculateSensitivityMatrix, createMonteCarloRunner, seedFromText, DEFAULT_TENANT_DEFAULT, DEFAULT_TURNOVER, type MonteCarloResult } from '../../../lib/engine';
import { getExpiryDefaultsVersion, subscribeExpiryDefaults } from '../../../lib/engine/expiryDefaults';

import { prepareEngineInputs } from '../../../lib/engine/compute';
import { formatCurrency } from '../../../lib/format';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import { MonteCarloChart } from '../MonteCarloChart';
import { StochasticPrimerModal } from '../StochasticPrimerModal';
import { DownPaymentSensitivityCard } from '../DownPaymentSensitivityCard';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
  onUpdateInputs?: (patch: Partial<DealInputs>) => void;
}

type RowParam = 'interestRate' | 'purchasePrice' | 'downPaymentPercent';
type ColParam = 'targetCapRate' | 'vacancyRate' | 'rentGrowth';

const ROW_LABELS: Record<RowParam, string> = { interestRate: 'Interest Rate', purchasePrice: 'Purchase Price', downPaymentPercent: 'Down Payment %' };
const COL_LABELS: Record<ColParam, string> = { targetCapRate: 'Exit Cap Rate', vacancyRate: 'Vacancy Rate', rentGrowth: 'Rent Growth' };

const statCard = 'bg-slate-950/60 p-3 rounded-xl border border-slate-900';
const statLabel = 'text-[10px] font-bold text-slate-500 uppercase';

function normalizeAsset(ac: string): string {
  const s = String(ac || 'commercial').toLowerCase();
  if (s.includes('multi')) return 'multi-unit';
  if (s.includes('single') || s.includes('resid')) return 'single-family';
  if (s.includes('storage')) return 'storage';
  return 'commercial';
}

export const SensitivityTab: React.FC<Props> = ({ deal, metrics, onUpdateInputs }) => {
  const [rowParam, setRowParam] = useState<RowParam>('interestRate');
  const [colParam, setColParam] = useState<ColParam>('targetCapRate');
  const [volRent, setVolRent] = useState(1.5);
  const [volVacancy, setVolVacancy] = useState(2.5);
  const [volCap, setVolCap] = useState(100);
  const [defProb, setDefProb] = useState<number>(DEFAULT_TENANT_DEFAULT.probabilityPct);
  const [defMonths, setDefMonths] = useState<number>(DEFAULT_TENANT_DEFAULT.downtimeMonths);
  // Residential turnover: industry-average starting points; the vacant days follow the deal's own vacancy setting unless chosen here
  const turnoverStart = DEFAULT_TURNOVER[normalizeAsset(String(deal.asset_class))];
  const [turnPct, setTurnPct] = useState<number>(turnoverStart?.annualPct ?? 45);
  const [turnDays, setTurnDays] = useState<number | null>(null);
  const [makeReady, setMakeReady] = useState<number>(turnoverStart?.makeReadyCost ?? 1500);
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [rerun, setRerun] = useState(0);
  const [primerOpen, setPrimerOpen] = useState(false);

  const asset = normalizeAsset(String(deal.asset_class));
  // Keyed by the deal's facts, not the object: a re-render that hands over an identical deal must not re-run the simulation
  const expiryVersion = useSyncExternalStore(subscribeExpiryDefaults, getExpiryDefaultsVersion);
  const dealKey = JSON.stringify([deal.inputs, deal.purchase_price, deal.asset_class]);
  const merged = useMemo(() => {
    const m: Record<string, any> = prepareEngineInputs(deal);
    if (!m.targetCapRate) m.targetCapRate = m.targetExitCapRate || m.exitCapRate || m.appreciationRate || 6.5;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealKey, expiryVersion]);

  // ---- 2D heatmap: ranges centered on the current inputs ----
  const grid = useMemo(() => {
    const rowRaw = parseFloat(merged[rowParam]);
    const rowBase = !isNaN(rowRaw) && rowRaw > 0 ? rowRaw : rowParam === 'purchasePrice' ? 300000 : 6;
    const colRaw = parseFloat(merged[colParam]);
    const colBase = !isNaN(colRaw) && colRaw > 0 ? colRaw : colParam === 'targetCapRate' ? 6.5 : 5;
    const rowValues: number[] = [];
    const colValues: number[] = [];
    for (let r = -2; r <= 2; r++) rowValues.push(rowParam === 'purchasePrice' ? Math.round(rowBase * (1 + r * 0.1)) : Math.max(0.5, Math.round((rowBase + r * 0.75) * 100) / 100));
    for (let c = -2; c <= 2; c++) colValues.push(Math.max(0.5, Math.round((colBase + c * 0.75) * 100) / 100));
    try {
      const res = calculateSensitivityMatrix(asset, merged, rowParam, rowValues, colParam, colValues);
      return { rowValues, colValues, matrix: (res?.matrix || []) as any[][] };
    } catch (e) {
      console.warn('[Sensitivity] matrix failed', e);
      return { rowValues, colValues, matrix: [] as any[][] };
    }
  }, [merged, asset, rowParam, colParam]);

  // ---- Monte Carlo: runs in the browser when this tab opens, in slices (about 0.2-0.4 s for 1,000 runs on lease-based deals) so the
  // page never freezes, and a run that is superseded by a newer input is cancelled ----
  const isZeroRent =
    (parseFloat(merged.grossRentAnnual) || 0) <= 0 && (parseFloat(merged.grossRentPerMonth) || 0) <= 0 && (parseFloat(merged.monthlyRent) || 0) <= 0 &&
    (!Array.isArray(merged.leases) || merged.leases.length === 0 || !merged.leases.some((l: any) => (parseFloat(l.monthlyRent) || 0) > 0));

  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    setRunning(true);
    const start = window.setTimeout(() => {
      try {
        // Seeded from the deal (plus the re-run count): the same deal shows the same chart until it changes or you re-run
        const runner = createMonteCarloRunner(asset, merged, {
          runs: 1000, rentGrowthVolPct: volRent, vacancyVolPct: volVacancy, exitCapSpreadBps: volCap,
          tenantDefaultProbPct: defProb, tenantDefaultDowntimeMonths: defMonths,
          turnoverPct: turnPct, turnoverDowntimeDays: turnDays ?? undefined, turnoverMakeReadyCost: makeReady, seed: seedFromText(`${dealKey}|${rerun}`),
        });
        const tick = () => {
          if (cancelled) return;
          try {
            runner.step(100);
            if (runner.completed < runner.total) {
              handle = window.setTimeout(tick, 0);
              return;
            }
            setMc(runner.finish());
          } catch (e) {
            console.warn('[Monte Carlo] failed', e);
          }
          setRunning(false);
        };
        tick();
      } catch (e) {
        console.warn('[Monte Carlo] failed', e);
        setRunning(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearTimeout(handle);
    };
  }, [merged, asset, volRent, volVacancy, volCap, defProb, defMonths, turnPct, turnDays, makeReady, rerun]);

  const dealName = resolveDealDisplayName(deal);
  const telem = mc?.telemetry;
  const p5 = mc?.p5Irr ?? 0;
  const probNeg = mc?.probNegativeCashFlow ?? 0;
  const skew = mc?.skewnessIndex ?? 0;

  let badgeCls = 'px-2 py-0.5 rounded text-[10px] font-bold bg-accent-violet/20 text-accent-violet border border-accent-violet/30';
  let badgeText = 'Core-Plus Risk Profile';
  if (mc) {
    if (p5 > 25 && probNeg === 0) { badgeCls = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'; badgeText = 'High-Yield Outperformer / Strong Downside Buffer'; }
    else if (p5 < 0) { badgeCls = 'px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30'; badgeText = 'High Tail Risk / Capital Call Exposure'; }
  }
  const skewText = skew < -0.05
    ? `Left-skewed tail (${skew.toFixed(2)}) reflects fixed debt obligations: operational headwinds compress thin equity yields faster than growth expands them.`
    : skew > 0.05
      ? `Right-skewed tail (${skew.toFixed(2)}) reflects asymmetric upside from favorable cap rate compression.`
      : `Symmetrically distributed around median (${(mc?.medianIrr ?? 0).toFixed(2)}%).`;

  const carry = (() => {
    const tax = parseFloat(merged.propertyTaxesAnnual) > 0 ? parseFloat(merged.propertyTaxesAnnual) : (parseFloat(merged.totalAssessedValue) || parseFloat(merged.initialPropertyValue || merged.purchasePrice) || 0) * 0.011;
    return tax + 600 + 600;
  })();

  const cellClass = (irr: number) =>
    irr >= 15 ? 'bg-emerald-950/80 text-emerald-300 font-extrabold border border-emerald-800/40'
    : irr >= 10 ? 'bg-brand-950/60 text-brand-300 font-bold border border-brand-800/30'
    : irr >= 5 ? 'bg-slate-900/80 text-slate-300'
    : 'bg-rose-950/50 text-rose-300 font-semibold border border-rose-900/30';

  return (
    <div className="space-y-6">
      {/* 2D heatmap */}
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-900 pb-3 gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-400" />
              <span>2D Sensitivity Matrix &amp; Return Heatmap</span>
            </h3>
            <p className="text-xs text-slate-400">Evaluating IRR returns across variable operational and market parameters</p>
          </div>
          <div className="flex gap-2">
            <select value={rowParam} onChange={(e) => setRowParam(e.target.value as RowParam)} aria-label="Sensitivity table Y-Axis parameter"
              className="bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-lg p-1.5 focus:outline-none focus:border-brand-500">
              <option value="interestRate">Y-Axis: Interest Rate</option>
              <option value="purchasePrice">Y-Axis: Purchase Price</option>
              <option value="downPaymentPercent">Y-Axis: Down Payment %</option>
            </select>
            <select value={colParam} onChange={(e) => setColParam(e.target.value as ColParam)} aria-label="Sensitivity table X-Axis parameter"
              className="bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-lg p-1.5 focus:outline-none focus:border-brand-500">
              <option value="targetCapRate">X-Axis: Exit Cap Rate</option>
              <option value="vacancyRate">X-Axis: Vacancy Rate</option>
              <option value="rentGrowth">X-Axis: Rent Growth</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse text-xs">
            <thead className="text-slate-400 font-semibold bg-slate-950/80">
              <tr className="border-b border-slate-900 text-slate-400">
                <th className="py-2.5 px-3 text-left font-bold">{ROW_LABELS[rowParam]} \ {COL_LABELS[colParam]}</th>
                {grid.colValues.map((cv, cIdx) => (
                  <th key={cIdx} className={`py-2.5 px-3 text-center font-bold ${cIdx === 2 ? 'text-brand-300 bg-brand-500/10 rounded-t-lg' : 'text-white'}`}>
                    {cv}%{cIdx === 2 && <span className="block text-[9px] font-normal text-brand-400">Base</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {grid.matrix.map((row, rIdx) => {
                const rowVal = grid.rowValues[rIdx];
                const baseRow = rIdx === 2;
                return (
                  <tr key={rIdx}>
                    <td className={`py-2.5 px-3 font-bold ${baseRow ? 'text-brand-300 bg-brand-500/10' : 'text-white bg-slate-950/90'} text-left border-r border-slate-900`}>
                      {rowParam === 'purchasePrice' ? formatCurrency(rowVal) : `${rowVal}%`}
                      {baseRow && <span className="block text-[9px] font-normal text-brand-400">Base</span>}
                    </td>
                    {row.map((cell, cIdx) => {
                      const baseCell = rIdx === 2 && cIdx === 2;
                      const irr = cell && typeof cell.irr === 'number' && !isNaN(cell.irr) ? cell.irr : 0;
                      const npv = cell && typeof cell.npv === 'number' && !isNaN(cell.npv) ? cell.npv : 0;
                      return (
                        <td key={cIdx} className={`py-3 px-3 ${cellClass(irr)}${baseCell ? ' ring-2 ring-brand-400 ring-offset-1 ring-offset-slate-950' : ''} rounded-lg m-0.5 transition-transform hover:scale-105`}>
                          <div className="text-sm font-bold">{irr.toFixed(1)}%</div>
                          <div className="text-[10px] opacity-75">{formatCurrency(npv)}</div>
                          {baseCell && <div className="text-[8px] uppercase tracking-wider font-extrabold text-brand-300 mt-0.5">Current</div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monte Carlo */}
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-900 pb-3 gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-violet" />
              <span>Monte Carlo 1,000-Iteration Risk Analysis</span>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-accent-violet/20 border border-accent-violet/40 text-accent-violet font-semibold inline-flex items-center gap-1">⚡ MathTree Engine (1,000 Runs)</span>
            </h3>
            <p className="text-xs text-slate-400">Stochastic market volatility model (Rent Growth, Appreciation &amp; Vacancy Shocks)</p>
          </div>
          <div className="flex items-center space-x-2">
            <button type="button" onClick={() => setPrimerOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition flex items-center space-x-1.5 shadow-sm">
              <span>📖 Methodology Primer</span>
            </button>
            <button type="button" disabled={running} onClick={() => setRerun((n) => n + 1)}
              className={`px-3 py-1.5 rounded-lg border border-accent-violet/40 bg-accent-violet/20 hover:bg-accent-violet/30 text-xs font-bold text-accent-violet transition flex items-center space-x-1.5 shadow-sm ${running ? 'opacity-75 cursor-not-allowed' : ''}`}>
              <span>{running ? 'Computing...' : '🎲 Re-Run (new random sample)'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className={statCard}><p className={statLabel}>Mean Expected IRR</p><p className={`text-sm font-extrabold text-white mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{(mc?.meanIrr ?? 0).toFixed(2)}%</p></div>
          <div className={statCard}><p className={statLabel}>Median IRR (P50)</p><p className={`text-sm font-extrabold text-accent-violet mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{(mc?.medianIrr ?? 0).toFixed(2)}%</p></div>
          <div className={statCard}><p className={statLabel}>Downside Risk (P5)</p><p className={`text-sm font-extrabold text-accent-rose mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{p5.toFixed(2)}%</p></div>
          <div className={statCard}><p className={statLabel}>Upside Potential (P95)</p><p className={`text-sm font-extrabold text-accent-emerald mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{(mc?.p95Irr ?? 0).toFixed(2)}%</p></div>
          <div className={statCard}><p className={statLabel}>Prob. Neg Cash Flow</p><p className={`text-sm font-extrabold text-amber-400 mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{probNeg.toFixed(1)}%</p></div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <div className={statCard}><p className={statLabel}>Mean Net Profit</p><p className={`text-sm font-extrabold text-white mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{formatCurrency(mc?.profit.mean ?? 0)}</p></div>
          <div className={statCard}><p className={statLabel}>Median Profit (P50)</p><p className={`text-sm font-extrabold text-accent-violet mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{formatCurrency(mc?.profit.median ?? 0)}</p></div>
          <div className={statCard}><p className={statLabel}>Downside Profit (P5)</p><p className={`text-sm font-extrabold text-accent-rose mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{formatCurrency(mc?.profit.p5 ?? 0)}</p></div>
          <div className={statCard}><p className={statLabel}>Upside Profit (P95)</p><p className={`text-sm font-extrabold text-accent-emerald mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{formatCurrency(mc?.profit.p95 ?? 0)}</p></div>
          <div className={statCard}><p className={statLabel}>Chance of a Loss</p><p className={`text-sm font-extrabold text-amber-400 mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{(mc?.profit.probLoss ?? 0).toFixed(1)}%</p></div>
          <div className={statCard}><p className={statLabel}>Chance of Clearing {(mc?.hurdleRate ?? 0).toFixed(1)}% Hurdle</p><p className={`text-sm font-extrabold text-white mt-1 ${running ? 'opacity-40 animate-pulse' : ''}`}>{(mc?.probAboveHurdle ?? 0).toFixed(1)}%</p></div>
        </div>

        {mc?.equity.thin && (
          <p className="text-[11px] text-amber-300/90 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2">
            Only {mc.equity.pctOfPrice.toFixed(1)}% of the price is your own cash, so IRR swings hard on early cash flow and is an unstable yardstick for this deal. The dollar-profit figures and chart are the steadier view.
          </p>
        )}
        {mc?.turnover.applies && (
          <p className="text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            Includes tenant turnover: {mc.turnover.annualPct}% of tenants leave each year (about {mc.turnover.avgMoveOutsPerRun} move-outs per run over the hold). Each space sits empty for about {mc.turnover.downtimeDays} days and costs {formatCurrency(mc.turnover.makeReadyCost)} to get ready. That averages {mc.turnover.impliedVacancyPct}% vacancy against your {mc.turnover.dealVacancyPct}% setting{mc.turnover.calibratedToVacancy ? ', which sets the vacant days' : ''}. Fixed-term tenants can only leave once their lease ends; month-to-month tenants can leave any year.
          </p>
        )}
        {mc?.tenantDefault.applies && (
          <p className="text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            Includes tenant-default risk: a {mc.tenantDefault.probabilityPct}% chance over the hold that a tenant stops paying for {mc.tenantDefault.downtimeMonths} months (it happened in {mc.tenantDefault.runsAffectedPct}% of these runs). Contractual rent and escalations are not varied; only rent after a lease ends moves with market growth.
          </p>
        )}

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/80 text-xs text-slate-300 flex items-start space-x-3 transition-all">
          <span className="text-lg leading-none">🛡️</span>
          <div className="space-y-1 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-xs">{mc?.riskClassification || 'Risk Assessment'}</span>
              <span className={badgeCls}>{mc ? badgeText : 'Strong Downside Buffer'}</span>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              {mc ? (
                <>
                  For <strong className="text-white">{dealName}</strong> ({asset.replace('-', ' ').toUpperCase()}), across 1,000 simulated micro-economic cycles, expected IRR averages <strong className="text-white">{mc.meanIrr.toFixed(2)}%</strong> (median <strong className="text-accent-violet">{mc.medianIrr.toFixed(2)}%</strong>).{' '}
                  In 95% of adverse market environments, your return remains above the <strong className="text-rose-400">{p5.toFixed(2)}% Value-at-Risk floor</strong>, with top-decile upside reaching <strong className="text-emerald-400">{mc.p95Irr.toFixed(2)}%</strong>.{' '}
                  Probability of Year 1 cash flow deficit is <strong className="text-amber-400">{probNeg.toFixed(1)}%</strong>. {skewText}
                </>
              ) : 'Stochastic analysis simulates 1,000 randomized micro-economic paths around baseline underwriting. Click "Re-Run 1,000 Runs" or adjust volatility parameters below to test capital call vulnerability.'}
            </p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-slate-900 bg-slate-950/70 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-3 shadow-inner">
          <div className="flex items-center gap-2">
            <span className="text-accent-violet font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-accent-violet animate-pulse" />
              Underwriting Baseline (&mu;):
            </span>
            <span className="font-mono text-slate-200 font-bold">
              {telem
                ? isZeroRent
                  ? `Holding Carry: $${Math.round(carry).toLocaleString()}/yr | Appreciation: ${Number(telem.baselineExitMetric).toFixed(1)}%`
                  : `Rent: ${Number(telem.baselineRentGrowth).toFixed(1)}% | Vacancy: ${Number(telem.baselineVacancy).toFixed(1)}% | ${telem.exitMetricType}: ${Number(telem.baselineExitMetric).toFixed(1)}%`
                : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold text-[11px] uppercase tracking-wider">Simulated Stress Window (&mu; &plusmn; &sigma;):</span>
            <span className="font-mono text-white font-bold bg-slate-900/90 px-2.5 py-0.5 rounded border border-slate-800">
              {telem
                ? isZeroRent
                  ? `Land Appreciation [${telem.exitMetricRange[0]}% – ${telem.exitMetricRange[1]}%]`
                  : `Rent [${telem.rentGrowthRange[0]}% – ${telem.rentGrowthRange[1]}%] | ${telem.exitMetricType} [${telem.exitMetricRange[0]}% – ${telem.exitMetricRange[1]}%]`
                : '—'}
            </span>
          </div>
        </div>

        <details className="group border border-slate-800/80 rounded-xl bg-slate-950/40 overflow-hidden">
          <summary className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer text-xs font-semibold text-slate-300 hover:text-white bg-slate-950/60 hover:bg-slate-900/50 transition select-none">
            <span className="flex items-center gap-2"><span className="text-accent-violet">⚙️</span><span>Stochastic Volatility Assumptions &amp; Stress Parameters</span></span>
            <span className="text-[11px] text-slate-500 group-open:rotate-180 transition-transform duration-200">▼</span>
          </summary>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-900 bg-slate-950/30 text-xs">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-400 font-medium">{isZeroRent ? 'Holding Cost Inflation (σ)' : 'Rent Growth Volatility (σ)'}</label>
                <span className="font-mono text-white font-bold">±{volRent.toFixed(2).replace(/0$/, '')}%</span>
              </div>
              <input type="range" min={0.5} max={5.0} step={0.25} value={volRent} onChange={(e) => setVolRent(parseFloat(e.target.value))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
              <p className="text-[10px] text-slate-500 mt-1">{isZeroRent ? 'Annual holding carry & expense inflation volatility.' : 'Randomized annual rent revision drift (μ = baseline, σ standard deviation).'}</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-400 font-medium">Vacancy Shock Volatility (σ)</label>
                <span className="font-mono text-white font-bold">±{volVacancy.toFixed(1)}%</span>
              </div>
              <input type="range" min={1.0} max={8.0} step={0.5} value={volVacancy} onChange={(e) => setVolVacancy(parseFloat(e.target.value))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
              <p className="text-[10px] text-slate-500 mt-1">Tenant turnover &amp; friction shock (μ = baseline vacancy, σ standard deviation).</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-400 font-medium">{isZeroRent ? 'Land Appreciation Volatility (σ)' : 'Exit Cap Rate Spread (σ)'}</label>
                <span className="font-mono text-white font-bold">±{volCap} bps</span>
              </div>
              <input type="range" min={25} max={300} step={25} value={volCap} onChange={(e) => setVolCap(parseInt(e.target.value, 10))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
              <p className="text-[10px] text-slate-500 mt-1">{isZeroRent ? 'Stochastic land value appreciation variance over the 10-year holding period.' : 'Capital markets expansion / liquidity uncertainty at terminal exit year.'}</p>
            </div>
          </div>
          {!isZeroRent && !!DEFAULT_TURNOVER[asset] && Array.isArray(merged.leases) && merged.leases.some((l: any) => (parseFloat(l.monthlyRent) || 0) > 0) && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-900 bg-slate-950/30 text-xs">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-400 font-medium">Tenant Turnover (leave each year)</label>
                  <span className="font-mono text-white font-bold">{turnPct}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={turnPct} onChange={(e) => setTurnPct(parseInt(e.target.value, 10))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
                <p className="text-[10px] text-slate-500 mt-1">Share of tenants who move out in a year. Industry average: about 45% for apartments, 30% for houses. Set 0 to use your vacancy rate only.</p>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-400 font-medium">Vacant Days Between Tenants</label>
                  <span className="font-mono text-white font-bold">{turnDays === null ? 'matches vacancy' : turnDays}</span>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-300 mb-1"><input type="checkbox" checked={turnDays === null} onChange={(e) => setTurnDays(e.target.checked ? null : 41)} className="rounded bg-slate-900 border-slate-700" />Match my vacancy setting (recommended)</label>
                <input type="range" min={0} max={120} step={5} value={turnDays ?? 41} disabled={turnDays === null} onChange={(e) => setTurnDays(parseInt(e.target.value, 10))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer disabled:opacity-40" />
                <p className="text-[10px] text-slate-500 mt-1">By default the vacant stretch is set so the average vacancy equals the deal's vacancy rate. Industry average: about 41 days.</p>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-400 font-medium">Make-Ready Cost per Move-Out</label>
                  <span className="font-mono text-white font-bold">${makeReady.toLocaleString()}</span>
                </div>
                <input type="range" min={0} max={5000} step={250} value={makeReady} onChange={(e) => setMakeReady(parseInt(e.target.value, 10))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
                <p className="text-[10px] text-slate-500 mt-1">Cleaning, paint and repairs between tenants (lost rent is counted as vacancy). Typical: $1,200 to $1,800 per apartment.</p>
              </div>
            </div>
          )}
          {!isZeroRent && !DEFAULT_TURNOVER[asset] && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-900 bg-slate-950/30 text-xs">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-400 font-medium">Tenant Default Risk (chance over the hold)</label>
                  <span className="font-mono text-white font-bold">{defProb}%</span>
                </div>
                <input type="range" min={0} max={40} step={5} value={defProb} onChange={(e) => setDefProb(parseInt(e.target.value, 10))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
                <p className="text-[10px] text-slate-500 mt-1">Chance that a tenant stops paying at some point. Applies to commercial and storage deals; set 0 to remove it.</p>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-400 font-medium">Downtime After a Default (months)</label>
                  <span className="font-mono text-white font-bold">{defMonths}</span>
                </div>
                <input type="range" min={3} max={24} step={3} value={defMonths} onChange={(e) => setDefMonths(parseInt(e.target.value, 10))} className="w-full accent-accent-violet bg-slate-900 cursor-pointer" />
                <p className="text-[10px] text-slate-500 mt-1">Months with no rent before the space is paying again. You carry taxes, insurance and upkeep meanwhile.</p>
              </div>
            </div>
          )}
        </details>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-2 pb-0.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white uppercase text-[11px] tracking-wide">Hold Period Total IRR Distribution (%)</span>
            <span className="text-slate-500 font-normal text-[11px]">| 12 equal-width bins between the 1st and 99th percentile</span>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className="text-amber-400 font-bold uppercase text-[10px] tracking-wider bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">Metric Scope</span>
            <span>Top card tracks <strong className="text-amber-300">Year 1 Cash Deficit</strong>, chart plots <strong className="text-slate-200">Total Hold IRR</strong></span>
          </div>
        </div>

        <div className="h-64 w-full relative pt-1">
          {mc && <MonteCarloChart bins={mc.histogramBins} runs={mc.runs} metric="irr" />}
        </div>

        <div className="flex items-center gap-2 pt-3 text-xs">
          <span className="font-bold text-white uppercase text-[11px] tracking-wide">Net Profit Distribution ($)</span>
          <span className="text-slate-500 font-normal text-[11px]">| every cash flow plus exit equity, minus the cash you put in</span>
        </div>
        <div className="h-64 w-full relative pt-1">
          {mc && <MonteCarloChart bins={mc.profit.histogramBins} runs={mc.runs} metric="profit" />}
        </div>
      </div>

      <DownPaymentSensitivityCard deal={deal} metrics={metrics} onUpdateInputs={onUpdateInputs} />

      <StochasticPrimerModal isOpen={primerOpen} onClose={() => setPrimerOpen(false)} deal={deal} metrics={metrics} />
    </div>
  );
};

