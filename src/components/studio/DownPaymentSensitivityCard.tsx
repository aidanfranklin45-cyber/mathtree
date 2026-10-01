import React, { useMemo, useState } from 'react';
import { DealRecord, DealMetrics, DealInputs } from '../../lib/math/types';
import { calculateDownPaymentMatrix, DownPaymentMatrixResult, DownPaymentMatrixRow } from '../../lib/engine';
import { prepareEngineInputs } from '../../lib/engine/compute';
import { formatCurrency } from '../../lib/format';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
  onUpdateInputs?: (patch: Partial<DealInputs>) => void;
}

type PresetKey = 'standard' | 'high_leverage' | 'conservative' | 'extremes' | 'custom';

const PRESETS: Record<PresetKey, { label: string; values: number[] }> = {
  standard: { label: 'Standard (10%–40%)', values: [10, 15, 20, 25, 30, 35, 40] },
  high_leverage: { label: 'High Leverage (5%–25%)', values: [5, 10, 15, 20, 25] },
  conservative: { label: 'Conservative (20%–50%)', values: [20, 25, 30, 35, 40, 45, 50] },
  extremes: { label: 'Full Spectrum (0%–100%)', values: [0, 10, 20, 30, 40, 50, 75, 100] },
  custom: { label: 'Custom Scenarios', values: [] },
};

function normalizeAsset(ac: string): string {
  const s = String(ac || 'commercial').toLowerCase();
  if (s.includes('multi')) return 'multi-unit';
  if (s.includes('single') || s.includes('resid')) return 'single-family';
  if (s.includes('storage')) return 'storage';
  return 'commercial';
}

export const DownPaymentSensitivityCard: React.FC<Props> = ({ deal, metrics: _metrics, onUpdateInputs }) => {
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('standard');
  const [activePercentages, setActivePercentages] = useState<number[]>([10, 15, 20, 25, 30, 35, 40]);
  const [customInput, setCustomInput] = useState<string>('');
  const [hoveredRow, setHoveredRow] = useState<DownPaymentMatrixRow | null>(null);
  const [appliedFeedback, setAppliedFeedback] = useState<string | null>(null);

  const baselinePercent = Number(deal.inputs?.downPaymentPercent ?? 25);

  const handleSelectPreset = (key: PresetKey) => {
    setSelectedPreset(key);
    if (key !== 'custom') {
      setActivePercentages(PRESETS[key].values);
    }
  };

  const handleAddPercentage = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(customInput);
    if (isNaN(val) || val < 0 || val > 100) return;
    const rounded = Math.round(val * 100) / 100;
    if (!activePercentages.includes(rounded)) {
      const next = [...activePercentages, rounded].sort((a, b) => a - b);
      setActivePercentages(next);
      setSelectedPreset('custom');
    }
    setCustomInput('');
  };

  const handleRemovePercentage = (p: number) => {
    if (activePercentages.length <= 2) return;
    const next = activePercentages.filter((val) => Math.abs(val - p) > 0.001);
    setActivePercentages(next);
    setSelectedPreset('custom');
  };

  const matrix: DownPaymentMatrixResult | null = useMemo(() => {
    try {
      const inputs = prepareEngineInputs(deal);
      const asset = normalizeAsset(String(deal.asset_class));
      return calculateDownPaymentMatrix(asset, inputs, activePercentages);
    } catch (err) {
      console.warn('[DownPaymentSensitivity] calculation failed', err);
      return null;
    }
  }, [deal, activePercentages]);

  const handleApplyDownPayment = (dp: number) => {
    if (onUpdateInputs) {
      onUpdateInputs({ downPaymentPercent: dp });
      setAppliedFeedback(`Updated deal underwriting to ${dp}% down payment`);
      setTimeout(() => setAppliedFeedback(null), 3500);
    }
  };

  if (!matrix || matrix.rows.length === 0) {
    return null;
  }

  const rows = matrix.rows;

  // Chart coordinate calculations
  const maxDs = Math.max(...rows.map((r) => r.annualDebtService), 1);
  const cocs = rows.map((r) => r.cashOnCash);
  const minCoc = Math.min(...cocs, 0);
  const maxCoc = Math.max(...cocs, 15);
  const cocRange = maxCoc - minCoc || 1;

  const chartW = 760;
  const chartH = 190;
  const padLeft = 65;
  const padRight = 65;
  const padTop = 25;
  const padBottom = 35;
  const usableW = chartW - padLeft - padRight;
  const usableH = chartH - padTop - padBottom;

  const stepX = rows.length > 1 ? usableW / (rows.length - 1) : usableW / 2;

  const points = rows.map((r, idx) => {
    const x = padLeft + idx * stepX;
    const barHeight = Math.max(0, (r.annualDebtService / maxDs) * usableH);
    const barY = padTop + usableH - barHeight;
    const cocFrac = (r.cashOnCash - minCoc) / cocRange;
    const lineY = padTop + usableH - cocFrac * usableH;
    return { ...r, x, barHeight, barY, lineY };
  });

  const cocPath = points.length > 1
    ? points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.lineY.toFixed(1)}`, '')
    : '';

  const baselinePt = points.find((pt) => pt.isBaseline);

  return (
    <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-5">
      {/* Header & Inflection Callout */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-900 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-emerald" />
            <h3 className="text-sm font-bold text-white tracking-tight">Down Payment &amp; Leverage Sensitivity</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Live Engine Analysis
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Evaluate how varying equity down impacts debt service burden, cash-on-cash yield, and loan coverage.
          </p>
        </div>

        {/* Leverage Summary Pill */}
        <div className="flex flex-wrap items-center gap-2">
          {matrix.leverageType === 'positive' && (
            <div className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1.5">
              <span>🚀</span>
              <span><strong>Positive Leverage:</strong> Cap Rate ({matrix.goingInCapRate.toFixed(2)}%) &gt; Loan Constant ({matrix.loanConstant?.toFixed(2)}%)</span>
            </div>
          )}
          {matrix.leverageType === 'negative' && (
            <div className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5">
              <span>⚠️</span>
              <span><strong>Negative Leverage:</strong> Loan Constant ({matrix.loanConstant?.toFixed(2)}%) &gt; Cap Rate ({matrix.goingInCapRate.toFixed(2)}%)</span>
            </div>
          )}
          {matrix.leverageType === 'neutral' && (
            <div className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 flex items-center space-x-1.5">
              <span>⚖️</span>
              <span><strong>Neutral Leverage:</strong> Cap Rate ~ Loan Constant ({matrix.goingInCapRate.toFixed(2)}%)</span>
            </div>
          )}
          {matrix.debtServicePer5PctDown > 0 && (
            <div className="px-2.5 py-1 rounded-xl text-[11px] font-medium bg-slate-950/80 text-cyan-300 border border-cyan-800/30">
              +{formatCurrency(matrix.debtServicePer5PctDown)}/yr savings per +5% down
            </div>
          )}
        </div>
      </div>

      {/* Preset Controls & Custom Add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(PRESETS) as PresetKey[]).map((key) => {
            if (key === 'custom' && selectedPreset !== 'custom') return null;
            const active = selectedPreset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSelectPreset(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                  active
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {PRESETS[key].label}
              </button>
            );
          })}
        </div>

        {/* Custom Input */}
        <form onSubmit={handleAddPercentage} className="flex items-center space-x-2">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            placeholder="Add % down..."
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            className="w-28 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            + Add
          </button>
        </form>
      </div>

      {appliedFeedback && (
        <div className="p-2.5 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center justify-between">
          <span>✓ {appliedFeedback}</span>
        </div>
      )}

      {/* Visual Dual-Metric Chart */}
      <div className="bg-slate-950/80 border border-slate-900 rounded-xl p-4">
        <div className="flex justify-between items-center text-xs mb-2">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded bg-cyan-600/70 border border-cyan-400/50 inline-block" />
              <span className="text-slate-300 font-medium text-[11px]">Annual Debt Service ($)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
              <span className="text-slate-300 font-medium text-[11px]">Cash-on-Cash Return (%)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full border border-dashed border-brand-400 inline-block" />
              <span className="text-brand-300 font-bold text-[11px]">Underwritten Baseline ({baselinePercent}%)</span>
            </div>
          </div>
          {hoveredRow && (
            <div className="text-[11px] text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              <span className="font-bold text-white">{hoveredRow.downPaymentPercent}% Down</span>: Debt {formatCurrency(hoveredRow.annualDebtService)}/yr • CoC {hoveredRow.cashOnCash.toFixed(1)}% • DSCR {hoveredRow.dscr !== null ? `${hoveredRow.dscr.toFixed(2)}x` : 'N/A'}
            </div>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-48 select-none overflow-visible">
            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1.0].map((frac, i) => {
              const y = padTop + usableH * (1 - frac);
              const valDs = maxDs * frac;
              const valCoc = minCoc + cocRange * frac;
              return (
                <g key={i}>
                  <line x1={padLeft} y1={y} x2={chartW - padRight} y2={y} stroke="#1e293b" strokeDasharray="3 3" />
                  <text x={padLeft - 8} y={y + 3} fill="#64748b" fontSize="8.5" textAnchor="end" fontFamily="sans-serif">
                    ${Math.round(valDs / 1000)}k
                  </text>
                  <text x={chartW - padRight + 8} y={y + 3} fill="#059669" fontSize="8.5" textAnchor="start" fontFamily="sans-serif">
                    {valCoc.toFixed(1)}%
                  </text>
                </g>
              );
            })}

            {/* Baseline Vertical Marker */}
            {baselinePt && (
              <g>
                <line
                  x1={baselinePt.x}
                  y1={padTop - 8}
                  x2={baselinePt.x}
                  y2={padTop + usableH}
                  stroke="#3b82f6"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                <rect
                  x={baselinePt.x - 28}
                  y={padTop - 20}
                  width="56"
                  height="14"
                  rx="3"
                  fill="#1e3a8a"
                  stroke="#3b82f6"
                  strokeWidth="1"
                />
                <text
                  x={baselinePt.x}
                  y={padTop - 10}
                  fill="#93c5fd"
                  fontSize="7.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  fontFamily="sans-serif"
                >
                  Baseline {baselinePercent}%
                </text>
              </g>
            )}

            {/* Debt Service Bars */}
            {points.map((pt) => {
              const isHov = hoveredRow?.downPaymentPercent === pt.downPaymentPercent;
              const barW = Math.max(14, Math.min(36, stepX * 0.45));
              return (
                <g
                  key={`bar-${pt.downPaymentPercent}`}
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setHoveredRow(pt)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <rect
                    x={pt.x - barW / 2}
                    y={pt.barY}
                    width={barW}
                    height={pt.barHeight}
                    rx="3"
                    fill={pt.isBaseline ? '#0284c7' : '#0f766e'}
                    opacity={isHov ? 1.0 : 0.75}
                    stroke={pt.isBaseline ? '#38bdf8' : '#14b8a6'}
                    strokeWidth={isHov ? 1.5 : 1}
                  />
                  <text
                    x={pt.x}
                    y={chartH - padBottom + 14}
                    fill={pt.isBaseline ? '#38bdf8' : '#94a3b8'}
                    fontSize="9.5"
                    fontWeight={pt.isBaseline ? 'bold' : 'normal'}
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    {pt.downPaymentPercent}%
                  </text>
                  <text
                    x={pt.x}
                    y={chartH - padBottom + 25}
                    fill="#64748b"
                    fontSize="7.5"
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    ${Math.round(pt.downPaymentAmount / 1000)}k
                  </text>
                </g>
              );
            })}

            {/* Cash-on-Cash Return Line */}
            {cocPath && (
              <path
                d={cocPath}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Cash-on-Cash Points */}
            {points.map((pt) => {
              const isHov = hoveredRow?.downPaymentPercent === pt.downPaymentPercent;
              return (
                <g
                  key={`pt-${pt.downPaymentPercent}`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredRow(pt)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <circle
                    cx={pt.x}
                    cy={pt.lineY}
                    r={pt.isBaseline ? 6 : (isHov ? 5.5 : 4)}
                    fill={pt.cashOnCash >= 0 ? '#10b981' : '#f43f5e'}
                    stroke="#020617"
                    strokeWidth="2"
                  />
                  {pt.isBaseline && (
                    <circle cx={pt.x} cy={pt.lineY} r="9" fill="none" stroke="#34d399" strokeWidth="1.5" opacity="0.6" />
                  )}
                  <text
                    x={pt.x}
                    y={pt.lineY - 8}
                    fill={pt.cashOnCash >= 0 ? '#34d399' : '#fb7185'}
                    fontSize="8.5"
                    fontWeight="bold"
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    {pt.cashOnCash.toFixed(1)}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Comparison Matrix Table */}
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-900 text-slate-400 font-semibold bg-slate-950/70">
              <th className="py-2.5 px-4 font-bold text-slate-300">Down Payment %</th>
              <th className="py-2.5 px-3 font-semibold">Equity Required</th>
              <th className="py-2.5 px-3 font-semibold">Loan Amount / LTV</th>
              <th className="py-2.5 px-3 font-semibold">Monthly Debt Service</th>
              <th className="py-2.5 px-3 font-semibold">Annual Debt Service</th>
              <th className="py-2.5 px-3 font-semibold">Net Cash Flow</th>
              <th className="py-2.5 px-3 font-semibold text-accent-emerald">Cash-on-Cash</th>
              <th className="py-2.5 px-3 font-semibold">Senior DSCR</th>
              <th className="py-2.5 px-4 text-right">Underwriting</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/60">
            {rows.map((row) => {
              const isBase = row.isBaseline;
              const isHov = hoveredRow?.downPaymentPercent === row.downPaymentPercent;
              const dscrOk = row.dscr !== null && row.dscr >= 1.25;

              return (
                <tr
                  key={row.downPaymentPercent}
                  onMouseEnter={() => setHoveredRow(row)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className={`transition ${
                    isBase
                      ? 'bg-blue-950/30 text-white font-bold border-l-2 border-l-brand-400'
                      : isHov
                        ? 'bg-slate-900/30 text-slate-200'
                        : 'hover:bg-slate-900/20 text-slate-300'
                  }`}
                >
                  <td className="py-2.5 px-4">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-xs">{row.downPaymentPercent}%</span>
                      {isBase && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-500/20 text-blue-400 border border-blue-500/40">
                          CURRENT
                        </span>
                      )}
                      {activePercentages.length > 2 && selectedPreset === 'custom' && !isBase && (
                        <button
                          type="button"
                          onClick={() => handleRemovePercentage(row.downPaymentPercent)}
                          className="text-slate-600 hover:text-rose-400 text-xs transition"
                          title="Remove percentage"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-medium">
                    {formatCurrency(row.initialCashInvested)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-medium">{formatCurrency(row.loanAmount)}</span>
                    <span className="text-[10px] text-slate-500 ml-1.5">({row.ltv.toFixed(0)}% LTV)</span>
                  </td>
                  <td className="py-2.5 px-3 font-medium">
                    {row.monthlyDebtService > 0 ? `${formatCurrency(row.monthlyDebtService)}/mo` : '$0 (All-Cash)'}
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-300">
                    {formatCurrency(row.annualDebtService)}
                  </td>
                  <td className={`py-2.5 px-3 font-semibold ${row.netCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCurrency(row.netCashFlow)}/yr
                  </td>
                  <td className={`py-2.5 px-3 font-bold ${row.cashOnCash >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {row.cashOnCash.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 font-medium">
                    {row.dscr !== null ? (
                      <span className={dscrOk ? 'text-cyan-400 font-semibold' : 'text-amber-400 font-semibold'}>
                        {row.dscr.toFixed(2)}x
                      </span>
                    ) : (
                      <span className="text-slate-500">N/A (All-Cash)</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {isBase ? (
                      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Active</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleApplyDownPayment(row.downPaymentPercent)}
                        className="px-2 py-1 rounded text-[10px] font-bold bg-slate-800 hover:bg-brand-600 text-slate-300 hover:text-white transition shadow-sm border border-slate-700 hover:border-brand-500"
                      >
                        Apply {row.downPaymentPercent}%
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
