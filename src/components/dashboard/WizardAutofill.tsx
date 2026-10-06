import React, { useMemo, useRef, useState } from 'react';
import type { DocumentType, IntakeDocument } from '../../lib/ingestion/intake';
import { DOCUMENT_PROFILES, DOCUMENT_TYPES } from '../../lib/ingestion/documentTypes';
import { validateIntake, type IntakeIssue } from '../../lib/ingestion/validate';
import type { IntakeSnapshot } from '../../lib/ingestion/intakeRecord';
import { assumptionText, attachVariances, proposeChanges, VARIANCE_DISCLOSURE, type Expected, type ProposedChange, type Proposal } from '../../lib/ingestion/apply';
import { resolveProfileAssumptions } from '../../lib/engine/compute';
import { openQuestions } from '../../lib/ingestion/openQuestions';
import { FORM_FIELD_FOR_KEY } from '../../lib/ingestion/wizardMap';
import { getAssumptionDefaults } from '../../lib/engine/assumptionDefaults';
import { managerChoice } from '@engine/underwritingAssumptions';
import { readDocument, type ParsedDocument } from '../../lib/ingestion/client';
import { extractFileText, isReadableFile, READABLE_EXTENSIONS } from '../../lib/ingestion/extractText';

/** What the documents gave, ready to be written into the form: the owner has not been asked to tick anything. */
export interface Autofill {
  proposal: Proposal;
  /** Every figure that does not replace one the owner typed. */
  ticked: Set<string>;
  docs: IntakeDocument[];
  /** The documents that were read, for the record of where the figures came from. */
  documents: Array<{ name: string; type: string }>;
}

/** A figure the owner's investor profile supplied, with the reason the owner gave for it. */
export interface ProfileFilled { key: string; label: string; value: number; why?: string }

interface Props {
  /** What the form holds now (as inputs), so the reader compares the documents with it. */
  deal: { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null };
  /** Reads the documents (if any) and writes them, then the owner's own assumptions for the rest, into the form. Resolves when the form is filled. */
  onAutofill: (a: Autofill | null) => Promise<void>;
  /** What the form holds that came from the owner's investor profile and still matches it (kept by the form, so it survives a second click or a reload). */
  profileFigures: ProfileFilled[];
  /** What was read from documents, kept by the form: shown even after a reload, when the documents themselves are gone. */
  intake: IntakeSnapshot | null;
  /** The investor profile's closing time: the date it filled in (or null while the date box is empty); null when the owner entered their own date. */
  closing: { weeks: number; date: string | null } | null;
  /** Changes one field of the form: an answer the owner gave to a question here (input key and value). */
  onSet: (key: string, value: string) => void;
  /** The owner answered a question where the sources disagreed: what they decided, for the record. */
  onAnswered: (key: string, label: string, decision: string) => void;
  /** The original files the owner added (and what each was read as), so the project can keep them. Called when the documents are read. */
  onFiles?: (files: Array<{ file: File; type?: string }>) => void;
}

interface Source { id: number; name: string; text: string; type: 'auto' | Exclude<DocumentType, 'unknown'>; /** The original file, kept for the project (absent for pasted text). */ file?: File }
interface Read { source: Source; parsed: ParsedDocument | null; error: string | null; issues: IntakeIssue[] }

const btn = 'px-3 py-2 rounded-xl text-xs font-bold transition disabled:opacity-40';
const sel = 'bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white';

/** The owner's choice about a property manager for this property: its own setting, else their investor profile's for the asset class. */
function managerFor(deal: Props['deal']): { uses: boolean | null; fee?: number } {
  const own = (deal.inputs ?? {}) as Record<string, any>;
  if (typeof own.manageProperty === 'boolean') return { uses: own.manageProperty, fee: Number(own.managementFeePercent) || undefined };
  return managerChoice(getAssumptionDefaults().assumptions, deal.asset_class);
}

/** What the owner's profile would use for the property the documents describe, to compare the document's figures with. */
function expectedFor(proposal: Proposal, deal: Props['deal']): Expected {
  const p = proposal.patch.patch as Record<string, any>;
  const own = (deal.inputs ?? {}) as Record<string, any>;
  return resolveProfileAssumptions({
    asset_class: deal.asset_class ?? undefined,
    purchase_price: Number(p.purchasePrice ?? deal.purchase_price) || undefined,
    inputs: {
      purchasePrice: p.purchasePrice ?? own.purchasePrice, unitCount: p.unitCount ?? own.unitCount, leaseType: p.leaseType ?? own.leaseType,
      gla: p.squareFeet ?? own.gla ?? own.squareFeet, taxableValue: own.taxableValue, totalAssessedValue: own.totalAssessedValue,
    },
  } as any);
}

/** A figure the owner is asked about: the documents and the owner's own number disagree, or the document is far from their assumption. */
type Question = { change: ProposedChange; kind: 'variance' | 'replaces' };

/**
 * The wizard's one action: read the documents, bring in the owner's assumptions, fill the form. What is left is only what needs the owner:
 * figures where the sources disagree, and the facts nobody has supplied. Everything else is already in the form.
 */
export const WizardAutofill: React.FC<Props> = ({ deal, onAutofill, onSet, onAnswered, onFiles, profileFigures, intake, closing }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [pasted, setPasted] = useState('');
  const [reads, setReads] = useState<Read[]>([]);
  const [result, setResult] = useState<{ proposal: Proposal; docs: IntakeDocument[]; filled: number } | null>(null);
  const [open, setOpen] = useState(true);
  const [details, setDetails] = useState(true); // the disclosures are on show: the owner is here to check the reader's work
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  // The questions the owner has answered, with the answer in words (they collapse to one line and can be reopened)
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<Record<string, string>>({});
  // What the owner supplied for a missing figure stays on screen as a checked line they can change, instead of disappearing
  const [provided, setProvided] = useState<Record<string, { label: string; value: string; editing: boolean }>>({});
  const nextId = useRef(1);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Source[] = [];
    const problems: string[] = [];
    setBusy(true);
    for (const f of Array.from(files)) {
      if (!isReadableFile(f.name)) { problems.push(`${f.name} can't be read. Use ${READABLE_EXTENSIONS.join(', ')} files, or paste the text.`); continue; }
      try { added.push({ id: nextId.current++, name: f.name, text: await extractFileText(f), type: 'auto', file: f }); }
      catch (e) { problems.push(`${f.name}: ${e instanceof Error ? e.message : 'could not be opened.'}`); }
    }
    setBusy(false);
    setSources((s) => [...s, ...added]);
    setNote(problems.length ? problems.join(' ') : null);
  };

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const out: Read[] = [];
      for (const source of sources) {
        try {
          const parsed = await readDocument({ text: source.text, filename: source.name, documentType: source.type === 'auto' ? undefined : source.type });
          out.push({ source, parsed, error: parsed.message ?? null, issues: parsed.intake.documentType === 'unknown' ? [] : validateIntake(parsed.intake) });
        } catch (e) {
          out.push({ source, parsed: null, error: e instanceof Error ? e.message : 'Could not read this document.', issues: [] });
        }
      }
      setReads(out);
      // The originals are kept with the project whether or not they could be read: the owner added them as their sources
      onFiles?.(out.flatMap((r) => (r.source.file ? [{ file: r.source.file, type: r.parsed && r.parsed.documentType !== 'unknown' ? r.parsed.documentType : undefined }] : [])));
      const docs = out.flatMap((r) => (r.parsed && r.parsed.intake.documentType !== 'unknown' ? [r.parsed.intake] : []));
      if (docs.length === 0) {
        await onAutofill(null);
        setResult(null);
      } else {
        const proposal = proposeChanges(docs, deal, { assetClass: true, manager: managerFor(deal) });
        attachVariances(proposal, expectedFor(proposal, deal));
        // Everything goes in except what would replace a figure the owner typed: that is asked below, and their figure stays meanwhile
        const ticked = new Set(proposal.changes.filter((c) => !c.replaces).map((c) => c.key));
        const documents = out.flatMap((r) => (r.parsed && r.parsed.documentType !== 'unknown' ? [{ name: r.source.name, type: r.parsed.documentType }] : []));
        await onAutofill({ proposal, ticked, docs, documents });
        setResult({ proposal, docs, filled: ticked.size });
      }
      setPicked({});
      setResolved({});
      setProvided({});
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // Where the sources disagree. A flagged figure is already in the form as the document's number; the owner can switch it.
  const questions: Question[] = useMemo(() => {
    if (!result) return [];
    return result.proposal.changes.flatMap<Question>((c) => {
      if (c.variance) return [{ change: c, kind: 'variance' }];
      if (c.replaces && (FORM_FIELD_FOR_KEY[c.key] || c.key === 'address')) return [{ change: c, kind: 'replaces' }];
      return [];
    });
  }, [result]);

  // What the property still needs once the owner's assumptions are taken into account: the facts only the property can state
  const missing = useMemo(() => {
    if (!result && reads.length === 0 && open) return [];
    try { return openQuestions(deal); } catch { return []; }
  }, [deal, result, reads.length, open]);

  const choose = (c: ProposedChange, which: string) => setPicked((p) => ({ ...p, [c.key]: which }));

  // What the form holds for this figure right now. If the owner has changed it since the document filled it in, that number is theirs and
  // pressing Add must not put the document's back.
  const inForm = (c: ProposedChange): number | undefined => {
    const v = deal.inputs?.[c.key];
    if (v === undefined || v === null || String(v).trim() === '' || !Number.isFinite(Number(v))) return undefined;
    return Number(v);
  };
  const changedInForm = (c: ProposedChange): boolean => typeof c.value === 'number' && inForm(c) !== undefined && Math.abs((inForm(c) as number) - c.value) > 1e-9;
  const defaultPick = (c: ProposedChange, kind: Question['kind']): string => (kind === 'variance' ? (changedInForm(c) ? 'keep' : 'doc') : 'keep');

  /** Applies the owner's pick to the form and closes the question. A figure typed for this property needs a number. */
  const confirm = (c: ProposedChange, kind: Question['kind']) => {
    const which = picked[c.key] ?? defaultPick(c, kind);
    const unit = (v: number) => assumptionText(c.key, v);
    let said: string;
    if (which === 'own') {
      const v = (typed[c.key] ?? '').trim();
      if (!v || !Number.isFinite(Number(v))) return;
      onSet(c.key, v);
      said = `${Number.isFinite(Number(v)) && c.variance ? unit(Number(v)) : v} (your own number)`;
    } else if (which === 'mine' && c.variance) {
      onSet(c.key, String(c.variance.expected));
      said = `${c.variance.expectedText} (your assumption)`;
    } else if (which === 'doc') {
      onSet(c.key, String(c.value));
      said = `${c.proposed} (from the document)`;
    } else {
      const mine = inForm(c);
      said = `${mine !== undefined && c.variance ? unit(mine) : (mine ?? c.current)} (what you entered)`;
    }
    setResolved((r) => ({ ...r, [c.key]: said }));
    onAnswered(c.key, c.label, said);
  };
  const reopen = (key: string) => setResolved((r) => { const n = { ...r }; delete n[key]; return n; });
  const openQuestionsLeft = questions.filter((q) => resolved[q.change.key] === undefined);

  const done = result !== null || reads.length > 0;
  const manager = managerFor(deal);
  const liveNotes = useMemo(
    () => (result ? proposeChanges(result.docs, deal, { assetClass: true, manager }).patch.notes : []),
    // the notes depend on the documents, the asset class and the manager choice: not on every keystroke in the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, manager.uses, manager.fee, deal.asset_class],
  );
  const hidden = reads.flatMap((r) => (r.parsed ? [r.parsed.redaction] : []));
  const sum = (k: 'names' | 'phones' | 'emails') => hidden.reduce((s, h) => s + h[k], 0);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-white">Fill this in from your documents and your assumptions</div>
          <p className="text-[11px] text-slate-400">One click reads the documents you add, brings in your investor profile for everything else, and fills the form. You only answer what is still open.</p>
        </div>
        {done && <button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300">{open ? 'Hide documents' : 'Add or change documents'}</button>}
      </div>

      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white cursor-pointer`}>
              Choose files
              <input type="file" multiple accept={READABLE_EXTENSIONS.join(',')} className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <span className="text-[11px] text-slate-500">Optional. PDF, CSV or text (a scanned PDF can't be read). Offering memorandum, rent roll, leases, operating statement, loan terms, purchase agreement.</span>
          </div>
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={2} placeholder="Or paste a document's text here" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
          {pasted.trim().length >= 20 && (
            <button type="button" onClick={() => { setSources((s) => [...s, { id: nextId.current++, name: 'Pasted text', text: pasted, type: 'auto' }]); setPasted(''); }} className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white`}>Add pasted text</button>
          )}
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
                  <button type="button" onClick={() => setSources((all) => all.filter((x) => x.id !== s.id))} className="text-[11px] text-slate-400 hover:text-white">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={busy} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4`}>
          {busy ? 'Working…' : done ? 'Fill again' : sources.length > 0 ? `Read ${sources.length} document${sources.length === 1 ? '' : 's'} and fill everything I can` : 'Fill everything I can from my assumptions'}
        </button>
        {done && !busy && result && <span role="status" className="text-[11px] text-emerald-300">Filled {result.filled} figures from {result.docs.length} document{result.docs.length === 1 ? '' : 's'}, and the rest from your assumptions.</span>}
        {done && !busy && !result && <span role="status" className="text-[11px] text-emerald-300">Filled from your assumptions.</span>}
      </div>

      {note && <p className="text-[11px] text-amber-300">{note}</p>}
      {reads.filter((r) => r.error).map((r) => <p key={r.source.id} className="text-[11px] text-amber-300">{r.source.name}: {r.error}</p>)}

      {(done || profileFigures.length > 0 || intake !== null) && (
        <div>
          <button type="button" onClick={() => setDetails((d) => !d)} className="text-[11px] font-bold text-slate-400 hover:text-white">{details ? 'Hide' : 'Show'} what was found and what was filled in</button>
          {details && (
            <div className="mt-2 space-y-4">
              {intake && (
                <section className="space-y-2">
                  <h5 className="text-[11px] uppercase tracking-wider font-black text-sky-300">1 · Found in your documents ({intake.figures.length})</h5>
                  <p className="text-[11px] text-slate-500">
                    Read from {intake.documents.length > 0 ? intake.documents.map((d) => d.name).join(', ') : 'the documents you added'}.
                    {result ? ` Hidden from the reader: ${sum('names')} names, ${sum('phones')} phone numbers, ${sum('emails')} emails.` : ' The documents themselves are not kept: add them again to read them again.'}
                  </p>
                  {reads.flatMap((r) => r.issues).map((i, n) => <p key={n} className={`text-[11px] ${i.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>{i.severity === 'error' ? 'Check: ' : 'Note: '}{i.message}</p>)}
                  <ul className="space-y-1">
                    {intake.figures.map((f) => (
                      <li key={f.key} className="text-[11px] text-slate-300"><span className="font-bold text-slate-100">{f.label}:</span> <span className="text-emerald-400">{f.text}</span> <span className="text-slate-500 italic">({f.reliability}) {f.how}</span></li>
                    ))}
                  </ul>
                  {result && result.proposal.unchanged.length > 0 && <p className="text-[11px] text-slate-500">Already in the form and matching: {result.proposal.unchanged.map((u) => `${u.label} (${u.value})`).join(', ')}.</p>}
                  {intake.claims.length > 0 && (
                    <div><p className="text-[11px] font-black text-slate-300">Claims in the documents (shown for comparison, never applied)</p>
                      <ul className="text-[11px] text-slate-400">{intake.claims.map((c, k) => <li key={k}>{c.how}: {c.value.toLocaleString('en-US')}</li>)}</ul></div>
                  )}
                  {(result ? liveNotes : intake.notes).length > 0 && <ul className="text-[11px] text-slate-400 list-disc pl-4">{(result ? liveNotes : intake.notes).map((n, i) => <li key={i}>{n}</li>)}</ul>}
                </section>
              )}

              {(
                <section className="space-y-2">
                  <h5 className="text-[11px] uppercase tracking-wider font-black text-violet-300">2 · Using your investor profile ({profileFigures.length})</h5>
                  <p className="text-[11px] text-slate-500">Not in any document: these are your own standards for this kind of property, filled in wherever the documents were silent. Change any of them in the form below for this property.</p>
                  <ul className="space-y-1">
                    <li className="text-[11px] text-slate-300"><span className="font-bold text-slate-100">Property manager (this property):</span>{' '}
                      {manager.uses === true ? <span className="text-emerald-400">{`you hire one. Their fee (${manager.fee !== undefined ? `${manager.fee}%` : 'not set yet'} of collected income) is charged on top of the expense ratio.`}</span>
                        : manager.uses === false ? <span className="text-emerald-400">you manage it yourself, so no management fee is charged (a lender will usually add one).</span>
                        : <span className="text-amber-300">your profile does not say, so no management fee is charged. Tick "I hire a property manager" below, or set it in your investor profile.</span>}
                    </li>
                    {closing !== null && (
                      <li className="text-[11px] text-slate-300"><span className="font-bold text-slate-100">Closing date:</span>{' '}
                        <span className="text-emerald-400">{closing.date ? `${closing.date}. ` : ''}Your investor profile is set to close {closing.weeks} weeks after the project is created.</span>{' '}
                        <span className="text-slate-500 italic">Change the date in the form below to replace it.</span></li>
                    )}
                    {profileFigures.map((f) => (
                      <li key={f.key} className="text-[11px] text-slate-300"><span className="font-bold text-slate-100">{f.label}:</span> <span className="text-emerald-400">{assumptionText(f.key, f.value)}</span> <span className="text-slate-500 italic">{f.why ? `Your reason: ${f.why}` : 'Your investor profile'}</span></li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
      {done && (questions.length > 0 || missing.length > 0 || Object.keys(provided).length > 0) && (
        <div className="space-y-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <h4 className="text-[11px] uppercase tracking-wider font-black text-amber-200">3 · Still needed from you ({openQuestionsLeft.length + missing.length})</h4>
          <p className="text-[11px] text-slate-400">Check the choices where the sources disagree, and fill the empty ones. The empty fields are also marked in the form below. {VARIANCE_DISCLOSURE}</p>

          {questions.map(({ change: c, kind }) => (
            resolved[c.key] !== undefined ? (
              <div key={c.key} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/50 border border-slate-800 text-[11px]">
                <span className="text-emerald-400">✓</span>
                <span className="font-bold text-slate-200">{c.label}:</span>
                <span className="text-slate-300">{resolved[c.key]}</span>
                <button type="button" onClick={() => reopen(c.key)} className="text-slate-500 hover:text-white underline">Change</button>
              </div>
            ) : (
              <div key={c.key} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-300 space-y-1.5">
                <span className="text-xs font-bold text-slate-100 block">{c.label}</span>
                {kind === 'variance' && c.variance ? (
                  <>
                    <span className="block text-amber-200">The document says {c.proposed}; your assumption is {c.variance.expectedText}. The document is {c.variance.percent}% {c.variance.higher ? 'higher' : 'lower'}.{c.variance.why ? ` Your reason: ${c.variance.why}` : ''}</span>
                    <span className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`q-${c.key}`} checked={(picked[c.key] ?? defaultPick(c, kind)) === 'doc'} onChange={() => choose(c, 'doc')} />Document's ({c.proposed})</label>
                      {changedInForm(c) && <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`q-${c.key}`} checked={(picked[c.key] ?? defaultPick(c, kind)) === 'keep'} onChange={() => choose(c, 'keep')} />What I entered ({assumptionText(c.key, inForm(c) as number)})</label>}
                      <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`q-${c.key}`} checked={picked[c.key] === 'mine'} onChange={() => choose(c, 'mine')} />My assumption ({c.variance.expectedText})</label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name={`q-${c.key}`} checked={picked[c.key] === 'own'} onChange={() => choose(c, 'own')} />
                        My own
                        <input type="number" min="0" step="any" aria-label={`Your own ${c.label}`} value={typed[c.key] ?? ''} className="w-20 bg-slate-950 border border-amber-500/30 rounded px-1.5 py-0.5 text-amber-100"
                          onChange={(e) => { const v = e.target.value; setTyped((t) => ({ ...t, [c.key]: v })); choose(c, 'own'); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') confirm(c, kind); }} />
                      </label>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-amber-200">You entered {c.current}; the document says {c.proposed}.</span>
                    <span className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`q-${c.key}`} checked={(picked[c.key] ?? 'keep') === 'keep'} onChange={() => choose(c, 'keep')} />Keep mine ({c.current})</label>
                      <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`q-${c.key}`} checked={picked[c.key] === 'doc'} onChange={() => choose(c, 'doc')} />Use the document's ({c.proposed})</label>
                    </span>
                  </>
                )}
                <span className="block text-slate-500 italic">{c.how}</span>
                <button type="button" onClick={() => confirm(c, kind)} disabled={picked[c.key] === 'own' && !(typed[c.key] ?? '').trim()}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-40">Add</button>
              </div>
            )
          ))}

          {[...Object.keys(provided).map((key) => ({ key, label: provided[key].label, why: '' })), ...missing.filter((m) => !provided[m.key])].map((m) => {
            const settable = Boolean(FORM_FIELD_FOR_KEY[m.key]);
            const done = provided[m.key];
            if (done && !done.editing) {
              return (
                <div key={m.key} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/50 border border-slate-800 text-[11px]">
                  <span className="text-emerald-400">✓</span>
                  <span className="font-bold text-slate-200">{m.label}:</span>
                  <span className="text-slate-300">{done.value} (your own number)</span>
                  <button type="button" onClick={() => { setAsked((a) => ({ ...a, [m.key]: done.value })); setProvided((pr) => ({ ...pr, [m.key]: { ...done, editing: true } })); }} className="text-slate-500 hover:text-white underline">Change</button>
                </div>
              );
            }
            const add = () => {
              const v = (asked[m.key] ?? '').trim();
              if (!v) return;
              onSet(m.key, v);
              setProvided((pr) => ({ ...pr, [m.key]: { label: m.label, value: v, editing: false } }));
              setAsked((a) => { const n = { ...a }; delete n[m.key]; return n; });
            };
            return (
              <div key={m.key} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-xs font-bold text-slate-100 block">{m.label}</span>
                {m.why && <span className="text-[11px] text-slate-400 block">{m.why}</span>}
                {settable && (
                  <span className="flex items-center gap-2 mt-1.5">
                    <input type={m.key === 'closingDate' ? 'date' : 'number'} step="any" aria-label={m.label} value={asked[m.key] ?? ''} onChange={(e) => setAsked((a) => ({ ...a, [m.key]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white" />
                    <button type="button" disabled={!(asked[m.key] ?? '').trim()} onClick={add} className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-40">Add</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {done && openQuestionsLeft.length === 0 && missing.length === 0 && <p className="text-[11px] text-emerald-300">Nothing else is needed to underwrite this property. Check the form below, then create it.</p>}

    </div>
  );
};
