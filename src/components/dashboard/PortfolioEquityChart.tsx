import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import { DealRecord } from '../../lib/math/types';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { resolvePointInTimeDealMetrics } from '../../lib/math/pointInTime';
import { formatCurrency } from '../../lib/format';
import { TrendingUp, Landmark, DollarSign, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

Chart.register(...registerables);

interface PortfolioEquityChartProps {
  deals: DealRecord[];
}

export const PortfolioEquityChart: React.FC<PortfolioEquityChartProps> = ({ deals }) => {
  const [chartMode, setChartMode] = useState<'equity' | 'cashflow'>('equity');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  // Focus on owned deals for the equity story, falling back to all deals if no owned deals
  const targetDeals = useMemo(() => {
    const owned = deals.filter((d) => d.status === 'owned');
    return owned.length > 0 ? owned : deals;
  }, [deals]);

  // Aggregate 10-year trajectory across all target deals
  const trajectory = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const today = new Date();

    // Year 0 (today) point-in-time facts
    let y0Val = 0;
    let y0Debt = 0;
    let y0Eq = 0;
    let y0Cf = 0;

    targetDeals.forEach((d) => {
      const pit = resolvePointInTimeDealMetrics(d, today);
      y0Val += pit.currentVal;
      y0Debt += pit.currentDebt;
      y0Eq += pit.currentEquity;
      y0Cf += pit.currentCashFlow;
    });

    const years = [
      {
        yearIndex: 0,
        calendarYear: currentYear,
        label: 'Today',
        assetValue: Math.round(y0Val),
        debtBalance: Math.round(y0Debt),
        netEquity: Math.round(y0Eq),
        cashFlow: Math.round(y0Cf),
        noi: 0,
      },
    ];

    // Compute years 1 to 10 from engine projections
    const dealsMetrics = targetDeals.map((d) => tryComputeDealMetrics(d));

    for (let yr = 1; yr <= 10; yr++) {
      let yrVal = 0;
      let yrDebt = 0;
      let yrCf = 0;
      let yrNoi = 0;

      dealsMetrics.forEach((m, idx) => {
        const deal = targetDeals[idx];
        const proj = m?.projections?.[yr - 1];

        if (proj) {
          yrVal += Number(proj.propertyValue) || 0;
          yrDebt += Number(proj.endingLoanBalance ?? proj.loanBalanceRemaining) || 0;
          yrCf += Number(proj.cashFlow ?? proj.netCashFlow) || 0;
          yrNoi += Number(proj.netOperatingIncome) || 0;
        } else {
          // If no projections, carry forward baseline with 3% appreciation and steady debt
          const pit = resolvePointInTimeDealMetrics(deal, today);
          const compounded = pit.currentVal * Math.pow(1.03, yr);
          yrVal += compounded;
          yrDebt += pit.currentDebt;
          yrCf += pit.currentCashFlow;
        }
      });

      const yrEq = Math.max(0, yrVal - yrDebt);

      years.push({
        yearIndex: yr,
        calendarYear: currentYear + yr,
        label: `Yr ${yr} (${currentYear + yr})`,
        assetValue: Math.round(yrVal),
        debtBalance: Math.round(yrDebt),
        netEquity: Math.round(yrEq),
        cashFlow: Math.round(yrCf),
        noi: Math.round(yrNoi),
      });
    }

    return years;
  }, [targetDeals]);

  // Key story milestone numbers
  const y0 = trajectory[0];
  const y5 = trajectory[5];
  const y10 = trajectory[10];

  const eq5GrowthPct =
    y0.netEquity > 0 ? ((y5.netEquity - y0.netEquity) / y0.netEquity) * 100 : 0;
  const eq10GrowthPct =
    y0.netEquity > 0 ? ((y10.netEquity - y0.netEquity) / y0.netEquity) * 100 : 0;

  // Monthly principal paydown velocity in year 1
  const annualPrincipalPaydown = Math.max(0, y0.debtBalance - trajectory[1].debtBalance);
  const monthlyPaydownVelocity = Math.round(annualPrincipalPaydown / 12);

  // Render Chart.js
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isCollapsed) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Gradient for Net Equity fill
    const equityGradient = ctx.createLinearGradient(0, 0, 0, 260);
    equityGradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    equityGradient.addColorStop(0.7, 'rgba(16, 185, 129, 0.08)');
    equityGradient.addColorStop(1, 'rgba(16, 185, 129, 0.00)');

    const labels = trajectory.map((t) => t.label);

    const datasets =
      chartMode === 'equity'
        ? [
            {
              label: 'Net Equity',
              data: trajectory.map((t) => t.netEquity),
              borderColor: '#10b981',
              backgroundColor: equityGradient,
              borderWidth: 3,
              tension: 0.35,
              fill: true,
              pointBackgroundColor: '#10b981',
              pointBorderColor: '#0f172a',
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: 'Gross Asset Value',
              data: trajectory.map((t) => t.assetValue),
              borderColor: '#38bdf8',
              backgroundColor: 'transparent',
              borderWidth: 2,
              tension: 0.35,
              fill: false,
              pointBackgroundColor: '#38bdf8',
              pointBorderColor: '#0f172a',
              pointBorderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
            },
            {
              label: 'Remaining Debt',
              data: trajectory.map((t) => t.debtBalance),
              borderColor: '#94a3b8',
              backgroundColor: 'transparent',
              borderWidth: 2,
              borderDash: [5, 5],
              tension: 0.35,
              fill: false,
              pointBackgroundColor: '#94a3b8',
              pointBorderColor: '#0f172a',
              pointBorderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
            },
          ]
        : [
            {
              label: 'Net Operating Income',
              data: trajectory.map((t) => t.noi),
              borderColor: '#059669',
              backgroundColor: 'rgba(5, 150, 105, 0.15)',
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointRadius: 3,
            },
            {
              label: 'Annual Cash Flow',
              data: trajectory.map((t) => t.cashFlow),
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.25)',
              borderWidth: 3,
              tension: 0.3,
              fill: true,
              pointRadius: 4,
            },
          ];

    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#94a3b8',
              font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 },
              boxWidth: 12,
              boxHeight: 12,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            padding: 12,
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            titleFont: { family: 'Plus Jakarta Sans', weight: 'bold', size: 12 },
            bodyFont: { family: 'Plus Jakarta Sans', size: 11 },
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y;
                return ` ${ctx.dataset.label}: ${formatCurrency(val ?? 0)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#64748b',
              font: { family: 'Plus Jakarta Sans', weight: 500, size: 10 },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#64748b',
              font: { family: 'Plus Jakarta Sans', weight: 500, size: 10 },
              callback: (value) => {
                const v = Number(value);
                if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
                if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
                return `$${v}`;
              },
            },
          },
        },
      },
    });

    chartInstanceRef.current = chart;

    return () => {
      chart.destroy();
      chartInstanceRef.current = null;
    };
  }, [trajectory, chartMode, isCollapsed]);

  if (targetDeals.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-emerald-950/20 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm transition-all duration-200">
      {/* Top Banner & Story Metrics */}
      <div className="p-4 sm:p-5 border-b border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <TrendingUp className="w-4 h-4" />
            </span>
            <h3 className="text-sm font-extrabold text-white tracking-tight flex items-center space-x-2">
              <span>Portfolio Wealth Creation & Equity Trajectory</span>
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            10-year outlook showing how contractual loan paydown and property appreciation expand net equity over time.
          </p>
        </div>

        {/* Milestone Story Badges */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-xl">
            <span className="text-[9px] uppercase font-bold text-slate-500 block">Current Net Equity</span>
            <span className="text-xs font-black text-white font-mono tabular-nums">
              {formatCurrency(y0.netEquity)}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-emerald-900/40 px-3 py-1.5 rounded-xl">
            <span className="text-[9px] uppercase font-bold text-slate-500 block">5-Yr Projected Equity</span>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-black text-emerald-400 font-mono tabular-nums">
                {formatCurrency(y5.netEquity)}
              </span>
              {eq5GrowthPct > 0 && (
                <span className="text-[10px] font-bold text-emerald-400 font-mono">
                  (+{eq5GrowthPct.toFixed(0)}%)
                </span>
              )}
            </div>
          </div>

          <div className="bg-slate-950/80 border border-emerald-800/50 px-3 py-1.5 rounded-xl hidden md:block">
            <span className="text-[9px] uppercase font-bold text-slate-500 block">10-Yr Projected Equity</span>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-black text-emerald-300 font-mono tabular-nums">
                {formatCurrency(y10.netEquity)}
              </span>
              {eq10GrowthPct > 0 && (
                <span className="text-[10px] font-bold text-emerald-400 font-mono">
                  (+{eq10GrowthPct.toFixed(0)}%)
                </span>
              )}
            </div>
          </div>

          {monthlyPaydownVelocity > 0 && (
            <div className="bg-slate-950/80 border border-cyan-900/40 px-3 py-1.5 rounded-xl hidden xl:block">
              <span className="text-[9px] uppercase font-bold text-slate-500 block">Paydown Velocity</span>
              <span className="text-xs font-black text-cyan-400 font-mono tabular-nums">
                +{formatCurrency(monthlyPaydownVelocity)}/mo
              </span>
            </div>
          )}

          {/* Controls: Mode Switch & Collapse Toggle */}
          <div className="flex items-center space-x-1.5 pl-1 sm:pl-2">
            <div className="inline-flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setChartMode('equity')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold transition ${
                  chartMode === 'equity'
                    ? 'bg-slate-800 text-emerald-400 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Equity & Debt
              </button>
              <button
                type="button"
                onClick={() => setChartMode('cashflow')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold transition ${
                  chartMode === 'cashflow'
                    ? 'bg-slate-800 text-emerald-400 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Cash Flow
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition"
              title={isCollapsed ? 'Expand chart' : 'Collapse chart'}
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Chart Canvas Area */}
      {!isCollapsed && (
        <div className="p-4 sm:p-5">
          <div className="w-full h-64 sm:h-72">
            <canvas ref={canvasRef} />
          </div>
        </div>
      )}
    </div>
  );
};
