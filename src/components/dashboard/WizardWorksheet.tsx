import React, { useState } from 'react';
import type { Option } from '../../lib/ingestion/contracts';
import type { Readiness } from '../../lib/ingestion/readiness';
import type { RowState, WorksheetRow } from '../../lib/ingestion/worksheet';

/** The inputs shown as percentages. */
export const PERCENT_ROWS = new Set(['vacancyRate', 'rentGrowth', 'expenseRatio', 'expenseGrowth', 'targetCapRate', 'sellingCostPercent', 'discountRate', 'downPaymentPercent', 'interestRate']);

export const ROW_STATE: Record<RowState, { dot: string; word: string; tone: string }> = {
  ready: { dot: 'bg-emerald-400', word: 'Ready', tone: 'text-emerald-300' },
  assumed: { dot: 'bg-violet-400', word: 'Your standard', tone: 'text-violet-300' },
  decide: { dot: 'bg-amber-400', word: 'Decide', tone: 'text-amber-300' },
  unsupported: { dot: 'bg-rose-400', word: 'Needs evidence', tone: 'text-rose-300' },
  needed: { dot: 'bg-rose-400', word: 'Needed', tone: 'text-rose-300' },
  optional: { dot: 'bg-slate-600', word: 'Optional', tone: 'text-slate-500' },
};

const SOURCE: Record<WorksheetRow['source'], string> = { document: 'Document', profile: 'Investor profile', owner: 'You', missing: '' };

interface NoteProps {
  row: WorksheetRow;
  /** The question for this figure, if there is one (the sources disagree, or it is far from your standard); also its answered line. */
  question: React.ReactNode;
  /** Why a figure cannot be stated yet, when it waits on another. */
  waiting: string | null;
  /** Why the engine needs a figure nothing supplies. */
  neededWhy?: string;
  onDecide: (decision: { key: string }, option: Option) => void;
  onOwnFigure: (row: WorksheetRow, value: string, reason: string) => void;
}

/**
 * What belongs under a field: where its figure came from, and, only when something is owed, the question to settle it, right where the figure is
 * used. A settled field is one quiet line. There is no separate list of what is owed: the field is the place.
 */
export const RowNote: React.FC<NoteProps> = ({ row: r, question, waiting, neededWhy, onDecide, onOwnFigure }) => {
  const [own, setOwn] = useState<{ value: string; reason: string }>({ value: '', reason: '' });
  const s = ROW_STATE[r.state];
  if (r.state === 'optional' && !question && r.decisions.length === 0) return null;
  const open = r.state === 'decide' || r.state === 'unsupported';
  const source = r.source !== 'missing' && SOURCE[r.source] ? ` · ${SOURCE[r.source]}` : '';
  const line = r.state === 'needed' ? neededWhy ?? '' : r.basis;
  return (
    <div data-note={r.key} data-state={r.state} className="mt-1 space-y-1.5">
      <p className={`text-[11px] leading-snug ${s.tone}`}>
        <span className="font-bold text-slate-200 text-xs">{r.label}</span> <span className="font-black uppercase tracking-wider text-[10px]">{s.word}{r.state === 'needed' ? '' : source}</span>
        {line ? <span className="text-slate-400"> · {line}</span> : null}
      </p>
      {r.state === 'assumed' && <p className="text-[10px] text-slate-500 italic">Stands for this deal unless you change it here.</p>}
      {r.decided && r.state === 'ready' && <p className="text-[10px] text-slate-500 italic">You said: {r.decided}</p>}
      {open && (
        <div className="space-y-1.5 p-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
          {r.reasons.filter((x) => !(waiting && x.check === 'The figures it depends on are settled')).map((x, i) => <p key={i} className="text-[11px] text-amber-200">{x.detail}</p>)}
          {waiting && <p className="text-[11px] text-slate-400">{waiting}</p>}
          {question}
          {r.decisions.map((d) => (
            <div key={d.key} className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-100 block">{d.label}</span>
              {d.reasons.map((x, i) => <span key={i} className="block text-[11px] text-amber-200">{x.detail}</span>)}
              <span className="flex flex-wrap gap-2">
                {d.options.map((o) => <button key={o.id} type="button" onClick={() => onDecide(d, o)} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:border-emerald-500/60 text-slate-100 text-[11px] font-bold">{o.label}</button>)}
              </span>
              <span className="block text-slate-500 text-[11px]">Why you are asked: {d.reasons.map((x) => x.because).join('; ')}.</span>
            </div>
          ))}
          {r.state === 'unsupported' && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-100 block">Use your own figure for {r.label.toLowerCase()}</span>
              <span className="flex flex-wrap items-center gap-2">
                <input type="number" min="0" step="any" aria-label={`Your own ${r.label}`} value={own.value} onChange={(e) => setOwn({ ...own, value: e.target.value })} className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white" />
                {PERCENT_ROWS.has(r.key) && <span className="text-[11px] text-slate-400">%</span>}
              </span>
              <textarea rows={2} aria-label={`Why ${r.label.toLowerCase()}`} value={own.reason} onChange={(e) => setOwn({ ...own, reason: e.target.value })} placeholder="Why this number? For example, which costs it is built from, or what the statements for this property show." className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white" />
              <button type="button" disabled={!own.value.trim() || !own.reason.trim()} onClick={() => onOwnFigure(r, own.value.trim(), own.reason.trim())} className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-40">Use my figure</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface BannerProps {
  readiness: Readiness;
  onJump: (rowKey: string | undefined) => void;
  acknowledged: Set<string>;
  onAcknowledge: (id: string, on: boolean) => void;
}

/**
 * The check before confirming, in a few lines: what is still owed (each a link to its field) and what to read. It does not hold any question:
 * the questions are under the fields they are about.
 */
export const ReadinessBanner: React.FC<BannerProps> = ({ readiness, onJump, acknowledged, onAcknowledge }) => {
  const tone = readiness.verdict === 'ready' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : readiness.verdict === 'review' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200';
  return (
    <div id="wiz-readiness" className={`p-2.5 rounded-xl border text-[11px] ${tone}`} role="status" data-verdict={readiness.verdict}>
      <span className="text-xs font-black uppercase tracking-wider block">{readiness.verdict === 'ready' ? 'Ready to confirm' : readiness.verdict === 'review' ? 'Read these, then confirm' : 'Not ready to confirm'}</span>
      <span className="block mt-0.5">{readiness.summary}</span>
      {readiness.blockers.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {readiness.blockers.map((b) => (
            <li key={b.id}><button type="button" onClick={() => onJump(b.rowKey)} className="text-left underline decoration-dotted underline-offset-2 hover:text-white">{b.title}</button></li>
          ))}
        </ul>
      )}
      {readiness.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {readiness.warnings.map((w) => (
            <li key={w.id} className="p-2 rounded-lg bg-slate-950/50 border border-amber-500/30 text-amber-100">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={acknowledged.has(w.id)} onChange={(e) => onAcknowledge(w.id, e.target.checked)} />
                <span><span className="font-bold block">{w.title}</span><span className="block text-slate-300">{w.detail}</span><span className="block text-slate-500 italic">I have read this.</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
