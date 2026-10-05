import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MissingInput } from '../../lib/engine';

interface Props {
  title: string;
  missing: MissingInput[];
  onEdit: () => void;
  /** Copies the owner's profile assumptions onto this property for what it is missing. Returns a one-line result to show. */
  onFill?: () => Promise<string>;
}

/**
 * What the studio shows when a property does not yet state everything the engine needs. The engine never fills a gap with a guess,
 * so this lists exactly what is missing and why, and takes the owner straight to the place to enter it.
 */
export const InputsNeeded: React.FC<Props> = ({ title, missing, onEdit, onFill }) => {
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const fill = async () => {
    if (!onFill) return;
    setFilling(true);
    try { setFillNote(await onFill()); } catch (e) { setFillNote(e instanceof Error ? e.message : 'Could not fill from your assumptions.'); } finally { setFilling(false); }
  };
  const facts = missing.filter((m) => m.kind === 'fact');
  const assumptions = missing.filter((m) => m.kind === 'assumption');
  const group = (heading: string, note: string, rows: MissingInput[]) =>
    rows.length === 0 ? null : (
      <section aria-label={heading} className="space-y-2">
        <div>
          <h3 className="text-[11px] uppercase tracking-wider font-black text-slate-300">{heading}</h3>
          <p className="text-[11px] text-slate-500">{note}</p>
        </div>
        <ul className="space-y-1.5">
          {rows.map((m) => (
            <li key={m.key} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <span className="text-xs font-bold text-slate-100 block">{m.label}</span>
              <span className="text-[11px] text-slate-400 block">{m.why}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center p-4">
      <div className="p-6 max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl space-y-4 text-left">
        <div>
          <h2 className="text-base font-black text-white">{title}: inputs needed</h2>
          <p className="text-xs text-slate-400 mt-1">
            The numbers for this property are not shown until it states {missing.length === 1 ? 'one more input' : `${missing.length} more inputs`}. Nothing is
            assumed on your behalf, so every figure you see can be defended.
          </p>
        </div>
        {group('Facts about this deal', 'Set by the contract, the loan or the lease.', facts)}
        {group('Your assumptions', 'Your underwriting judgement. Set defaults once in your Investor Profile and they fill in for new deals.', assumptions)}
        {fillNote && <p role="status" className="text-[11px] text-emerald-300/90 leading-relaxed">{fillNote}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Link to="/" className="text-xs font-bold text-slate-400 hover:text-white">Back to dashboard</Link>
          {onFill && (
            <button type="button" onClick={() => void fill()} disabled={filling} className="px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold disabled:opacity-50">
              {filling ? 'Filling…' : 'Fill from my assumptions'}
            </button>
          )}
          <button type="button" onClick={onEdit} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold">
            Enter inputs
          </button>
        </div>
      </div>
    </div>
  );
};
