import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import type { DealMetrics } from '../../lib/math/types';
import { formatCurrency } from '../../lib/format';
import { DSCR_REFERENCE, coverageSeries, equityGrowth, incomeBreakdown, paybackYear } from '../../lib/studio/dealCharts';

Chart.register(...registerables);

interface DealChartsProps {
  metrics: DealMetrics;
  startYear: number;
  /** Year (1-based) the income breakdown opens on. */
  defaultYear: number;
}

const TEXT = '#94a3b8';
const GRID = 'rgba(51, 65, 85, 0.2)';
const FONT = { family: 'Plus Jakarta Sans', weight: 600 as const, size: 11 };
const tooltip = { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, padding: 10 };
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v}`);

const Card: React.FC<{ title: string; question: string; children: React.ReactNode; aside?: React.ReactNode }> = ({ title, question, children, aside }) => (
  <section className="bg-slate-900/40 border border-slate-900 p-4 sm:p-5 rounded-2xl shadow-xl space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-white tracking-tight">{title}</h3>
        <p className="text-xs text-slate-400">{question}</p>
      </div>
      {aside}
    </div>
    {children}
  </section>
);

/** A chart on its own canvas, rebuilt when its config changes. */
function useChart(build: (canvas: HTMLCanvasElement) => Chart | null, deps: React.DependencyList) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = build(ref.current);
    return () => { chart?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export const DealCharts: React.FC<DealChartsProps> = ({ metrics, startYear, defaultYear }) => {
  const projections = (metrics.projections ?? []) as Array<Record<string, any>>;
  const years = projections.length;
  const [year, setYear] = useState(() => Math.min(Math.max(1, defaultYear), Math.max(1, years)));

  const breakdown = useMemo(() => incomeBreakdown(projections[year - 1]), [projections, year]);
  const invested = Number(metrics.initialCashInvested ?? metrics.initialEquity ?? 0);
  const growth = useMemo(() => equityGrowth(projections, Number(metrics.purchasePrice) || 0, Number(metrics.loanAmount) || 0, invested), [projections, metrics.purchasePrice, metrics.loanAmount, invested]);
  const payback = useMemo(() => paybackYear(growth, invested), [growth, invested]);
  const coverage = useMemo(() => coverageSeries(projections), [projections]);
  const hasDebt = coverage.some((c) => c.debtService > 0);
  const last = growth[growth.length - 1];

  const donutRef = useChart((canvas) => {
    if (breakdown.slices.length === 0) return null;
    return new Chart(canvas, {
      type: 'doughnut',
      data: { labels: breakdown.slices.map((s) => s.label), datasets: [{ data: breakdown.slices.map((s) => Math.round(s.value)), backgroundColor: breakdown.slices.map((s) => s.color), borderColor: '#0f172a', borderWidth: 2 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: {
          // A tooltip is drawn inside the chart's own box, so it must be short: the name on top, the dollars and share below
          title: (items) => String(items[0]?.label ?? '').split(' (')[0],
          label: (ctx) => `${formatCurrency(ctx.parsed)} (${breakdown.gross > 0 ? Math.round((ctx.parsed / breakdown.gross) * 100) : 0}% of rent)`,
        } } },
      },
    });
  }, [breakdown]);

  const equityRef = useChart((canvas) => new Chart(canvas, {
    type: 'line',
    data: {
      labels: growth.map((g) => (g.year === 0 ? 'Purchase' : `${startYear + g.year - 1}`)),
      datasets: [
        { label: 'Equity (value less loan)', data: growth.map((g) => Math.round(g.equity)), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.35)', fill: true, stack: 'built', tension: 0.25, borderWidth: 2, pointRadius: 0 },
        { label: 'Cash collected', data: growth.map((g) => Math.round(g.cumulativeCash)), borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.35)', fill: true, stack: 'built', tension: 0.25, borderWidth: 2, pointRadius: 0 },
        { label: 'Cash you put in (rises when you cover a shortfall)', data: growth.map((g) => Math.round(g.cashIn)), borderColor: '#f59e0b', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: TEXT, font: FONT, usePointStyle: true, boxWidth: 8 } }, tooltip: { ...tooltip, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y))}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans', weight: 500 }, maxTicksLimit: 8, maxRotation: 0 } },
        y: { stacked: true, grid: { color: GRID }, ticks: { color: '#64748b', callback: (v) => compact(Number(v)) } },
      },
    },
  }), [growth, invested, startYear]);

  const coverageRef = useChart((canvas) => {
    if (!hasDebt) return null;
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: coverage.map((c) => `${startYear + c.year - 1}`),
        datasets: [
          { type: 'bar', label: 'Net operating income', data: coverage.map((c) => Math.round(c.noi)), backgroundColor: '#10b981', borderRadius: 4, yAxisID: 'y' },
          { type: 'bar', label: 'Loan payments', data: coverage.map((c) => Math.round(c.debtService)), backgroundColor: '#f43f5e', borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Coverage (x)', data: coverage.map((c) => c.dscr), borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderWidth: 2.5, tension: 0.25, pointRadius: 3, yAxisID: 'y1' },
          { type: 'line', label: `${DSCR_REFERENCE}x lender target`, data: coverage.map(() => DSCR_REFERENCE), borderColor: 'rgba(245, 158, 11, 0.5)', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: TEXT, font: FONT, usePointStyle: true, boxWidth: 8 } },
          tooltip: { ...tooltip, callbacks: { label: (ctx) => (ctx.dataset.yAxisID === 'y1' ? `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)}x` : `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y))}`) } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans', weight: 500 }, maxRotation: 0 } },
          y: { grid: { color: GRID }, ticks: { color: '#64748b', callback: (v) => compact(Number(v)) } },
          y1: { position: 'right', grid: { display: false }, ticks: { color: '#b45309', callback: (v) => `${v}x` }, suggestedMin: 0 },
        },
      },
    });
  }, [coverage, hasDebt, startYear]);

  if (years === 0) return null;
  const minDscr = hasDebt ? Math.min(...coverage.filter((c) => c.dscr !== null).map((c) => c.dscr as number)) : null;
  const pct = (v: number) => (breakdown.gross > 0 ? `${Math.round((v / breakdown.gross) * 100)}%` : '');

  return (
    <div className="space-y-4" aria-label="Deal charts">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900/50 border border-slate-900 rounded-2xl p-4">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Value built by year {years}</span>
          <span className="block text-xl font-black text-emerald-400 tabular-nums mt-1">{formatCurrency(Math.round(last.total))}</span>
          <span className="text-[11px] text-slate-400">{formatCurrency(Math.round(last.equity))} equity + {formatCurrency(Math.round(last.cumulativeCash))} cash received</span>
        </div>
        <div className="bg-slate-900/50 border border-slate-900 rounded-2xl p-4">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Pays back your cash</span>
          <span className="block text-xl font-black text-white tabular-nums mt-1">{invested <= 0 ? 'No cash in' : payback ? `Year ${payback}` : `After year ${years}`}</span>
          <span className="text-[11px] text-slate-400">{formatCurrency(Math.round(invested))} at purchase{last.cashIn - invested > 0.5 ? ` + ${formatCurrency(Math.round(last.cashIn - invested))} to cover shortfalls = ${formatCurrency(Math.round(last.cashIn))} in by year ${years}` : ''}</span>
        </div>
        <div className="bg-slate-900/50 border border-slate-900 rounded-2xl p-4">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Tightest loan coverage</span>
          <span className={`block text-xl font-black tabular-nums mt-1 ${minDscr !== null && minDscr < 1 ? 'text-rose-400' : minDscr !== null && minDscr < DSCR_REFERENCE ? 'text-amber-400' : 'text-white'}`}>{minDscr === null ? 'No loan' : `${minDscr.toFixed(2)}x`}</span>
          <span className="text-[11px] text-slate-400">{minDscr === null ? 'All cash purchase' : minDscr < 1 ? 'Income does not cover the loan in some year' : `Lenders usually want ${DSCR_REFERENCE}x or more`}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Where each rent dollar goes"
          question={`Year ${year} (${startYear + year - 1}): what happens to ${formatCurrency(Math.round(breakdown.gross))} of gross rent`}
          aside={
            <label className="text-[11px] text-slate-400 flex items-center gap-2 shrink-0">
              Year
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-bold text-emerald-300 focus:outline-none">
                {projections.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
          }
        >
          {breakdown.slices.length === 0 ? (
            <p className="text-xs text-slate-500 py-10 text-center">No rent is modeled for this year.</p>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Wider than the ring so the tooltip has room beside it; the ring stays centred and the same size */}
              <div className="relative h-48 w-60 shrink-0">
                <canvas ref={donutRef} role="img" aria-label={`Breakdown of year ${year} gross rent`} />
              </div>
              <ul className="flex-1 w-full space-y-1.5">
                {breakdown.slices.map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 text-slate-300">{s.label}</span>
                    <span className="font-bold text-slate-100 tabular-nums">{formatCurrency(Math.round(s.value))}</span>
                    <span className="w-9 text-right text-slate-500 tabular-nums">{pct(s.value)}</span>
                  </li>
                ))}
                {breakdown.shortfall > 0 && <li className="text-[11px] text-rose-400 pt-1">The deal costs you {formatCurrency(Math.round(breakdown.shortfall))} out of pocket this year.</li>}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Value you are building" question="Equity in the property plus cash collected, against the cash you put in">
          <div className="h-56 w-full"><canvas ref={equityRef} role="img" aria-label="Equity and cash collected over time" /></div>
        </Card>
      </div>

      {hasDebt && (
        <Card title="Can the building carry its loan?" question="Income against loan payments each year, with coverage on the right">
          <div className="h-64 w-full"><canvas ref={coverageRef} role="img" aria-label="Net operating income against loan payments" /></div>
        </Card>
      )}
    </div>
  );
};
