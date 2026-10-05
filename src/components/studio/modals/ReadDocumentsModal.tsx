import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DealInputs, DealRecord } from '../../../lib/math/types';
import type { DealTopPatch } from '../../../stores/useDealStore';
import type { DocumentType, IntakeDocument } from '../../../lib/ingestion/intake';
import { DOCUMENT_PROFILES, DOCUMENT_TYPES } from '../../../lib/ingestion/documentTypes';
import { validateIntake, type IntakeIssue } from '../../../lib/ingestion/validate';
import { buildApplication, knownTenantNames, proposeChanges } from '../../../lib/ingestion/apply';
import { readDocument, type ParsedDocument } from '../../../lib/ingestion/client';
import { extractFileText, isReadableFile, READABLE_EXTENSIONS } from '../../../lib/ingestion/extractText';

interface Props {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  /** The same save the Edit Inputs form uses. */
  onApply: (inputsPatch: Partial<DealInputs>, top: DealTopPatch) => Promise<boolean>;
}

interface Source {
  id: number;
  name: string;
  text: string;
  type: 'auto' | Exclude<DocumentType, 'unknown'>;
}

interface Read {
  source: Source;
  parsed: ParsedDocument | null;
  error: string | null;
  issues: IntakeIssue[];
}

const RELIABILITY_STYLE = {
  executed: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  reported: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  projected: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
} as const;

const btn = 'px-3 py-2 rounded-xl text-xs font-bold transition disabled:opacity-40';
const sel = 'bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white';

export const ReadDocumentsModal: React.FC<Props> = ({ isOpen, deal, onClose, onApply }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [pasted, setPasted] = useState('');
  const [reads, setReads] = useState<Read[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const nextId = useRef(1);

  const docs = useMemo<IntakeDocument[]>(() => (reads ?? []).flatMap((r) => (r.parsed && r.parsed.intake.documentType !== 'unknown' ? [r.parsed.intake] : [])), [reads]);
  const proposal = useMemo(() => (docs.length > 0 ? proposeChanges(docs, deal) : null), [docs, deal]);
  const hardErrors = (reads ?? []).some((r) => r.issues.some((i) => i.severity === 'error'));

  // Everything starts ticked except what would replace a figure the owner already states: that is their call
  const proposalKey = proposal?.changes.map((c) => c.key).join('|') ?? '';
  useEffect(() => {
    setTicked(new Set((proposal?.changes ?? []).filter((c) => !c.replaces).map((c) => c.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalKey]);

  if (!isOpen) return null;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Source[] = [];
    const rejected: string[] = [];
    const problems: string[] = [];
    setBusy(true);
    for (const f of Array.from(files)) {
      if (!isReadableFile(f.name)) { rejected.push(f.name); continue; }
      try {
        added.push({ id: nextId.current++, name: f.name, text: await extractFileText(f), type: 'auto' });
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : 'could not be opened.'}`);
      }
    }
    setBusy(false);
    setSources((s) => [...s, ...added]);
    setReads(null);
    const notes = [...problems, ...(rejected.length ? [`${rejected.join(', ')} can't be read. Use ${READABLE_EXTENSIONS.join(', ')} files, or paste the text.`] : [])];
    setNote(notes.length ? notes.join(' ') : null);
  };

  const addPasted = () => {
    if (pasted.trim().length < 20) return;
    setSources((s) => [...s, { id: nextId.current++, name: 'Pasted text', text: pasted, type: 'auto' }]);
    setPasted('');
  };

  const readAll = async () => {
    setBusy(true);
    setNote(null);
    const knownNames = knownTenantNames(deal);
    const out: Read[] = [];
    for (const source of sources) {
      try {
        const parsed = await readDocument({ text: source.text, filename: source.name, documentType: source.type === 'auto' ? undefined : source.type, knownNames });
        out.push({ source, parsed, error: parsed.message ?? null, issues: parsed.intake.documentType === 'unknown' ? [] : validateIntake(parsed.intake) });
      } catch (e) {
        out.push({ source, parsed: null, error: e instanceof Error ? e.message : 'Could not read this document.', issues: [] });
      }
    }
    setReads(out);
    setBusy(false);
  };

  const apply = async () => {
    if (!proposal) return;
    setBusy(true);
    const { inputsPatch, top } = buildApplication(deal, proposal, ticked);
    const ok = await onApply(inputsPatch as Partial<DealInputs>, top);
    setBusy(false);
    if (ok) onClose();
    else setNote('Could not save. Try again.');
  };

  const toggle = (key: string) => setTicked((t) => { const n = new Set(t); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-4 sm:p-6 space-y-4 shadow-2xl my-2 max-h-[94vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white">Read documents for {deal.title || 'this property'}</h2>
            <p className="text-[11px] text-slate-400">Rent rolls, leases, operating statements, loan terms, offering memorandums and purchase agreements. Tenant names, phone numbers and emails are hidden before anything is read, and nothing is saved until you tick it.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Add */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white cursor-pointer`}>
              Choose files
              <input type="file" multiple accept={READABLE_EXTENSIONS.join(',')} className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <span className="text-[11px] text-slate-500">PDF, CSV or text. A scanned PDF (a picture of a page) can't be read; Excel files: save as CSV.</span>
          </div>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} placeholder="Or paste the document's text here" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
          {pasted.trim().length >= 20 && <button type="button" onClick={addPasted} className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white`}>Add pasted text</button>}
        </section>

        {sources.length > 0 && (
          <ul className="space-y-1.5">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-xs font-bold text-slate-100 flex-1 min-w-[8rem] truncate">{s.name}</span>
                <span className="text-[11px] text-slate-500">{s.text.length.toLocaleString()} characters</span>
                <select aria-label={`Type of ${s.name}`} value={s.type} onChange={(e) => setSources((all) => all.map((x) => (x.id === s.id ? { ...x, type: e.target.value as Source['type'] } : x)))} className={sel}>
                  <option value="auto">Detect the type</option>
                  {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_PROFILES[t].label}</option>)}
                </select>
                <button type="button" onClick={() => { setSources((all) => all.filter((x) => x.id !== s.id)); setReads(null); }} className="text-[11px] text-slate-400 hover:text-white">Remove</button>
              </li>
            ))}
          </ul>
        )}

        {sources.length > 0 && (
          <button type="button" onClick={readAll} disabled={busy} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}>
            {busy && !reads ? 'Working…' : reads ? 'Read again' : `Read ${sources.length} document${sources.length === 1 ? '' : 's'}`}
          </button>
        )}

        {note && <p className="text-[11px] text-amber-300">{note}</p>}

        {/* What each document gave */}
        {reads && (
          <section className="space-y-2">
            {reads.map((r) => (
              <div key={r.source.id} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-100">{r.source.name}</span>
                  {r.parsed && r.parsed.documentType !== 'unknown' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-300 border-sky-500/20">{DOCUMENT_PROFILES[r.parsed.documentType as Exclude<DocumentType, 'unknown'>].label}</span>}
                </div>
                {r.parsed && (
                  <p className="text-[11px] text-slate-500">
                    Hidden from the reader: {r.parsed.redaction.names} name{r.parsed.redaction.names === 1 ? '' : 's'}, {r.parsed.redaction.phones} phone number{r.parsed.redaction.phones === 1 ? '' : 's'}, {r.parsed.redaction.emails} email{r.parsed.redaction.emails === 1 ? '' : 's'}.
                  </p>
                )}
                {r.error && <p className="text-[11px] text-amber-300">{r.error}</p>}
                {r.issues.map((i, n) => <p key={n} className={`text-[11px] ${i.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>{i.severity === 'error' ? 'Check: ' : 'Note: '}{i.message}</p>)}
              </div>
            ))}
          </section>
        )}

        {/* What it would change */}
        {proposal && (
          <section className="space-y-2">
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-black text-slate-300">Changes to this property ({proposal.changes.length})</h3>
              <p className="text-[11px] text-slate-500">Tick what you want applied. Figures that would replace one you already entered start unticked. Each applied figure is recorded with the document it came from.</p>
            </div>
            {proposal.changes.length === 0 ? <p className="text-[11px] text-slate-500 italic">These documents don't change anything this property already states.</p> : (
              <ul className="space-y-1.5">
                {proposal.changes.map((c) => (
                  <li key={c.key} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                    <input type="checkbox" id={`chg-${c.key}`} checked={ticked.has(c.key)} onChange={() => toggle(c.key)} className="mt-0.5" />
                    <label htmlFor={`chg-${c.key}`} className="flex-1 cursor-pointer">
                      <span className="text-xs font-bold text-slate-100 block">{c.label}</span>
                      <span className="text-sm font-black text-emerald-400">{c.proposed}</span>
                      {c.current !== null && <span className="text-[11px] text-slate-400"> (now {c.current})</span>}
                      <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${RELIABILITY_STYLE[c.reliability]}`}>{c.reliability}</span>
                        <span className="text-[10.5px] text-slate-500 italic">{c.how}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(proposal.patch.claims).length > 0 && (
              <div>
                <h4 className="text-[11px] font-black text-slate-300">Claims in the documents (shown, never applied)</h4>
                <ul className="text-[11px] text-slate-400">{Object.entries(proposal.patch.claims).map(([k, c]) => <li key={k}>{c.how}: {c.value.toLocaleString('en-US')}</li>)}</ul>
              </div>
            )}
            {proposal.patch.notes.length > 0 && <ul className="text-[11px] text-slate-400 list-disc pl-4">{proposal.patch.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {proposal.patch.missingInputs.length > 0 && <p className="text-[11px] text-slate-500">Still needed after this: {proposal.patch.missingInputs.map((m) => m.label).join(', ')}.</p>}
            {hardErrors && <p className="text-[11px] text-rose-300">A document failed a consistency check above. Review the figures before applying.</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className={`${btn} text-slate-300 hover:text-white`}>Cancel</button>
              <button type="button" onClick={apply} disabled={busy || ticked.size === 0} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}>
                {busy ? 'Saving…' : `Apply ${ticked.size} change${ticked.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
