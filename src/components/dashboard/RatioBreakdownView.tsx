import React from 'react';
import type { BreakdownGroup, RatioBreakdown, RatioCheck } from '../../lib/ingestion/ratioBreakdown';

const dollars = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const percent = (p: number | null) => (p === null ? '' : `${p.toFixed(1)}%`);

/** The page of a group's lines, when they are all on one. */
const pageOf = (g: BreakdownGroup): string => {
  const pages = [...new Set(g.lines.map((l) => l.page).filter((p): p is number => p !== null))];
  return pages.length === 1 ? `p. ${pages[0]}` : pages.length > 1 ? `pp. ${pages.join(', ')}` : '';
};

/** What the lines of a group are called, when there is more than one. */
const named = (g: BreakdownGroup): string => (g.lines.length > 1 ? g.lines.map((l) => l.label).join(', ') : '');

interface Props {
  breakdown: RatioBreakdown;
  /** What the form holds for the ratio now, when it is not the document's. */
  entered?: number | null;
  /** Questions asked of the lines: do they add up, is a usual cost missing, is any repeated, does another document differ. */
  checks?: RatioCheck[];
}

/**
 * How a document's expense ratio is made, closed until asked for: the costs that count (largest first, with their share of the rent), the tenant
 * reimbursements netted off, the rent it is measured against, and what is left out because it is charged separately. A summary the owner can take
 * in at a glance, with the pages to check it against.
 */
export const RatioBreakdownView: React.FC<Props> = ({ breakdown: b, entered, checks }) => {
  const biggest = Math.max(...b.counted.map((g) => g.amount), 1);
  const differs = entered !== null && entered !== undefined && b.ratioPercent !== null && Math.abs(entered - b.ratioPercent) > 0.05;
  return (
    <details className="mt-1 text-[11px]" data-breakdown="expenseRatio">
      <summary className="cursor-pointer select-none text-slate-400 hover:text-white">How this ratio is built</summary>
      <div className="mt-1.5 space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
        <p className="text-slate-200">
          Costs {dollars(b.grossCosts)}
          {b.reimbursements ? ` − reimbursements ${dollars(b.reimbursements.amount)}` : ''} = <span className="font-bold">{dollars(b.netCosts)}</span>
          {b.rentAnnual !== null ? <> over rent {dollars(b.rentAnnual)} = <span className="font-bold text-emerald-300">{b.ratioPercent?.toFixed(2)}%</span></> : <span className="text-slate-500"> (shares of rent show once the rent is decided)</span>}
        </p>
        {differs && <p className="text-amber-200">You entered {entered}%; the document's costs make {b.ratioPercent?.toFixed(2)}%.</p>}
        <ul className="space-y-1">
          {b.counted.map((g) => (
            <li key={g.name} className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3">
              <span className="min-w-0">
                <span className="text-slate-200">{g.name}</span>
                {named(g) && <span className="block truncate text-[10px] text-slate-500">{named(g)}</span>}
                <span aria-hidden className="mt-0.5 block h-1 rounded bg-emerald-500/40" style={{ width: `${Math.max(4, (g.amount / biggest) * 100)}%` }} />
              </span>
              <span className="tabular-nums text-slate-100">{dollars(g.amount)}</span>
              <span className="w-12 text-right tabular-nums text-slate-400">{percent(g.percentOfRent)}</span>
              <span className="w-10 text-right text-slate-500">{pageOf(g)}</span>
            </li>
          ))}
          {b.reimbursements && (
            <li className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 border-t border-slate-800 pt-1">
              <span className="text-slate-200">{b.reimbursements.name}, netted off{named(b.reimbursements) ? <span className="text-[10px] text-slate-500"> ({named(b.reimbursements)})</span> : null}</span>
              <span className="tabular-nums text-slate-100">−{dollars(b.reimbursements.amount)}</span>
              <span className="w-12 text-right tabular-nums text-slate-400">{b.reimbursements.percentOfRent !== null ? `−${percent(b.reimbursements.percentOfRent)}` : ''}</span>
              <span className="w-10 text-right text-slate-500">{pageOf(b.reimbursements)}</span>
            </li>
          )}
        </ul>
        {checks && checks.length > 0 && (
          <ul className="space-y-0.5 border-t border-slate-800 pt-1.5" data-ratio-checks>
            {checks.map((c) => <li key={c.id} className={c.ok ? 'text-emerald-300/80' : 'text-amber-200'}>{c.ok ? '✓' : '⚠'} {c.text}</li>)}
          </ul>
        )}
        {b.leftOut.length > 0 && (
          <p className="text-slate-400">
            Left out, charged separately:{' '}
            {b.leftOut.map((g, i) => <span key={g.name}>{i > 0 ? ' · ' : ''}{g.name} {dollars(g.amount)}{pageOf(g) ? ` (${pageOf(g)})` : ''}</span>)}
          </p>
        )}
      </div>
    </details>
  );
};
