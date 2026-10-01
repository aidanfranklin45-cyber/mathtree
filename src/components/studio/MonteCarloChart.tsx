import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { MonteCarloHistogramBin } from '../../lib/engine';

Chart.register(...registerables);

/** Distribution of a simulated outcome (IRR or dollar profit): purple core bins, rose end bars (outcomes outside the 1st to 99th percentile). */
export const MonteCarloChart: React.FC<{ bins: MonteCarloHistogramBin[]; runs: number; metric?: 'irr' | 'profit' }> = ({ bins, runs, metric = 'irr' }) => {
  const axisTitle = metric === 'profit' ? 'Net Profit Over the Hold ($)' : 'Total Hold Period IRR (%)';
  const tipTitle = metric === 'profit' ? 'Net profit' : 'Total Hold IRR';
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: bins.map((b) => b.label || `${b.binStart} to ${b.binEnd}`),
        datasets: [{
          label: 'Frequency (Number of Runs)',
          data: bins.map((b) => b.count),
          backgroundColor: bins.map((b) => (b.isTail ? 'rgba(244, 63, 94, 0.65)' : 'rgba(139, 92, 246, 0.65)')),
          borderColor: bins.map((b) => (b.isTail ? '#fb7185' : '#a78bfa')),
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600 } } },
          tooltip: {
            callbacks: {
              title: (items) => `${tipTitle}: ${bins[items[0]?.dataIndex]?.label || items[0]?.label || ''}`,
              label: (ctx) => `Frequency: ${ctx.raw} runs (out of ${runs.toLocaleString()})${bins[ctx.dataIndex]?.isTail ? ' (outside the 1st to 99th percentile)' : ''}`,
            },
          },
        },
        scales: {
          x: { grid: { color: 'rgba(51, 65, 85, 0.15)' }, ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans' } }, title: { display: true, text: axisTitle, color: '#64748b', font: { size: 10, weight: 'bold' } } },
          y: { grid: { color: 'rgba(51, 65, 85, 0.15)' }, ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans' } }, title: { display: true, text: 'Runs', color: '#64748b', font: { size: 10, weight: 'bold' } } },
        },
      },
    });
    return () => chart.destroy();
  }, [bins, runs, metric]);

  return <canvas ref={ref} />;
};
