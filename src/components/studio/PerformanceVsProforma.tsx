import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DealMetrics, DealRecord } from '../../lib/math/types';
import { compareToBaseline, type BaselineRow, type HeadlineRow, type LeaseLite, type PaymentLite } from '../../lib/baselines/core';
import { ensureBaseline, getInitialBaseline, loadActuals, rebaseline } from '../../lib/baselines/db';
import { formatCurrency } from '../../lib/format';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
}

const fmt = (v: number | null, kind: HeadlineRow['kind']): string => {
  if (v === null) return '—';
  if (kind === 'currency') return formatCurrency(v);
  if (kind === 'pct') return `${v.toFixed(2)}%`;
  return `${v.toFixed(2)}x`;
};

const fmtDelta = (v: number | null, kind: HeadlineRow['kind']): string => {
  if (v === null) return '';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (kind === 'currency') return `${sign}${formatCurrency(a)}`;
  if (kind === 'pct') return `${sign}${a.toFixed(2)} pts`;
  return `${sign}${a.toFixed(2)}x`;
};

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};

/**
 * "When we bought it, what did we expect it to produce, and how are we actually doing?"
 * Expected = the frozen baseline captured at acquisition. Current outlook = today's inputs run through the live engine.
 * Actual = the rent roll and payments. Only the baseline is stored; everything else is computed here.
 */
export const PerformanceVsProforma: React.FC<Props> = ({ deal, metrics }) => {
  const [baseline, setBaseline] = useState<BaselineRow | null>(null);
  const [leases, setLeases] = useState<LeaseLite[]>([]);
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    await ensureBaseline(deal);
    const [b, actuals] = await Promise.all([getInitialBaseline(deal.id), loadActuals(deal.id, new Date().getFullYear() - 1)]);
    setBaseline(b);
    setLeases(actuals.leases);
    setPayments(actuals.payments);
    setLoading(false);
  }, [deal]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.status]);

  const cmp = useMemo(
    () => (baseline ? compareToBaseline({ baseline, live: metrics, payments, leases, deal }) : null),
    [baseline, metrics, payments, leases, deal],
  );

  const canRebaseline = !deal.is_shared && !deal.is_demo;
  const onRebaseline = async () => {
    if (!window.confirm('Replace the frozen baseline with today’s assumptions? The original expectation will be discarded.')) return;
    setBusy(true);
    await rebaseline(deal);
    await load();
    setBusy(false);
  };

  if (loading && !baseline) {
    return (
      <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl">
        <p className="text-xs text-slate-500">Loading performance vs pro-forma…</p>
      </div>
    );
  }
  if (!baseline || !cmp) return null;

  const captured = new Date(baseline.captured_at);
  const capturedStr = isNaN(captured.getTime()) ? '' : captured.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const collectedPct = cmp.expectedYtd > 0 ? (cmp.collectedYtd / cmp.expectedYtd) * 100 : null;
  const revenueGap = cmp.collectedYtd - cmp.expectedYtd;

  return (
    <div className="bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-900 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent-cyan"></span>
            <span>Performance vs Pro-Forma</span>
          </h3>
          <p className="text-xs text-slate-400">
            Projected = what we expect to happen. Actual = the income really coming in (payments and rent roll).
          </p>
        </div>
        <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400">
          <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
            Baseline frozen {capturedStr}
            {cmp.engineVersion ? ` • engine ${cmp.engineVersion}` : ' • earlier engine'}
          </span>
          {canRebaseline && (
            <button
              type="button"
              onClick={onRebaseline}
              disabled={busy}
              className="px-2 py-0.5 rounded border border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 transition disabled:opacity-50"
              title="Discard the frozen baseline and capture today's assumptions"
            >
              {busy ? 'Working…' : 'Re-baseline'}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-900">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/80 text-slate-400">
            <tr>
              <th className="py-2 px-3 font-semibold">Metric</th>
              <th className="py-2 px-3 font-semibold">Projected at purchase</th>
              <th className="py-2 px-3 font-semibold">Projected now (current assumptions)</th>
              <th className="py-2 px-3 font-semibold">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/60">
            {cmp.headline.map((h) => {
              const tone = h.delta === null || Math.abs(h.delta) < 0.005 ? 'text-slate-400' : h.delta > 0 ? 'text-emerald-400' : 'text-rose-400';
              return (
                <tr key={h.key} className="hover:bg-slate-900/30 transition">
                  <td className="py-2 px-3 font-semibold text-slate-300">{h.label}</td>
                  <td className="py-2 px-3 font-mono text-slate-200">{fmt(h.expected, h.kind)}</td>
                  <td className="py-2 px-3 font-mono font-bold text-white">{fmt(h.current, h.kind)}</td>
                  <td className={`py-2 px-3 font-mono font-bold ${tone}`}>{fmtDelta(h.delta, h.kind) || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cmp.replayed && (
        <p className="text-[10px] text-slate-500">
          IRR and equity multiple: the purchase-time price, rent, loan and costs, run on {cmp.planChanged ? 'your current exit plan' : 'today'}'s engine so the two columns are comparable. NOI, cash flow, cash-on-cash and DSCR are the figures frozen at purchase.
        </p>
      )}

      {cmp.hasYearDetail ? (
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-white flex items-center space-x-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Actual performance: income coming in</span>
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Last 12 months: projected</p>
              <p className="text-base font-extrabold text-white mt-1">{formatCurrency(cmp.trailing12.expected)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Last 12 months: contractual</p>
              <p className="text-base font-extrabold text-white mt-1">{formatCurrency(cmp.trailing12.contractual)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Last 12 months: actual collected</p>
              <p className="text-base font-extrabold text-brand-400 mt-1">{formatCurrency(cmp.trailing12.collected)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Actual vs projected</p>
              <p className={`text-base font-extrabold mt-1 ${cmp.trailing12.collected - cmp.trailing12.expected >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {cmp.trailing12.expected > 0 ? `${((cmp.trailing12.collected / cmp.trailing12.expected) * 100).toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Projected rent {cmp.year} YTD</p>
              <p className="text-base font-extrabold text-white mt-1">{formatCurrency(cmp.expectedYtd)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Contractual rent YTD</p>
              <p className="text-base font-extrabold text-white mt-1">{formatCurrency(cmp.contractualYtd)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Actual collected YTD</p>
              <p className="text-base font-extrabold text-brand-400 mt-1">{formatCurrency(cmp.collectedYtd)}</p>
            </div>
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Actual vs projected</p>
              <p className={`text-base font-extrabold mt-1 ${revenueGap >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {collectedPct === null ? '—' : `${collectedPct.toFixed(1)}%`}
                <span className="text-[10px] font-mono font-normal text-slate-400 ml-1.5">
                  ({revenueGap >= 0 ? '+' : '-'}{formatCurrency(Math.abs(revenueGap))})
                </span>
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-900">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-950/80 text-slate-400">
                <tr>
                  <th className="py-2 px-3 font-semibold">Month</th>
                  <th className="py-2 px-3 font-semibold">Projected</th>
                  <th className="py-2 px-3 font-semibold">Contractual</th>
                  <th className="py-2 px-3 font-semibold">Actual collected</th>
                  <th className="py-2 px-3 font-semibold">Actual vs projected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60">
                {cmp.months.map((m) => {
                  const gap = m.collected - m.expected;
                  const settled = !m.isCurrent || m.collected > 0;
                  return (
                    <tr key={m.month} className="hover:bg-slate-900/30 transition">
                      <td className="py-2 px-3 font-semibold text-slate-300">
                        {monthLabel(m.month)}
                        {m.isCurrent && <span className="ml-1.5 text-[9px] text-slate-500 uppercase">current</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-200">{m.expected > 0 ? formatCurrency(m.expected) : '—'}</td>
                      <td className="py-2 px-3 font-mono text-slate-200">{m.contractual > 0 ? formatCurrency(m.contractual) : '—'}</td>
                      <td className="py-2 px-3 font-mono font-bold text-white">{m.collected > 0 ? formatCurrency(m.collected) : '—'}</td>
                      <td className={`py-2 px-3 font-mono font-bold ${!settled || m.expected === 0 ? 'text-slate-500' : gap >= -0.5 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {!settled || m.expected === 0 ? '—' : `${gap >= 0 ? '+' : '-'}${formatCurrency(Math.abs(gap))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 bg-slate-950/40 p-2.5 rounded-xl border border-slate-900">
          This baseline was captured before year-by-year projections were recorded, so only the headline comparison is shown.
          Use Re-baseline to capture today&apos;s pro-forma with full detail.
        </p>
      )}
    </div>
  );
};
