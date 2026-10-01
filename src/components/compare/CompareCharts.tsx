import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { ComparisonColumn } from '../../lib/compare/compareTypes';
import { formatCurrency } from '../../lib/format';

Chart.register(...registerables);

interface CompareChartsProps {
  columns: ComparisonColumn[];
}

const PALETTE = [
  { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.2)' }, // Emerald
  { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.2)' },  // Cyan
  { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.2)' }, // Violet
  { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.2)' }, // Amber
  { stroke: '#f43f5e', fill: 'rgba(244, 63, 94, 0.2)' },  // Rose
];

export const CompareCharts: React.FC<CompareChartsProps> = ({ columns }) => {
  const returnsCanvasRef = useRef<HTMLCanvasElement>(null);
  const trajectoryCanvasRef = useRef<HTMLCanvasElement>(null);
  const capitalCanvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Returns Comparison Chart (IRR vs CoC)
  useEffect(() => {
    const canvas = returnsCanvasRef.current;
    if (!canvas || columns.length === 0) return;

    const labels = columns.map((c) => `${c.dealTitle}\n(${c.scenarioName})`);
    const irrData = columns.map((c) => +(c.summary.irr || 0).toFixed(2));
    const cocData = columns.map((c) => +(c.summary.cashOnCashYear1 || 0).toFixed(2));

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '10-Yr Levered IRR (%)',
            data: irrData,
            backgroundColor: '#10b981',
            borderRadius: 6,
          },
          {
            label: 'Yr 1 Cash-on-Cash (%)',
            data: cocData,
            backgroundColor: '#06b6d4',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 } },
          },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 10, weight: 600 } },
          },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#64748b',
              callback: (v) => `${v}%`,
            },
          },
        },
      },
    });

    return () => { chart.destroy(); };
  }, [columns]);

  // 2. 10-Year Cumulative Cash Flow Line Chart
  useEffect(() => {
    const canvas = trajectoryCanvasRef.current;
    if (!canvas || columns.length === 0) return;

    const yearsCount = Math.max(1, ...columns.map((c) => c.metrics?.projections?.length || 10));
    const labels = Array.from({ length: Math.min(10, yearsCount) }, (_, i) => `Yr ${i + 1}`);

    const datasets = columns.map((col, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      let accum = 0;
      const data = labels.map((_, yearIdx) => {
        const p: any = col.metrics?.projections?.[yearIdx];
        if (p) accum += Number(p.cashFlow) || 0;
        return Math.round(accum);
      });

      return {
        label: `${col.dealTitle} (${col.scenarioName})`,
        data,
        borderColor: color.stroke,
        backgroundColor: color.fill,
        borderWidth: 2.5,
        tension: 0.3,
        fill: false,
      };
    });

    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 } },
          },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y as number)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(51, 65, 85, 0.15)' },
            ticks: { color: '#94a3b8' },
          },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#64748b',
              callback: (v) => formatCurrency(Number(v)),
            },
          },
        },
      },
    });

    return () => { chart.destroy(); };
  }, [columns]);

  // 3. Capital Stack & Financing Basis (Stacked Bar: Equity vs Senior Debt)
  useEffect(() => {
    const canvas = capitalCanvasRef.current;
    if (!canvas || columns.length === 0) return;

    const labels = columns.map((c) => `${c.dealTitle}\n(${c.scenarioName})`);
    const equityData = columns.map((c) => Math.round(c.summary.initialCash || 0));
    const debtData = columns.map((c) => Math.round(c.summary.loanAmount || 0));

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Initial Cash Equity',
            data: equityData,
            backgroundColor: '#10b981',
            borderRadius: 4,
          },
          {
            label: 'Senior Debt Financed',
            data: debtData,
            backgroundColor: '#3b82f6',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 } },
          },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y as number)}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 10, weight: 600 } },
          },
          y: {
            stacked: true,
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#64748b',
              callback: (v) => formatCurrency(Number(v)),
            },
          },
        },
      },
    });

    return () => { chart.destroy(); };
  }, [columns]);

  return (
    <div className="space-y-6">
      {/* Chart 1: Returns Benchmark */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
              <span>Returns &amp; Yield Benchmark</span>
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                IRR vs CoC
              </span>
            </h3>
            <p className="text-xs text-slate-400">Comparing 10-year levered return with upfront cash-on-cash dividend</p>
          </div>
        </div>
        <div className="h-72 w-full pt-2">
          <canvas ref={returnsCanvasRef} />
        </div>
      </div>

      {/* Chart 2: Cumulative Cash Flow Trajectories */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
              <span>10-Year Cumulative Cash Flow Trajectory</span>
              <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded-full">
                Growth Curve
              </span>
            </h3>
            <p className="text-xs text-slate-400">Scheduled aggregate liquidity generated by each asset over time</p>
          </div>
        </div>
        <div className="h-72 w-full pt-2">
          <canvas ref={trajectoryCanvasRef} />
        </div>
      </div>

      {/* Chart 3: Capital Stack */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-white flex items-center space-x-2">
              <span>Capital Stack &amp; Leverage Exposure</span>
              <span className="text-[10px] font-bold text-violet-400 bg-violet-950/60 border border-violet-800/40 px-2 py-0.5 rounded-full">
                Equity vs Debt
              </span>
            </h3>
            <p className="text-xs text-slate-400">Initial equity required vs total debt obligations financed</p>
          </div>
        </div>
        <div className="h-72 w-full pt-2">
          <canvas ref={capitalCanvasRef} />
        </div>
      </div>
    </div>
  );
};
