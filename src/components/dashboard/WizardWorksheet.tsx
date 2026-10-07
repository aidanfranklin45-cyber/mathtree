import React, { useState } from 'react';
import type { Option } from '../../lib/ingestion/contracts';
import type { Readiness } from '../../lib/ingestion/readiness';
import type { RowGroup, RowState, WorksheetRow } from '../../lib/ingestion/worksheet';
import { formatValue } from '../../lib/ingestion/apply';

const GROUPS: RowGroup[] = ['Property', 'Income', 'Expenses', 'Financing', 'Exit and hold'];

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

export function valueText(r: WorksheetRow): string {
  if (r.value === null) return '—';
  if (typeof r.value === 'boolean') return r.value ? 'You hire a manager' : 'You manage it yourself';
  if (PERCENT_ROWS.has(r.key)) return `${r.value}%`;
  if (r.key === 'exitYear') return `${r.value} years`;
  if (typeof r.value === 'number') return formatValue(r.key, r.value);
  return String(r.value);
}

interface Props {
  rows: WorksheetRow[];
  readiness: Readiness;
  /** The question for this figure, if there is one (the sources disagree, or it is far from your standard); also its answered line. */
  renderQuestion: (key: string) => React.ReactNode;
  /** The entry box for a figure nothing supplies. */
  renderMissing: (key: string) => React.ReactNode;
  /** Why a figure cannot be stated yet, when it waits on another. */
  waiting: (key: string) => string | null;
  /** The owner chose how to settle a decision that has no figure of its own. */
  onDecide: (decision: { key: string; label: string; reasons: Array<{ because: string }> }, option: Option) => void;
  /** The owner entered a figure of their own for a figure that needs evidence, and the reason for it. */
  onOwnFigure: (row: WorksheetRow, value: string, reason: string) => void;
  onFocusField: (field: string) => void;
  acknowledged: Set<string>;
  onAcknowledge: (id: string, on: boolean) => void;
  /** Anything asked that has no row (a figure the worksheet does not list). */
  leftovers?: React.ReactNode;
}

/**
 * One row per assumption, grouped, each with its source. What is settled stays one quiet line; what is owed opens to its question. The check
 * before confirming sits on top: the project cannot be created until it says ready.
 */
export const WizardWorksheet: React.FC<Props> = ({ rows, readiness, renderQuestion, renderMissing, waiting, onDecide, onOwnFigure, onFocusField, acknowledged, onAcknowledge, leftovers }) => {
  const [own, setOwn] = useState<Record<string, { value: string; reason: string }>>({});
  const [showAll, setShowAll] = useState(true);
  const verdictTone = readiness.verdict === 'ready' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : readiness.verdict === 'review' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200';

  const body = (r: WorksheetRow) => {
    const question = renderQuestion(r.key);
    const wait = waiting(r.key);
    const missing = r.state === 'needed' ? renderMissing(r.key) : null;
    const draft = own[r.key] ?? { value: '', reason: '' };
    return (
      <div className="mt-1.5 space-y-1.5">
        {r.reasons.map((x, i) => <p key={i} className="text-[11px] text-amber-200">{x.detail}</p>)}
        {wait && <p className="text-[11px] text-slate-400">{wait}</p>}
        {question}
        {r.decisions.map((d) => (
          <div key={d.key} className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
            <span className="text-[11px] font-bold text-slate-100 block">{d.label}</span>
            {d.reasons.map((x, i) => <span key={i} className="block text-[11px] text-amber-200">{x.detail}</span>)}
            <span className="flex flex-wrap gap-2">
              {d.options.map((o) => <button key={o.id} type="button" onClick={() => onDecide(d, o)} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:border-emerald-500/60 text-slate-100 text-[11px] font-bold">{o.label}</button>)}
            </span>
            <span className="block text-slate-500 text-[11px]">Why you are asked: {d.reasons.map((x) => x.because).join('; ')}.</span>
          </div>
        ))}
        {missing}
        {r.state === 'unsupported' && (
          <div className="p-2 rounded-lg bg-slate-950/70 border border-rose-500/30 space-y-1.5">
            <span className="text-[11px] font-bold text-slate-100 block">Use your own figure for {r.label.toLowerCase()}</span>
            <span className="flex flex-wrap items-center gap-2">
              <input type="number" min="0" step="any" aria-label={`Your own ${r.label}`} value={draft.value} onChange={(e) => setOwn((o) => ({ ...o, [r.key]: { ...draft, value: e.target.value } }))} className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white" />
              <span className="text-[11px] text-slate-400">%</span>
            </span>
            <textarea rows={2} aria-label={`Why ${r.label.toLowerCase()}`} value={draft.reason} onChange={(e) => setOwn((o) => ({ ...o, [r.key]: { ...draft, reason: e.target.value } }))} placeholder="Why this number? For example, which costs it is built from, or what the property's statements show." className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white" />
            <button type="button" disabled={!draft.value.trim() || !draft.reason.trim()} onClick={() => onOwnFigure(r, draft.value.trim(), draft.reason.trim())} className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-40">Use my figure</button>
          </div>
        )}
      </div>
    );
  };

  const row = (r: WorksheetRow) => {
    const s = ROW_STATE[r.state];
    const open = r.state === 'decide' || r.state === 'unsupported' || r.state === 'needed';
    return (
      <li key={r.key} data-row={r.key} data-state={r.state} className={`p-2 rounded-lg border ${open ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${s.dot} self-center`} />
          <button type="button" onClick={() => onFocusField(r.field)} className="text-xs font-bold text-slate-100 hover:text-white text-left">{r.label}</button>
          <span className="text-xs text-emerald-300 font-bold">{valueText(r)}</span>
          <span className={`text-[10px] uppercase tracking-wider font-black ${s.tone}`}>{s.word}{r.source !== 'missing' && SOURCE[r.source] ? ` · ${SOURCE[r.source]}` : ''}</span>
        </div>
        {r.state !== 'optional' && !(r.state === 'needed') && <p className="text-[11px] text-slate-400 mt-0.5 pl-4">{r.basis}</p>}
        {r.state === 'assumed' && <p className="text-[11px] text-slate-500 mt-0.5 pl-4 italic">This stands for this deal unless you change it in the form below.</p>}
        {r.decided && r.state === 'ready' && <p className="text-[11px] text-slate-500 mt-0.5 pl-4 italic">You said: {r.decided}</p>}
        {open && <div className="pl-4">{body(r)}</div>}
      </li>
    );
  };

  return (
    <section id="wiz-worksheet" className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-950/60">
      <div className={`p-2.5 rounded-xl border text-[11px] ${verdictTone}`} role="status" data-verdict={readiness.verdict}>
        <span className="text-xs font-black uppercase tracking-wider block">{readiness.verdict === 'ready' ? 'Ready to confirm' : readiness.verdict === 'review' ? 'Read these, then confirm' : 'Not ready to confirm'}</span>
        <span className="block mt-0.5">{readiness.summary}</span>
        {readiness.blockers.length > 0 && (
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {readiness.blockers.map((b) => <li key={b.id}>{b.title}</li>)}
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

      <div className="flex items-center justify-between">
        <h4 className="text-[11px] uppercase tracking-wider font-black text-slate-300">Worksheet</h4>
        <button type="button" onClick={() => setShowAll((s) => !s)} className="text-[11px] font-bold text-slate-400 hover:text-white">{showAll ? 'Hide settled rows' : 'Show every row'}</button>
      </div>
      <p className="text-[11px] text-slate-500">Each assumption, where it came from, and what is still owed. A figure from your investor profile stands for this deal unless you change it in the form below. Your own entry always beats a document.</p>

      {GROUPS.map((g) => {
        const inGroup = rows.filter((r) => r.group === g && r.state !== 'optional');
        const visible = inGroup.filter((r) => showAll || r.state === 'decide' || r.state === 'unsupported' || r.state === 'needed');
        if (inGroup.length === 0) return null;
        return (
          <div key={g} className="space-y-1.5">
            <h5 className="text-[10px] uppercase tracking-wider font-black text-slate-500">{g} <span className="text-slate-600 normal-case font-semibold">{inGroup.filter((r) => r.state === 'ready' || r.state === 'assumed').length} of {inGroup.length} settled</span></h5>
            {visible.length > 0 ? <ul className="space-y-1.5">{visible.map(row)}</ul> : <p className="text-[11px] text-emerald-300/80 pl-1">Everything here is settled.</p>}
          </div>
        );
      })}
      {leftovers}
    </section>
  );
};
