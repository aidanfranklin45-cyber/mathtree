import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { Download } from 'lucide-react';
import { ComparisonColumn } from '../../lib/compare/compareTypes';
import { formatCurrency } from '../../lib/format';
import { ALL_METRICS, getMetric } from '../../lib/compare/metrics';
import { cashFlowSeries, cashInSeries, metricValues, paybackYear, riskReturnPoints, seriesColor, shortfallTotal, wealthSeries, yearLabels } from '../../lib/compare/chartData';

Chart.register(...registerables);

interface CompareChartsProps {
  columns: ComparisonColumn[];
  metricKeys: string[];
}

type ChartKind = 'returns' | 'cashflow' | 'wealth' | 'capital' | 'risk' | 'metric';

const KINDS: Array<{ id: ChartKind; label: string; blurb: string }> = [
  { id: 'returns', label: 'Returns', blurb: '10-year levered IRR next to year 1 cash-on-cash for each column.' },
  { id: 'cashflow', label: 'Cash flow', blurb: 'What each column pays you, year by year or as a running total.' },
  { id: 'wealth', label: 'Wealth built', blurb: 'Equity plus cash collected, minus the cash you put in (including any shortfalls you have to cover). Where a line crosses zero, the deal has paid you back.' },
  { id: 'capital', label: 'Capital stack', blurb: 'Cash equity against borrowed money for each column, plus any extra cash the deal needs to cover years that do not pay their own costs.' },
  { id: 'risk', label: 'Risk vs return', blurb: 'Leverage across, IRR up, bubble size by price. Top left is more return for less borrowing.' },
  { id: 'metric', label: 'Any metric', blurb: 'Rank every column on one metric of your choice, or see how far each is from the benchmark.' },
];

const TEXT = '#94a3b8';
const GRID = 'rgba(51, 65, 85, 0.25)';
const FONT = { family: 'Plus Jakarta Sans', weight: 600 as const, size: 11 };
const money = (v: unknown) => formatCurrency(Number(v));

const label = (c: ComparisonColumn) => `${c.dealTitle} (${c.scenarioName})`;

const baseOptions = (yFmt: (v: unknown) => string, extra?: Record<string, any>) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { labels: { color: TEXT, font: FONT, usePointStyle: true, boxWidth: 8 } },
    tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10 },
  },
  scales: {
    x: { grid: { color: GRID }, ticks: { color: TEXT, font: { ...FONT, size: 10 } } },
    y: { grid: { color: GRID }, ticks: { color: '#64748b', callback: (v: unknown) => yFmt(v) } },
  },
  ...extra,
});

export const CompareCharts: React.FC<CompareChartsProps> = ({ columns, metricKeys }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [kind, setKind] = useState<ChartKind>('returns');
  const [cfMode, setCfMode] = useState<'annual' | 'cumulative'>('cumulative');
  const [metricKey, setMetricKey] = useState<string>(metricKeys.includes('irr') ? 'irr' : metricKeys[0] ?? 'irr');
  const [metricMode, setMetricMode] = useState<'absolute' | 'vs-benchmark'>('absolute');
  const [sortBars, setSortBars] = useState(true);

  const metricOptions = useMemo(() => {
    const picked = metricKeys.map(getMetric).filter((m): m is NonNullable<typeof m> => !!m);
    return picked.length ? picked : ALL_METRICS;
  }, [metricKeys]);
  const metric = getMetric(metricKey) ?? metricOptions[0];

  const years = Math.min(10, Math.max(1, ...columns.map((c) => (c.metrics?.projections?.length ?? 0) || 10)));
  const wealth = useMemo(() => columns.map((c) => wealthSeries(c, years)), [columns, years]);
  // Cash put in along the way, shortfalls included, so a deal that has to be topped up shows what it really costs
  const cashIn = useMemo(() => columns.map((c) => cashInSeries(c, years)), [columns, years]);
  const shortfalls = useMemo(() => columns.map((c) => shortfallTotal(c, years)), [columns, years]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || columns.length === 0) return;
    let config: ChartConfiguration;

    if (kind === 'returns') {
      config = {
        type: 'bar',
        data: {
          labels: columns.map(label),
          datasets: [
            { label: '10-Yr Levered IRR (%)', data: columns.map((c) => +(c.summary.irr || 0).toFixed(2)), backgroundColor: '#10b981', borderRadius: 6 },
            { label: 'Yr 1 Cash-on-Cash (%)', data: columns.map((c) => +(c.summary.cashOnCashYear1 || 0).toFixed(2)), backgroundColor: '#06b6d4', borderRadius: 6 },
          ],
        },
        options: baseOptions((v) => `${v}%`, { plugins: { legend: { labels: { color: TEXT, font: FONT } }, tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10, callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y}%` } } } }),
      };
    } else if (kind === 'cashflow') {
      const labels = yearLabels(columns);
      config = {
        type: cfMode === 'annual' ? 'bar' : 'line',
        data: {
          labels,
          datasets: columns.map((c, i) => ({
            label: label(c),
            data: cashFlowSeries(c, labels.length, cfMode),
            borderColor: seriesColor(i),
            backgroundColor: cfMode === 'annual' ? seriesColor(i) : `${seriesColor(i)}33`,
            borderWidth: 2.5,
            tension: 0.3,
            borderRadius: 4,
          })) as any,
        },
        options: baseOptions(money, { plugins: { legend: { labels: { color: TEXT, font: FONT, usePointStyle: true, boxWidth: 8 } }, tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10, callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}` } } } }),
      };
    } else if (kind === 'wealth') {
      config = {
        type: 'line',
        data: {
          labels: yearLabels(columns, true),
          datasets: columns.map((c, i) => ({ label: label(c), data: wealth[i], borderColor: seriesColor(i), backgroundColor: `${seriesColor(i)}22`, borderWidth: 2.5, tension: 0.25, pointRadius: 2 })) as any,
        },
        options: baseOptions(money, { plugins: { legend: { labels: { color: TEXT, font: FONT, usePointStyle: true, boxWidth: 8 } }, tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10, callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}`,
          // The line is net of the cash you put in; say how much that is by this year, shortfalls included
          afterLabel: (ctx: any) => { const v = cashIn[ctx.datasetIndex]?.[ctx.dataIndex]; return v == null ? '' : `Cash you have put in: ${money(v)}`; },
        } } } }),
      };
    } else if (kind === 'capital') {
      config = {
        type: 'bar',
        data: {
          labels: columns.map(label),
          datasets: [
            { label: 'Initial Cash Equity', data: columns.map((c) => Math.round(c.summary.initialCash || 0)), backgroundColor: '#10b981', borderRadius: 4 },
            ...(shortfalls.some((s) => s > 0) ? [{ label: 'More cash to cover shortfalls (over the hold)', data: shortfalls, backgroundColor: '#f59e0b', borderRadius: 4 }] : []),
            { label: 'Senior Debt Financed', data: columns.map((c) => Math.round(c.summary.loanAmount || 0)), backgroundColor: '#3b82f6', borderRadius: 4 },
          ],
        },
        options: {
          ...baseOptions(money),
          scales: { x: { stacked: true, grid: { display: false }, ticks: { color: TEXT, font: { ...FONT, size: 10 } } }, y: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: (v: unknown) => money(v) } } },
          plugins: { legend: { labels: { color: TEXT, font: FONT } }, tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10, callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}` } } },
        } as any,
      };
    } else if (kind === 'risk') {
      const pts = riskReturnPoints(columns);
      config = {
        type: 'bubble',
        data: { datasets: pts.map((p) => ({ label: p.label, data: [{ x: p.x, y: p.y, r: p.r }], backgroundColor: `${seriesColor(p.index)}99`, borderColor: seriesColor(p.index), borderWidth: 2 })) as any },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: TEXT, font: FONT, usePointStyle: true, boxWidth: 8 } },
            tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10, callbacks: { label: (ctx: any) => `${ctx.dataset.label}: IRR ${ctx.parsed.y}%, LTV ${ctx.parsed.x}%` } },
          },
          scales: {
            x: { title: { display: true, text: 'Loan-to-value (%)', color: TEXT }, grid: { color: GRID }, ticks: { color: '#64748b', callback: (v: unknown) => `${v}%` }, suggestedMin: 0 },
            y: { title: { display: true, text: '10-year levered IRR (%)', color: TEXT }, grid: { color: GRID }, ticks: { color: '#64748b', callback: (v: unknown) => `${v}%` } },
          },
        } as any,
      };
    } else {
      const vals = metricValues(columns, metric, metricMode);
      const order = columns.map((_, i) => i);
      if (sortBars) {
        order.sort((a, b) => {
          const av = vals[a];
          const bv = vals[b];
          if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
          return metric.lowerBetter ? av - bv : bv - av;
        });
      }
      const fmt = (v: unknown) => (metricMode === 'vs-benchmark' ? `${Number(v) > 0 ? '+' : ''}${metric.format(Number(v))}` : metric.format(Number(v)));
      config = {
        type: 'bar',
        data: {
          labels: order.map((i) => label(columns[i])),
          datasets: [{ label: metricMode === 'vs-benchmark' ? `${metric.short}: change vs benchmark` : metric.label, data: order.map((i) => vals[i]), backgroundColor: order.map((i) => seriesColor(i)), borderRadius: 6 }],
        },
        options: {
          ...baseOptions((v) => fmt(v)),
          indexAxis: columns.length > 4 ? 'y' : 'x',
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10, callbacks: { label: (ctx: any) => fmt(ctx.parsed[columns.length > 4 ? 'x' : 'y']) } } },
        } as any,
      };
    }

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, config);
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [columns, kind, cfMode, metric, metricMode, sortBars, wealth, cashIn, shortfalls]);

  const download = () => {
    const src = canvasRef.current;
    if (!src) return;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `mathtree-compare-${kind}.png`;
    a.click();
  };

  const active = KINDS.find((k) => k.id === kind)!;
  const seg = (on: boolean) => `px-3 py-2 rounded-lg text-xs font-bold transition min-h-[36px] ${on ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`;

  if (columns.length === 0) return null;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="tablist" aria-label="Chart type">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} onClick={() => setKind(k.id)} className={`px-3.5 py-2.5 rounded-xl text-xs font-bold border whitespace-nowrap transition min-h-[40px] ${kind === k.id ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white'}`}>{k.label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-slate-400 max-w-2xl">{active.blurb}</p>
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'cashflow' && (
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800" role="group" aria-label="Cash flow basis">
              <button type="button" className={seg(cfMode === 'annual')} aria-pressed={cfMode === 'annual'} onClick={() => setCfMode('annual')}>Each year</button>
              <button type="button" className={seg(cfMode === 'cumulative')} aria-pressed={cfMode === 'cumulative'} onClick={() => setCfMode('cumulative')}>Running total</button>
            </div>
          )}
          {kind === 'metric' && (
            <>
              <select value={metric.key} onChange={(e) => setMetricKey(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-emerald-300 focus:outline-none min-h-[40px]" aria-label="Metric">
                {metricOptions.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800" role="group" aria-label="Value basis">
                <button type="button" className={seg(metricMode === 'absolute')} aria-pressed={metricMode === 'absolute'} onClick={() => setMetricMode('absolute')}>Value</button>
                <button type="button" className={seg(metricMode === 'vs-benchmark')} aria-pressed={metricMode === 'vs-benchmark'} onClick={() => setMetricMode('vs-benchmark')}>vs benchmark</button>
              </div>
              <button type="button" onClick={() => setSortBars((s) => !s)} aria-pressed={sortBars} className={`px-3 py-2 rounded-xl text-xs font-bold border min-h-[40px] ${sortBars ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' : 'bg-slate-950 text-slate-300 border-slate-800'}`}>Best first</button>
            </>
          )}
          <button type="button" onClick={download} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-950 border border-slate-800 flex items-center gap-1.5 min-h-[40px]" title="Download this chart as an image">
            <Download className="w-3.5 h-3.5" /> PNG
          </button>
        </div>
      </div>

      <div className={`${kind === 'metric' && columns.length > 4 ? 'h-[28rem]' : 'h-80'} w-full`}>
        <canvas ref={canvasRef} role="img" aria-label={`${active.label} chart comparing ${columns.length} columns`} />
      </div>

      {kind === 'wealth' && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {columns.map((c, i) => {
            const pb = paybackYear(wealth[i]);
            return (
              <li key={c.id} className="rounded-xl bg-slate-950/60 border border-slate-900 px-3 py-2 flex items-center gap-2.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seriesColor(i) }} />
                <span className="min-w-0 flex-1 truncate text-slate-300">{label(c)}</span>
                <span className="font-bold text-slate-100 whitespace-nowrap">{pb ? `pays back in year ${pb}` : 'not within 10 years'}{shortfalls[i] > 0 ? ` · ${formatCurrency(shortfalls[i])} more cash needed` : ''}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
