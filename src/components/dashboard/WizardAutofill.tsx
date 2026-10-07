import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentType, IntakeDocument } from '../../lib/ingestion/intake';
import { DOCUMENT_PROFILES, DOCUMENT_TYPES } from '../../lib/ingestion/documentTypes';
import { documentChecks, validateIntake, type IntakeIssue } from '../../lib/ingestion/validate';
import { groundIntake, traceDocument, type TraceRow } from '../../lib/ingestion/lineage';
import { DocumentLineage } from '../studio/DocumentLineage';
import { buildIntakeRecord, closingFigure, type IntakeSnapshot } from '../../lib/ingestion/intakeRecord';
import { buildWorksheet, ROW_SPECS, type WorksheetRow } from '../../lib/ingestion/worksheet';
import { assess, type Readiness } from '../../lib/ingestion/readiness';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { PERCENT_ROWS, ReadinessBanner, RowNote } from './WizardWorksheet';
import { assumptionText, attachVariances, defaultTicked, proposeChanges, releaseDependents, VARIANCE_DISCLOSURE, withChosenValue, type Expected, type ProposedChange, type Proposal } from '../../lib/ingestion/apply';
import { expectedFor } from '../../lib/ingestion/expected';
import { openQuestions } from '../../lib/ingestion/openQuestions';
import { evaluateContracts, type ContractResult, type Option } from '../../lib/ingestion/contracts';
import { receiptsFor, receiptText } from '../../lib/ingestion/receipts';
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
  documents: Array<{ name: string; type: string; model?: string }>;
  /** The documents held to their own arithmetic, and how each check came out. */
  checks: Array<{ label: string; ok: boolean; detail: string }>;
  /** Each line the reader took from the documents, where it is, and what it feeds. */
  lineage: TraceRow[];
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
  /** The owner checked a figure the reader was unsure of and chose to use what was read: apply that one figure to the form. */
  onAccept: (proposal: Proposal, key: string) => void;
  /** The original files the owner added (and what each was read as), so the project can keep them. Called when the documents are read. */
  onFiles?: (files: Array<{ file: File; type?: string }>) => void;
  /** The worksheet and the check before confirming, whenever either changes: the wizard holds the Create button until it says ready. */
  onWorksheet?: (rows: WorksheetRow[], readiness: Readiness) => void;
  /** The owner gave a reason for a figure of their own that needs evidence: saved with the figure. */
  onReason?: (key: string, reason: string) => void;
  /** The form this belongs to: its fields show their own notes (`FieldNote`) and the documents panel sits where `WizardDocuments` is put. */
  children?: React.ReactNode;
  /** Show what is owed even before a reading: the owner pressed Create. */
  reveal?: boolean;
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

/** A figure the owner is asked about: the documents and the owner's own number disagree, or the document is far from their assumption. */
type Question = { change: ProposedChange; kind: 'variance' | 'replaces' | 'unsure' };

/**
 * The wizard's one action: read the documents, bring in the owner's assumptions, fill the form. What is left is only what needs the owner:
 * figures where the sources disagree, and the facts nobody has supplied. Everything else is already in the form.
 */
export const WizardAutofill: React.FC<Props> = ({ deal, onAutofill, onSet, onAnswered, onAccept, onFiles, onWorksheet, onReason, profileFigures, intake, closing, children, reveal }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [pasted, setPasted] = useState('');
  const [reads, setReads] = useState<Read[]>([]);
  const [result, setResult] = useState<{ proposal: Proposal; docs: IntakeDocument[]; filled: number } | null>(null);
  const [open, setOpen] = useState(true);
  const [details, setDetails] = useState(false); // the sources behind each row are in the worksheet; the full reading of the documents is one click away
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
          const read = await readDocument({ text: source.text, filename: source.name, documentType: source.type === 'auto' ? undefined : source.type });
          // A number the reader returned that is not in the document text cannot have been read as printed: it goes to the owner as unsure
          const parsed = { ...read, intake: groundIntake(read.intake, source.text) };
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
        const ticked = defaultTicked(proposal);
        const documents = out.flatMap((r) => (r.parsed && r.parsed.documentType !== 'unknown' ? [{ name: r.source.name, type: r.parsed.documentType, model: r.parsed.model }] : []));
        await onAutofill({ proposal, ticked, docs, documents, checks: docs.flatMap((d) => documentChecks(d)), lineage: out.flatMap((r) => (r.parsed && r.parsed.intake.documentType !== 'unknown' ? traceDocument(r.parsed.intake, r.source.text, r.source.name) : [])) });
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
      if (c.waitingOn) return []; // shown as waiting, not asked: its answer depends on another
      if ((c.unsure || c.chosen) && !c.replaces) return [{ change: c, kind: 'unsure' }];
      if (c.variance) return [{ change: c, kind: 'variance' }];
      if (c.replaces && (FORM_FIELD_FOR_KEY[c.key] || c.key === 'address')) return [{ change: c, kind: 'replaces' }];
      return [];
    });
  }, [result]);

  // The contract behind every question: what was checked and what failed. A decision with no figure of its own (a management charge, reimbursements,
  // a rent that disagrees with the document's own average) is asked here too, and what the owner says is recorded with the reason it was asked.
  const contracts: ContractResult[] = useMemo(() => (result ? evaluateContracts(result.proposal, result.docs) : []), [result]);
  const lineAsks = contracts.filter((c) => c.outcome === 'ask' && c.options);
  const whyFor = (key: string) => contracts.find((c) => c.key === key)?.reasons ?? [];
  const receipts = useMemo(() => (intake ? receiptsFor({ figures: intake.figures.map((f) => ({ key: f.key, label: f.label, value: f.value ?? null, source: 'document' as const, how: f.how })), lineage: intake.lineage }) : []), [intake]);

  // What the property still needs once the owner's assumptions are taken into account: the facts only the property can state
  const missing = useMemo(() => {
    if (!result && reads.length === 0 && open) return [];
    try { return openQuestions(deal); } catch { return []; }
  }, [deal, result, reads.length, open]);

  // A question is about an assumption, so its figures carry their unit (a percent, or dollars a year), never a bare number
  const docText = (c: ProposedChange): string => (c.variance && typeof c.value === 'number' ? assumptionText(c.key, c.value) : c.proposed);
  const mineText = (c: ProposedChange): string => (c.variance ? assumptionText(c.key, c.variance.expected) : '');

  // A figure the reader was unsure of: the owner checks the document, then uses what was read or leaves the field to enter themselves
  const settleUnsure = (c: ProposedChange, useRead: boolean, chosen?: { value: number; text: string }) => {
    if (useRead && result) {
      const decided = chosen ? withChosenValue(result.proposal, c.key, chosen.value) : result.proposal;
      // Whatever was waiting on this figure (the expense ratio waits on the rent) can now be stated, from the same costs over the rent chosen
      const waited = result.proposal.changes.some((x) => x.waitingOn === c.key);
      const next = releaseDependents(decided, c.key);
      onAccept(next, c.key);
      if (waited) {
        attachVariances(next, expectedFor(next, deal));
        onAccept(next, 'expenseRatio');
      }
      setResult((r) => (r ? { ...r, proposal: next } : r));
    }
    const said = useRead ? `${chosen ? chosen.text : c.proposed} (${chosen ? 'chosen from the figures the document gives' : 'checked against the document and kept'})` : 'left blank for you to enter';
    setResolved((r) => ({ ...r, [c.key]: said }));
    onAnswered(c.key, c.label, said);
  };

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
  const confirm = (c: ProposedChange, kind: Question['kind'], chosen?: string) => {
    const which = chosen ?? picked[c.key] ?? defaultPick(c, kind);
    const unit = (v: number) => assumptionText(c.key, v);
    let said: string;
    if (which === 'own') {
      const v = (typed[c.key] ?? '').trim();
      if (!v || !Number.isFinite(Number(v))) return;
      onSet(c.key, v);
      said = `${Number.isFinite(Number(v)) && c.variance ? unit(Number(v)) : v} (your own number)`;
    } else if (which === 'mine' && c.variance) {
      onSet(c.key, String(c.variance.expected));
      said = `${mineText(c)} (your assumption)`;
    } else if (which === 'doc') {
      onSet(c.key, String(c.value));
      said = `${docText(c)} (from the document)`;
    } else {
      const mine = inForm(c);
      said = `${mine !== undefined && c.variance ? unit(mine) : (mine ?? c.current)} (what you entered)`;
    }
    setResolved((r) => ({ ...r, [c.key]: said }));
    onAnswered(c.key, c.label, said);
  };
  /** The owner settles a decision that has no figure of its own. The answer goes into the form when it has a field, and into the record with the reason it was asked. */
  const settleLine = (c: ContractResult, o: Option) => {
    if (o.set) onSet(o.set.key, o.set.value);
    const said = `${o.label} (asked because: ${c.reasons.map((r) => r.because).join('; ')})`;
    setResolved((r) => ({ ...r, [c.key]: said }));
    onAnswered(c.key, c.label, said);
  };
  const reopen = (key: string) => setResolved((r) => { const n = { ...r }; delete n[key]; return n; });
  const openQuestionsLeft = questions.filter((q) => resolved[q.change.key] === undefined);
  const lineLeft = lineAsks.filter((c) => resolved[c.key] === undefined);

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

  // ---- The worksheet: one row per assumption, built from the form, the receipts of what was read and the contracts ----
  const [ownerReasons, setOwnerReasons] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const formInputs = (deal.inputs ?? {}) as Record<string, unknown>;
  const neededAll = useMemo(() => { try { return openQuestions(deal); } catch { return []; } }, [deal]);
  const preview = useMemo(() => {
    const current = (key: string, value: unknown): number | string | undefined => {
      const held = formInputs[key];
      if (key === 'address') return typeof value === 'string' && typeof held === 'string' && held.toLowerCase().startsWith(value.toLowerCase()) ? value : (typeof held === 'string' ? held : undefined);
      return typeof held === 'number' || typeof held === 'string' ? held : undefined;
    };
    const closingFig = closing?.date ? closingFigure({ date: closing.date, weeks: closing.weeks }) : null;
    return buildIntakeRecord({
      documents: intake?.documents ?? [],
      documentFigures: (intake?.figures ?? []).map((f) => ({ ...f, current: current(f.key, f.value) })),
      profileFigures: [...profileFigures, ...(closingFig ? [closingFig] : [])],
      claims: intake?.claims ?? [], notes: [], checks: intake?.checks, lineage: intake?.lineage, choices: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intake, profileFigures, closing, deal.inputs]);
  const rows: WorksheetRow[] = useMemo(
    () => buildWorksheet({ inputs: formInputs, receipts: receiptsFor(preview), contracts, resolved, needed: neededAll, ownerReasons }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, contracts, resolved, neededAll, ownerReasons],
  );
  const outcome = useMemo(() => {
    if (neededAll.length > 0) return null;
    try {
      const m = tryComputeDealMetrics({ asset_class: deal.asset_class, purchase_price: deal.purchase_price, inputs: deal.inputs } as never);
      return m ? { noi: m.noi, capRate: m.capRate, dscr: m.dscr } : null;
    } catch { return null; }
  }, [deal, neededAll.length]);
  const claimOf = (re: RegExp): number | null => intake?.claims.find((c) => re.test(c.how))?.value ?? null;
  const readiness = assess({
    rows, engineMissing: neededAll, outcome, claims: { noi: claimOf(/NOI claimed/i), managementCost: claimOf(/management cost/i) },
    selfManaged: formInputs.manageProperty !== true, checks: intake?.checks, exitCap: Number(formInputs.targetCapRate) || null, acknowledged,
  });
  const readinessKey = `${rows.map((r) => `${r.key}:${r.state}`).join(',')}|${readiness.verdict}|${readiness.unacknowledged.length}|${readiness.blockers.length}`;
  useEffect(() => { onWorksheet?.(rows, readiness); }, [readinessKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A short name for where a figure was read, for the button that offers it. */
  const sourceWord = (how: string): string =>
    /unit mix/i.test(how) ? 'unit mix' : /income table|income and expense/i.test(how) ? 'income table' : /operating statement/i.test(how) ? 'operating statement' : /rent roll/i.test(how) ? 'rent roll' : /lease/i.test(how) ? 'lease' : 'document';
  const pill = 'px-2.5 py-1.5 rounded-lg border text-left text-[11px] bg-slate-900 border-slate-700 hover:border-emerald-500/60 text-slate-100 transition';

  /** The question for one figure, as short as it can be: the choices side by side, answered with one press. */
  const questionCard = ({ change: c, kind }: Question) => {
    // Several figures for the same thing (the rent in the unit mix and in the income table): pick one
    if (kind === 'unsure' && c.alternatives && c.alternatives.length > 0) {
      const options = [{ value: Number(c.value), text: c.proposed, how: c.how }, ...c.alternatives];
      return (
        <div key={c.key} className="space-y-1.5">
          <p className="text-xs font-bold text-slate-100">Which {c.label.toLowerCase()}?</p>
          <div className="flex flex-wrap gap-2">
            {options.map((o, k) => (
              <button key={k} type="button" onClick={() => settleUnsure(c, true, k === 0 ? undefined : { value: o.value, text: o.text })} className={pill}>
                <span className="block font-bold text-emerald-300">{o.text.replace(/ \(.*$/, '')}</span>
                <span className="block text-slate-500">{sourceWord(o.how)}</span>
              </button>
            ))}
            <button type="button" onClick={() => settleUnsure(c, false)} className={pill}>My own</button>
          </div>
        </div>
      );
    }
    // The reader was not sure of one figure
    if (kind === 'unsure') {
      return (
        <div key={c.key} className="space-y-1.5">
          <p className="text-xs text-slate-200">Read as <span className="font-bold text-emerald-300">{c.proposed}</span>, not sure.{c.evidence ? <span className="text-slate-500"> “{c.evidence}”</span> : null}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => settleUnsure(c, true)} className={pill}>Use it</button>
            <button type="button" onClick={() => settleUnsure(c, false)} className={pill}>My own</button>
          </div>
        </div>
      );
    }
    // The document and your own standard differ by more than 5%: the three figures side by side
    if (kind === 'variance' && c.variance) {
      const which = picked[c.key] ?? defaultPick(c, kind);
      const choice = (id: string, label: string, text: string) => (
        <label key={id} className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name={`q-${c.key}`} checked={which === id} onChange={() => choose(c, id)} />
          <span className="text-slate-400">{label}</span> <span className="font-bold text-slate-100">{text}</span>
        </label>
      );
      return (
        <div key={c.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
          {choice('doc', 'Document', docText(c))}
          {changedInForm(c) && choice('keep', 'Mine', assumptionText(c.key, inForm(c) as number))}
          {choice('mine', 'Your standard', mineText(c))}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`q-${c.key}`} checked={which === 'own'} onChange={() => choose(c, 'own')} />
            <span className="text-slate-400">Own</span>
            <input type="number" min="0" step="any" aria-label={`Your own ${c.label}`} value={typed[c.key] ?? ''} className="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100"
              onChange={(e) => { const v = e.target.value; setTyped((t) => ({ ...t, [c.key]: v })); choose(c, 'own'); }}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(c, kind); }} />
          </label>
          <button type="button" onClick={() => confirm(c, kind)} disabled={which === 'own' && !(typed[c.key] ?? '').trim()} className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold disabled:opacity-40">Use</button>
        </div>
      );
    }
    // The document says something different from what you entered
    return (
      <div key={c.key} className="space-y-1.5">
        <p className="text-xs text-slate-200">You entered <span className="font-bold">{c.current}</span>; the document says <span className="font-bold text-emerald-300">{c.proposed}</span>.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => confirm(c, kind, 'keep')} className={pill}>Keep mine</button>
          <button type="button" onClick={() => confirm(c, kind, 'doc')} className={pill}>Use the document's</button>
        </div>
      </div>
    );
  };
  const missingCard = (m: { key: string; label: string; why: string }) => {
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
  };
  // Nothing is shown as owed until a reading has finished: first the facts from the documents, then what is left
  const engaged = (done && !busy) || !!reveal;
  const rowKeys = new Set(ROW_SPECS.map((s) => s.key));
  const leftQuestions = questions.filter((q) => !rowKeys.has(q.change.key));
  const leftMissing = [...Object.keys(provided).map((key) => ({ key, label: provided[key].label, why: '' })), ...neededAll.filter((m) => !provided[m.key])].filter((m) => !rowKeys.has(m.key));
  const focusField = (field: string) => {
    const el = document.querySelector(`[data-field="${field}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus?.();
  };
  const ownFigure = (r: WorksheetRow, value: string, reason: string) => {
    onSet(r.key, value);
    setOwnerReasons((p) => ({ ...p, [r.key]: reason }));
    onReason?.(r.key, reason);
    const said = `${value}${PERCENT_ROWS.has(r.key) ? '%' : ''} (your own figure: ${reason})`;
    setResolved((p) => ({ ...p, [r.key]: said }));
    onAnswered(r.key, r.label, said);
  };


  const panel = (
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
          <button type="button" onClick={() => setDetails((d) => !d)} className="text-[11px] font-bold text-slate-400 hover:text-white">{details ? 'Hide' : 'Show'} what was read from the documents (pages and quotes)</button>
          {details && (
            <div className="mt-2 space-y-4">
              {intake && (
                <section className="space-y-2">
                  <h5 className="text-[11px] uppercase tracking-wider font-black text-sky-300">What was read from your documents ({intake.figures.length})</h5>
                  <p className="text-[11px] text-slate-500">
                    Read from {intake.documents.length > 0 ? intake.documents.map((d) => d.name).join(', ') : 'the documents you added'}.
                    {result ? ` Hidden from the reader: ${sum('names')} names, ${sum('phones')} phone numbers, ${sum('emails')} emails.` : ' The documents themselves are not kept: add them again to read them again.'}
                  </p>
                  {reads.flatMap((r) => r.issues).map((i, n) => <p key={n} className={`text-[11px] ${i.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>{i.severity === 'error' ? 'Check: ' : 'Note: '}{i.message}</p>)}
                  <ul className="space-y-1">
                    {intake.figures.map((f) => (
                      <li key={f.key} className="text-[11px] text-slate-300"><span className="font-bold text-slate-100">{f.label}:</span> <span className="text-emerald-400">{f.text}</span> <span className="text-slate-500 italic">({f.reliability}) {f.how}</span>{(() => { const r = receipts.find((x) => x.key === f.key); return r ? <span className={`block pl-3 ${r.traced ? 'text-sky-300/80' : 'text-amber-300'}`}>Source: {receiptText(r)}</span> : null; })()}</li>
                    ))}
                  </ul>
                  {result && result.proposal.unchanged.length > 0 && <p className="text-[11px] text-slate-500">Already in the form and matching: {result.proposal.unchanged.map((u) => `${u.label} (${u.value})`).join(', ')}.</p>}
                  <DocumentLineage rows={intake.lineage} />
                  {(intake.checks ?? []).length > 0 && (
                    <div><p className="text-[11px] font-black text-slate-300">Checks on the document's own arithmetic</p>
                      <ul className="text-[11px]">{(intake.checks ?? []).map((c, k) => <li key={k} className={c.ok ? 'text-emerald-300' : 'text-amber-300'}>{c.ok ? '✓' : '⚠'} <span className="font-bold">{c.label}.</span> <span className="text-slate-400">{c.detail}</span></li>)}</ul></div>
                  )}
                  {intake.claims.length > 0 && (
                    <div><p className="text-[11px] font-black text-slate-300">Claims in the documents (shown for comparison, never applied)</p>
                      <ul className="text-[11px] text-slate-400">{intake.claims.map((c, k) => <li key={k}>{c.how}: {c.value.toLocaleString('en-US')}</li>)}</ul></div>
                  )}
                  {(result ? liveNotes : intake.notes).length > 0 && <ul className="text-[11px] text-slate-400 list-disc pl-4">{(result ? liveNotes : intake.notes).map((n, i) => <li key={i}>{n}</li>)}</ul>}
                </section>
              )}

            </div>
          )}
        </div>
      )}
      {!engaged ? <p className="text-[11px] text-slate-500">{busy ? 'Reading the documents…' : 'Add your documents and press Fill, or fill in the form yourself. What still needs an answer shows up after that.'}</p> : (
      <ReadinessBanner
        readiness={readiness}
        onNext={() => { const k = readiness.blockers[0]?.rowKey; const spec = ROW_SPECS.find((x) => x.key === k); const field = spec?.field ?? (k ? FORM_FIELD_FOR_KEY[k] : undefined); if (field) focusField(field); }}
        acknowledged={acknowledged}
        onAcknowledge={(id, on) => setAcknowledged((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; })}
      />)}
      {engaged && (leftQuestions.length > 0 || leftMissing.length > 0) && (
        <div className="space-y-2 pt-1">
          <h5 className="text-[10px] uppercase tracking-wider font-black text-slate-500">Also asked</h5>
          {leftQuestions.map(questionCard)}
          {leftMissing.map((m) => <React.Fragment key={m.key}>{missingCard(m)}</React.Fragment>)}
        </div>
      )}
    </div>
  );

  /** What goes under a field of the form: where its figure came from and, when something is owed, the question to settle it. */
  const noteFor = (key: string, named = false): React.ReactNode => {
    const r = rows.find((x) => x.key === key);
    if (!r || !engaged) return null;
    const q = questions.find((x) => x.change.key === key);
    return (
      <RowNote
        row={r} named={named} question={q && r.state !== 'unsupported' ? questionCard(q) : null}
        onDecide={(d, o) => { const c = contracts.find((x) => x.key === d.key); if (c) settleLine(c, o); }}
        onOwnFigure={ownFigure}
      />
    );
  };

  return <WorksheetContext.Provider value={{ panel, noteFor }}>{children}</WorksheetContext.Provider>;
};

interface WorksheetCtx { panel: React.ReactNode; noteFor: (rowKey: string, named?: boolean) => React.ReactNode }
const WorksheetContext = createContext<WorksheetCtx>({ panel: null, noteFor: () => null });

/** The documents, the fill button and the check before confirming: one panel at the top of the form. */
export const WizardDocuments: React.FC = () => <>{useContext(WorksheetContext).panel}</>;

/** What sits under a field: its source and, when something is owed, its question. The field is where the owner settles it. */
export const FieldNote: React.FC<{ k: string }> = ({ k }) => <>{useContext(WorksheetContext).noteFor(k)}</>;

/** The notes of several fields that share a row of the form, stacked full width under it, each named. */
export const FieldNotes: React.FC<{ keys: string[] }> = ({ keys }) => {
  const { noteFor } = useContext(WorksheetContext);
  return <div className="flex flex-wrap gap-x-5 gap-y-1.5">{keys.map((k) => <React.Fragment key={k}>{noteFor(k, true)}</React.Fragment>)}</div>;
};
