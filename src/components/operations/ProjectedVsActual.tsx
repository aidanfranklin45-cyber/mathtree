import React, { useMemo, useState } from 'react';
import type { Row } from '../../lib/operations/rentRoll';

interface Props {
  deals: Row[];
  leases: Row[];
  baselines: Row[];
}

interface Line { id: string; title: string; note: string; proj: number; actual: number; varUsd: number; varPct: number }

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}`;

/** Underwriting review: what each property rents for today vs. what we expected at purchase. Collapsed by default. */
export const ProjectedVsActual: React.FC<Props> = ({ deals, leases, baselines }) => {
  const [open, setOpen] = useState(false);

  const lines = useMemo<Line[]>(() => deals.map((deal) => {
    const actual = leases
      .filter((l) => String(l.deal_id) === String(deal.id) && l.is_active !== false)
      .reduce((s, l) => s + (parseFloat(l.monthly_rent) || 0), 0);
    // Expected = the frozen baseline captured at acquisition; deals without one fall back to today's pro-forma
    const baseline = baselines.find((b) => String(b.deal_id) === String(deal.id) && b.baseline_type === 'initial_underwriting');
    const inputs = deal.inputs || {};
    const projAnnual = baseline ? (parseFloat(baseline.projected_gross_rent_annual) || 0) : (parseFloat(inputs.grossRentAnnual) || 0);
    const proj = projAnnual > 0 ? projAnnual / 12 : (parseFloat(inputs.grossRentPerMonth) || parseFloat(inputs.monthlyRent) || 0);
    const varUsd = actual - proj;
    return {
      id: deal.id,
      title: deal.title || deal.name,
      note: baseline ? `Baseline ${String(baseline.captured_at || '').slice(0, 10)}` : 'Pro-forma (no baseline yet)',
      proj,
      actual,
      varUsd,
      varPct: proj > 0 ? (varUsd / proj) * 100 : 0,
    };
  }), [deals, leases, baselines]);

  const totalVar = lines.reduce((s, l) => s + l.varUsd, 0);
  const colorFor = (l: Line) => (Math.abs(l.varPct) <= 2 ? 'text-emerald-400' : l.varUsd > 0 ? 'text-teal-400' : 'text-amber-400');

  return (
    <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/30 transition">
        <div>
          <h3 className="text-sm font-extrabold text-white">Projected vs. actual rent</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {lines.length === 0 ? 'No properties in this view.' : <>Across {lines.length} {lines.length === 1 ? 'property' : 'properties'}: <span className={`font-mono font-bold ${Math.abs(totalVar) < 1 ? 'text-emerald-400' : totalVar > 0 ? 'text-teal-400' : 'text-amber-400'}`}>{Math.abs(totalVar) < 1 ? 'on target' : `${signed(totalVar)}/mo vs. underwriting`}</span></>}
          </p>
        </div>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && lines.length > 0 && (
        <div className="border-t border-slate-800 overflow-x-auto">
          <p className="px-5 pt-3 text-[11px] text-slate-500">Actual is what each property rents for today; projected is what we expected at purchase. Nothing here changes the underwriting.</p>
          <table className="w-full text-left border-collapse text-xs mt-2">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/50">
                <th className="py-3 px-4">Property</th>
                <th className="py-3 px-4 text-right">Projected</th>
                <th className="py-3 px-4 text-right">Actual</th>
                <th className="py-3 px-4 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-3 px-4 font-bold text-white">{l.title}</td>
                  <td className="py-3 px-4 text-right font-mono text-slate-300">{usd(l.proj)}/mo<span className="block text-[10px] font-sans text-slate-500">{l.note}</span></td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-white">{usd(l.actual)}/mo</td>
                  <td className={`py-3 px-4 text-right font-mono font-bold ${colorFor(l)}`}>
                    {signed(l.varUsd)}
                    {l.proj > 0 && <span className="block text-[10px] font-sans font-semibold opacity-80">{l.varPct >= 0 ? '+' : ''}{l.varPct.toFixed(1)}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
