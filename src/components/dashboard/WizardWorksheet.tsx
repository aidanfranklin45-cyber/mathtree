import React, { useState } from 'react';
import type { Option } from '../../lib/ingestion/contracts';
import type { Readiness } from '../../lib/ingestion/readiness';
import type { WorksheetRow } from '../../lib/ingestion/worksheet';

/** The inputs shown as percentages. */
export const PERCENT_ROWS = new Set(['vacancyRate', 'rentGrowth', 'expenseRatio', 'expenseGrowth', 'targetCapRate', 'sellingCostPercent', 'discountRate', 'downPaymentPercent', 'interestRate']);

const SOURCE: Record<WorksheetRow['source'], string> = { document: 'From the document', profile: 'From your investor profile', owner: 'Your entry', missing: '' };

interface NoteProps {
  row: WorksheetRow;
  /** The question for this figure, if there is one (the sources disagree, or it is far from your standard); also its answered line. */
  question: React.ReactNode;
  /** Name the field: when several notes share a row of the form, each says which field it is about. */
  named?: boolean;
  /** Why the engine needs a figure nothing supplies: shown beside the Needed mark. */
  neededWhy?: string;
  /** The facts that bear on each decision with no figure of its own, by the decision's key. */
  decisionNotes?: Record<string, string>;
  /** More that bears on this field, closed until asked for (how an expense ratio is built). */
  extra?: React.ReactNode;
  /** Go to another row's field (the rent, for a ratio that waits for it). */
  onGo?: (rowKey: string) => void;
  onDecide: (decision: { key: string }, option: Option) => void;
  onOwnFigure: (row: WorksheetRow, value: string, reason: string) => void;
}

/**
 * What belongs under a field. A settled field is a check mark: this assumption has been dealt with, move on (hover for where it came from; the
 * full story is in the sources panel and in the record saved with the project). A field the engine needs is an empty circle. Only a field with an
 * open question shows more, and then only the question, answered where the figure is.
 */
export const RowNote: React.FC<NoteProps> = ({ row: r, question, named, neededWhy, decisionNotes, extra, onGo, onDecide, onOwnFigure }) => {
  const [own, setOwn] = useState<{ value: string; reason: string }>({ value: '', reason: '' });
  const name = named ? <span className="text-slate-400">{r.label}</span> : null;
  if (r.state === 'optional' && !question && r.decisions.length === 0) return null;

  if (r.state === 'ready' || r.state === 'assumed') {
    const profile = r.source === 'profile';
    return (
      <div data-note={r.key} data-state={r.state}>
        <p title={`${SOURCE[r.source]}. ${r.basis}`} className={`mt-1 inline-flex items-center gap-1.5 text-[11px] ${profile ? 'text-violet-300' : 'text-emerald-400'}`}>
          <span aria-label={profile ? 'Settled by your profile' : 'Settled'} role="img" className="font-black">✓</span>{name}
        </p>
        {extra}
      </div>
    );
  }
  if (r.state === 'needed') {
    return (
      <p data-note={r.key} data-state={r.state} className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-rose-300">
        <span aria-hidden>○</span><span className="font-bold">{named ? `${r.label}: needed` : 'Needed'}</span>
        {neededWhy && <span className="text-slate-500"> · {neededWhy}</span>}
      </p>
    );
  }

  // Waiting on another figure: say which, and take the owner to it
  if (r.locked) {
    return (
      <div data-note={r.key} data-state="decide" data-locked={r.locked.key} className="mt-1 w-full space-y-1.5 p-2 rounded-lg border border-slate-700 bg-slate-900/60 text-[11px]">
        <p className="flex flex-wrap items-center gap-2 text-slate-300">
          <span>{name}{name ? ': ' : ''}Decide the {r.locked.label} first. This is costs over {r.locked.label}.</span>
          <button type="button" onClick={() => onGo?.(r.locked!.key)} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-600 hover:border-emerald-500/60 text-slate-100 font-bold">Go to the {r.locked.label}</button>
        </p>
        {extra}
      </div>
    );
  }

  // decide / unsupported: one card, one line of ask, the choices as buttons
  const asks = r.decisions.length === 0 && !question ? r.reasons.slice(0, 1) : [];
  return (
    <div data-note={r.key} data-state={r.state} className="mt-1 w-full space-y-1.5 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
      {name && <p className="text-[11px] font-bold text-slate-200">{r.label}</p>}
      {asks.map((x, i) => <p key={i} className="text-[11px] text-amber-200">{x.detail}</p>)}
      {question}
      {r.decisions.map((d) => (
        <div key={d.key} className="space-y-1.5">
          <p className="text-[11px] text-amber-200">{d.reasons[0]?.detail ?? d.label}</p>
          {decisionNotes?.[d.key] && <p className="text-[11px] text-slate-400">{decisionNotes[d.key]}</p>}
          <span className="flex flex-wrap gap-2">
            {d.options.map((o) => <button key={o.id} type="button" onClick={() => onDecide(d, o)} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:border-emerald-500/60 text-slate-100 text-[11px] font-bold">{o.label}</button>)}
          </span>
        </div>
      ))}
      {r.hint && <p className="text-[10px] text-slate-500">{r.hint}</p>}
      {extra}
      {r.state === 'unsupported' && (
        <div className="space-y-1.5">
          {r.key === 'expenseRatio' && <p className="text-[10px] text-slate-500">The ratio counts taxes, insurance, upkeep, utilities and payroll. It leaves out management, the reserve and debt, and nets off tenant reimbursements.</p>}
          <span className="flex flex-wrap items-center gap-2">
            <input type="number" min="0" step="any" aria-label={`Your own ${r.label}`} placeholder="Your figure" value={own.value} onChange={(e) => setOwn({ ...own, value: e.target.value })} className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white" />
            {PERCENT_ROWS.has(r.key) && <span className="text-[11px] text-slate-400">%</span>}
            <input type="text" aria-label={`Why ${r.label.toLowerCase()}`} placeholder="Why this number?" value={own.reason} onChange={(e) => setOwn({ ...own, reason: e.target.value })} className="flex-1 min-w-[10rem] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-white" />
            <button type="button" disabled={!own.value.trim() || !own.reason.trim()} onClick={() => onOwnFigure(r, own.value.trim(), own.reason.trim())} className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-40">Use</button>
          </span>
        </div>
      )}
    </div>
  );
};

interface BannerProps {
  readiness: Readiness;
  /** Jump to the first thing still to settle. A shortcut, not an order: the form can be done in any order. */
  onNext: () => void;
  acknowledged: Set<string>;
  onAcknowledge: (id: string, on: boolean) => void;
}

/** One line at the top: how many things are left, and a way to the next one; the warnings to read, each with its own tick. */
export const ReadinessBanner: React.FC<BannerProps> = ({ readiness, onNext, acknowledged, onAcknowledge }) => {
  const left = readiness.blockers.length;
  const tone = readiness.verdict === 'ready' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : readiness.verdict === 'review' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-900/60 text-slate-200';
  return (
    <div id="wiz-readiness" className={`p-2.5 rounded-xl border text-[11px] ${tone}`} role="status" data-verdict={readiness.verdict}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black">
          {readiness.verdict === 'ready' ? '✓ Ready to confirm' : readiness.verdict === 'review' ? 'Read these, then confirm' : `${left} to settle`}
        </span>
        {left > 0 && <button type="button" onClick={onNext} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-600 hover:border-emerald-500/60 text-slate-100 font-bold">Next ›</button>}
      </div>
      {readiness.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {readiness.warnings.map((w) => (
            <li key={w.id}>
              <label className="flex items-start gap-2 cursor-pointer text-amber-100">
                <input type="checkbox" className="mt-0.5" checked={acknowledged.has(w.id)} onChange={(e) => onAcknowledge(w.id, e.target.checked)} />
                <span><span className="font-bold">{w.title}.</span> <span className="text-slate-300">{w.detail}</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
