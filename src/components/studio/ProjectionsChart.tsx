import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface Props {
  projections: Array<Record<string, any>>;
  startYear: number;
  type: 'cashflow' | 'valuation';
}

const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);

/** Same datasets, colors and axes as the legacy Chart.js projections visualizer. */
export const ProjectionsChart: React.FC<Props> = ({ projections, startYear, type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const labels = projections.map((p) => `${startYear + p.year - 1} (Yr ${p.year})`);
    const datasets = type === 'cashflow'
      ? [
          { label: 'Net Operating Income', data: projections.map((p) => p.netOperatingIncome), borderColor: '#059669', backgroundColor: 'rgba(5, 150, 105, 0.15)', borderWidth: 2, tension: 0.3, fill: true },
          { label: 'Cash Flow', data: projections.map((p) => p.cashFlow), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.25)', borderWidth: 3, tension: 0.3, fill: true },
        ]
      : [
          { label: 'Property Value', data: projections.map((p) => p.propertyValue), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, tension: 0.2, fill: true },
          { label: 'Equity', data: projections.map((p) => p.equity), borderColor: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.25)', borderWidth: 2, tension: 0.2, fill: true },
          { label: 'Remaining Loan Balance', data: projections.map((p) => p.loanBalanceRemaining ?? p.endingLoanBalance), borderColor: '#f43f5e', backgroundColor: 'rgba(244, 63, 94, 0.05)', borderWidth: 2, tension: 0.2, fill: true },
        ];

    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 } } },
          tooltip: {
            padding: 12,
            backgroundColor: '#0f172a',
            titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
            bodyFont: { family: 'Plus Jakarta Sans' },
            borderColor: '#334155',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${ctx.parsed.y !== null ? money(ctx.parsed.y as number) : ''}`,
            },
          },
        },
        scales: {
          x: { grid: { color: 'rgba(51, 65, 85, 0.15)' }, ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans', weight: 500 }, autoSkip: true, maxTicksLimit: 15, maxRotation: 0 } },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.15)' },
            ticks: {
              color: '#64748b',
              font: { family: 'Plus Jakarta Sans', weight: 500 },
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
    return () => chart.destroy();
  }, [projections, startYear, type]);

  return <canvas ref={canvasRef} />;
};
