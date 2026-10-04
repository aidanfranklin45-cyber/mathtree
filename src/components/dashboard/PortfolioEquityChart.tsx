import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics } from '../../lib/math/pointInTime';
import { getMonthlyAmortization } from '../../lib/engine';
import { formatCurrency } from '../../lib/format';

Chart.register(...registerables);

interface PortfolioEquityChartProps {
  deals: DealRecord[];
  embedded?: boolean;
}

export const PortfolioEquityChart: React.FC<PortfolioEquityChartProps> = ({ deals, embedded = false }) => {
  const [chartMode, setChartMode] = useState<'equity' | 'cashflow'>('equity');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  // Focus on owned deals for the wealth trajectory, falling back to all deals if no owned deals
  const targetDeals = useMemo(() => {
    const owned = deals.filter((d) => d.status === 'owned');
    return owned.length > 0 ? owned : deals;
  }, [deals]);

  // Aggregate continuous forward 10-year trajectory starting strictly from TODAY
  const trajectory = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();

    // 1. Calculate Point-in-Time facts for each deal TODAY
    const dealStates = targetDeals.map((deal) => {
      const pit = resolvePointInTimeDealMetrics(deal, today);
      const inp = (deal.inputs || {}) as Record<string, any>;

      const price = Number(deal.purchase_price || inp.purchasePrice || inp.price || 0);
      const appRate = Number(
        inp.appreciationRate !== undefined ? inp.appreciationRate : (inp.targetCapRate ?? 3.0),
      );
      const termYears = Number(inp.loanTerm || inp.loanTermYears || inp.amortizationYears || 30);
      const rate = Number(inp.interestRate ?? 6.5);
      const baseLoan = pit.baseLoanAmount || 0;
      const monthsElapsed = pit.monthsElapsed || 0;

      // Pre-generate extended 10-year forward amortization schedule (monthsElapsed + 120 months)
      let amortRows: any[] = [];
      if (baseLoan > 0 && termYears > 0) {
        try {
          amortRows = getMonthlyAmortization(baseLoan, rate, termYears, {
            totalMonths: monthsElapsed + 121,
            financingType: inp.financingType,
            interestOnlyYears: inp.interestOnlyYears,
            armInitialYears: inp.armInitialYears,
            armAdjustmentRate: inp.armAdjustmentRate,
            armRateCap: inp.armRateCap,
          });
        } catch {
          amortRows = [];
        }
      }

      return {
        deal,
        pit,
        price,
        appRate,
        monthsElapsed,
        amortRows,
        currentVal: pit.currentVal,
        currentDebt: pit.currentDebt,
        currentNoi: pit.currentNoi,
        currentDebtService: pit.currentDebtService,
        currentCashFlow: pit.currentCashFlow,
      };
    });

    // 2. Year 0 (Today) exact roll-up
    let y0Val = 0;
    let y0Debt = 0;
    let y0Cf = 0;
    let y0Noi = 0;

    dealStates.forEach((ds) => {
      y0Val += ds.currentVal;
      y0Debt += ds.currentDebt;
      y0Cf += ds.currentCashFlow;
      y0Noi += ds.currentNoi;
    });

    const y0Eq = Math.max(0, y0Val - y0Debt);

    const years = [
      {
        yearIndex: 0,
        calendarYear: currentYear,
        label: 'Today',
        assetValue: Math.round(y0Val),
        debtBalance: Math.round(y0Debt),
        netEquity: Math.round(y0Eq),
        cashFlow: Math.round(y0Cf),
        noi: Math.round(y0Noi),
      },
    ];

    // 3. Forward Years 1 to 10 strictly progressing from Today
    for (let yr = 1; yr <= 10; yr++) {
      let yrVal = 0;
      let yrDebt = 0;
      let yrNoi = 0;
      let yrDebtService = 0;

      dealStates.forEach((ds) => {
        // Continuous appreciation: Current Value compounded forward annually
        const futureVal = ds.currentVal * Math.pow(1 + ds.appRate / 100, yr);
        yrVal += futureVal;

        // Amortization: Debt balance at (monthsElapsed + yr * 12)
        const targetMonthIdx = ds.monthsElapsed + yr * 12 - 1;
        let futureDebt = ds.currentDebt;
        if (ds.amortRows.length > targetMonthIdx && targetMonthIdx >= 0) {
          futureDebt = Number(ds.amortRows[targetMonthIdx]?.endingBalance ?? 0);
        } else if (ds.currentDebt > 0) {
          // Standard principal paydown fallback
          futureDebt = Math.max(0, ds.currentDebt - (ds.currentDebt * 0.025 * yr));
        }
        yrDebt += futureDebt;

        // Operational cash flow forward run-rate
        const futureNoi = ds.currentNoi * Math.pow(1.025, yr);
        yrNoi += futureNoi;
        yrDebtService += ds.currentDebtService;
      });

      const yrEq = Math.max(0, yrVal - yrDebt);
      const yrCf = yrNoi - yrDebtService;

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
    if (!canvas) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Gradient for Net Equity fill
    const equityGradient = ctx.createLinearGradient(0, 0, 0, 180);
    equityGradient.addColorStop(0, 'rgba(16, 185, 129, 0.30)');
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
              borderWidth: 2.5,
              tension: 0.35,
              fill: true,
              pointBackgroundColor: '#10b981',
              pointBorderColor: '#0f172a',
              pointBorderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
            },
            {
              label: 'Gross Asset Value',
              data: trajectory.map((t) => t.assetValue),
              borderColor: '#f8fafc',
              backgroundColor: 'transparent',
              borderWidth: 2,
              tension: 0.35,
              fill: false,
              pointBackgroundColor: '#f8fafc',
              pointBorderColor: '#0f172a',
              pointBorderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
            },
            {
              label: 'Remaining Debt',
              data: trajectory.map((t) => t.debtBalance),
              borderColor: '#64748b',
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderDash: [4, 4],
              tension: 0.35,
              fill: false,
              pointBackgroundColor: '#64748b',
              pointBorderColor: '#0f172a',
              pointBorderWidth: 2,
              pointRadius: 2.5,
              pointHoverRadius: 4,
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
              borderWidth: 2.5,
              tension: 0.3,
              fill: true,
              pointRadius: 3,
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
              font: { family: 'Plus Jakarta Sans', weight: 600, size: 10 },
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            padding: 10,
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            titleFont: { family: 'Plus Jakarta Sans', weight: 'bold', size: 11 },
            bodyFont: { family: 'Plus Jakarta Sans', size: 10 },
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
            grid: { color: 'rgba(51, 65, 85, 0.15)' },
            ticks: {
              color: '#64748b',
              font: { family: 'Plus Jakarta Sans', weight: 500, size: 10 },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.15)' },
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
  }, [trajectory, chartMode]);

  if (targetDeals.length === 0) return null;

  const content = (
    <div className="h-full flex flex-col justify-between">
      {/* Controls Bar: Mode Switcher on left, Milestone Badges on right */}
      <div className="flex items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/70">
        <div className="inline-flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setChartMode('equity')}
            className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
              chartMode === 'equity'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Equity
          </button>
          <button
            type="button"
            onClick={() => setChartMode('cashflow')}
            className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
              chartMode === 'cashflow'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Cash Flow
          </button>
        </div>

        {/* Milestone Badges */}
        <div className="flex items-center space-x-2">
          <div className="bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg">
            <span className="text-[8px] uppercase font-bold text-slate-500 block leading-tight">5-Yr Equity</span>
            <div className="flex items-center space-x-1">
              <span className="text-xs font-black text-white font-mono tabular-nums">
                {formatCurrency(y5.netEquity)}
              </span>
              {eq5GrowthPct > 0 && (
                <span className="text-[9px] font-bold text-emerald-400 font-mono">
                  (+{eq5GrowthPct.toFixed(0)}%)
                </span>
              )}
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg hidden sm:block">
            <span className="text-[8px] uppercase font-bold text-slate-500 block leading-tight">10-Yr Equity</span>
            <div className="flex items-center space-x-1">
              <span className="text-xs font-black text-white font-mono tabular-nums">
                {formatCurrency(y10.netEquity)}
              </span>
              {eq10GrowthPct > 0 && (
                <span className="text-[9px] font-bold text-emerald-400 font-mono">
                  (+{eq10GrowthPct.toFixed(0)}%)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="w-full flex-1 min-h-[190px] pt-2">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm transition-all duration-200 p-4">
      {content}
    </div>
  );
};
