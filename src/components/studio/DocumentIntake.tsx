import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentType, IntakeDocument } from '../../lib/ingestion/intake';
import { DOCUMENT_PROFILES, DOCUMENT_TYPES } from '../../lib/ingestion/documentTypes';
import { validateIntake, type IntakeIssue } from '../../lib/ingestion/validate';
import { applyChoices, attachVariances, proposeChanges, type Choice, type Expected, type Proposal } from '../../lib/ingestion/apply';
import { missingInputsFor, resolveProfileAssumptions } from '../../lib/engine/compute';
import { FORM_FIELD_FOR_KEY } from '../../lib/ingestion/wizardMap';
import { getAssumptionDefaults, useAssumptionVersion } from '../../lib/engine/assumptionDefaults';
import { managerChoice } from '@engine/underwritingAssumptions';
import { readDocument, type ParsedDocument } from '../../lib/ingestion/client';
import { extractFileText, isReadableFile, READABLE_EXTENSIONS } from '../../lib/ingestion/extractText';

/** What the owner accepted. The caller decides what to do with it: save it to a deal, or fill a form. */
export interface IntakeAcceptance {
  proposal: Proposal;
  ticked: Set<string>;
  docs: IntakeDocument[];
}

interface Props {
  /** What the property states now, so each change shows what it replaces. A new project passes what its form holds so far. */
  deal: { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null };
  /** Names already known (the deal's tenants), hidden from the reader wherever they appear. */
  knownNames?: string[];
  applyLabel: (count: number) => string;
  onApply: (a: IntakeAcceptance) => Promise<boolean>;
  onCancel?: () => void;
  /** A new project has no asset class yet: also propose the one the documents point to. */
  proposeAssetClass?: boolean;
  /** One line shown after a successful apply, for callers that stay on screen. */
  appliedNote?: string | null;
  /** A caller that keeps a form on screen can take what the owner types for something the documents did not give (input key and value). */
  onProvide?: (key: string, value: string) => void;
  /** Fills what is still blank from the owner's own assumptions. */
  onFillAssumptions?: () => void;
  /** The original files the owner added and what each was read as, so the caller can keep them with the property. Called when the documents are read. */
  onFiles?: (files: Array<{ file: File; type?: string }>) => void;
}

interface Source {
  id: number;
  name: string;
  text: string;
  type: 'auto' | Exclude<DocumentType, 'unknown'>;
  /** The original file (absent for pasted text). */
  file?: File;
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

/** The owner's choice about a property manager for this property: its own setting if it has one, else their investor profile's for the asset class. */
function managerForDeal(deal: Props['deal']): { uses: boolean | null; fee?: number } {
  const own = (deal.inputs ?? {}) as Record<string, any>;
  if (typeof own.manageProperty === 'boolean') return { uses: own.manageProperty, fee: Number(own.managementFeePercent) || undefined };
  return managerChoice(getAssumptionDefaults().assumptions, deal.asset_class);
}

/** Add documents, read them, see what they say against what the property states, and tick what to accept. Saves nothing itself. */
export const DocumentIntake: React.FC<Props> = ({ deal, knownNames = [], applyLabel, onApply, onCancel, appliedNote, proposeAssetClass, onProvide, onFillAssumptions, onFiles }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [pasted, setPasted] = useState('');
  const [reads, setReads] = useState<Read[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  // For a flagged figure, what the owner picked instead of the document's: their own assumption, or a number typed for this property
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<Record<string, string>>({});
  const nextId = useRef(1);
  const assumptionVersion = useAssumptionVersion();

  const docs = useMemo<IntakeDocument[]>(() => (reads ?? []).flatMap((r) => (r.parsed && r.parsed.intake.documentType !== 'unknown' ? [r.parsed.intake] : [])), [reads]);
  const proposal = useMemo(() => (docs.length > 0 ? proposeChanges(docs, deal, { assetClass: proposeAssetClass, manager: managerForDeal(deal) }) : null), [docs, deal, proposeAssetClass]);
  // What the owner's profile would use for this property, to compare the document's figures with: the size, price and lease structure come
  // from the documents where the form has none yet, and none of the assumption figures themselves are passed in
  const expected = useMemo<Expected | null>(() => {
    if (!proposal) return null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, deal, assumptionVersion]);
  useMemo(() => { if (proposal && expected) attachVariances(proposal, expected); }, [proposal, expected]);
  const hardErrors = (reads ?? []).some((r) => r.issues.some((i) => i.severity === 'error'));

  // Everything starts ticked except what would replace a figure the owner already states: that is their call
  const proposalKey = proposal?.changes.map((c) => c.key).join('|') ?? '';
  useEffect(() => {
    setTicked(new Set((proposal?.changes ?? []).filter((c) => !c.replaces && !c.unsure).map((c) => c.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalKey]);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Source[] = [];
    const rejected: string[] = [];
    const problems: string[] = [];
    setBusy(true);
    for (const f of Array.from(files)) {
      if (!isReadableFile(f.name)) { rejected.push(f.name); continue; }
      try {
        added.push({ id: nextId.current++, name: f.name, text: await extractFileText(f), type: 'auto', file: f });
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : 'could not be opened.'}`);
      }
    }
    setBusy(false);
    setSources((s) => [...s, ...added]);
    setReads(null);
    setApplied(false);
    const notes = [...problems, ...(rejected.length ? [`${rejected.join(', ')} can't be read. Use ${READABLE_EXTENSIONS.join(', ')} files, or paste the text.`] : [])];
    setNote(notes.length ? notes.join(' ') : null);
  };

  const addPasted = () => {
    if (pasted.trim().length < 20) return;
    setSources((s) => [...s, { id: nextId.current++, name: 'Pasted text', text: pasted, type: 'auto' }]);
    setPasted('');
    setReads(null);
    setApplied(false);
  };

  const readAll = async () => {
    setBusy(true);
    setNote(null);
    setApplied(false);
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
    onFiles?.(out.flatMap((r) => (r.source.file ? [{ file: r.source.file, type: r.parsed && r.parsed.documentType !== 'unknown' ? r.parsed.documentType : undefined }] : [])));
    setBusy(false);
  };

  const apply = async () => {
    if (!proposal) return;
    setBusy(true);
    const ok = await onApply({ proposal: expected ? applyChoices(proposal, choices, expected) : proposal, ticked, docs });
    setBusy(false);
    if (ok) setApplied(true);
    else setNote('Could not apply that. Try again.');
  };

  const toggle = (key: string) => setTicked((t) => { const n = new Set(t); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="space-y-4">
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
              <select aria-label={`Type of ${s.name}`} value={s.type} onChange={(e) => { setSources((all) => all.map((x) => (x.id === s.id ? { ...x, type: e.target.value as Source['type'] } : x))); setReads(null); }} className={sel}>
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

      {proposal && (
        <section className="space-y-2">
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-black text-slate-300">What the documents say ({proposal.changes.length})</h3>
            <p className="text-[11px] text-slate-500">Tick what you want applied. Figures that would replace one you already entered start unticked. Each applied figure keeps the document it came from.</p>
          </div>
          {proposal.changes.length === 0 ? <p className="text-[11px] text-slate-500 italic">These documents don't change anything already stated.</p> : (
            <ul className="space-y-1.5">
              {proposal.changes.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <input type="checkbox" id={`chg-${c.key}`} checked={ticked.has(c.key)} onChange={() => toggle(c.key)} className="mt-0.5" />
                  <label htmlFor={`chg-${c.key}`} className="flex-1 cursor-pointer">
                    <span className="text-xs font-bold text-slate-100 block">{c.label}</span>
                    <span className="text-sm font-black text-emerald-400">{c.proposed}</span>
                    {c.current !== null && <span className="text-[11px] text-slate-400"> (now {c.current})</span>}
                    {c.unsure && <span className="block mt-1 text-[11px] text-amber-300">The reader was not sure of this figure ({Math.round((c.confidence ?? 0) * 100)}%){c.evidence ? `: "${c.evidence}"` : ''}. Check the document before you tick it.</span>}
                    {c.variance && (
                      <span className="block mt-1 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200" onClick={(e) => e.preventDefault()}>
                        <span className="font-bold block">Differs from your assumption: yours is {c.variance.expectedText}, this document is {c.variance.percent}% {c.variance.higher ? 'higher' : 'lower'}.</span>
                        {c.variance.why && <span className="block text-amber-200/80 italic">Your reason: {c.variance.why}</span>}
                        <span className="flex flex-wrap gap-3 mt-1.5">
                          <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`pick-${c.key}`} checked={!choices[c.key]} onChange={() => setChoices((s) => { const n = { ...s }; delete n[c.key]; return n; })} />Use the document's ({c.proposed})</label>
                          <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name={`pick-${c.key}`} checked={choices[c.key]?.use === 'mine'} onChange={() => setChoices((s) => ({ ...s, [c.key]: { use: 'mine' } }))} />Use my assumption ({c.variance.expectedText})</label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name={`pick-${c.key}`} checked={choices[c.key]?.use === 'custom'} onChange={() => setChoices((s) => ({ ...s, [c.key]: { use: 'custom', value: Number(typed[c.key]) } }))} />
                            Use my own number
                            <input type="number" min="0" step="any" aria-label={`Your own ${c.label}`} value={typed[c.key] ?? ''} placeholder="enter" className="w-20 bg-slate-950 border border-amber-500/30 rounded px-1.5 py-0.5 text-amber-100"
                              onChange={(e) => { const v = e.target.value; setTyped((t) => ({ ...t, [c.key]: v })); setChoices((s) => ({ ...s, [c.key]: { use: 'custom', value: Number(v) } })); }} />
                          </label>
                        </span>
                      </span>
                    )}
                    <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${RELIABILITY_STYLE[c.reliability]}`}>{c.reliability}</span>
                      <span className="text-[10.5px] text-slate-500 italic">{c.how}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {proposal.unchanged.length > 0 && (
            <p className="text-[11px] text-slate-500">Already filled in and matching the documents: {proposal.unchanged.map((u) => `${u.label} (${u.value})`).join(", ")}.</p>
          )}
          {Object.keys(proposal.patch.claims).length > 0 && (
            <div>
              <h4 className="text-[11px] font-black text-slate-300">Claims in the documents (shown for comparison, never applied)</h4>
              <ul className="text-[11px] text-slate-400">{Object.entries(proposal.patch.claims).map(([k, c]) => <li key={k}>{c.how}: {c.value.toLocaleString('en-US')}</li>)}</ul>
            </div>
          )}
          {proposal.patch.notes.length > 0 && <ul className="text-[11px] text-slate-400 list-disc pl-4">{proposal.patch.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {hardErrors && <p className="text-[11px] text-rose-300">A document failed a consistency check above. Review the figures before applying.</p>}
          {applied && appliedNote && <p role="status" className="text-[11px] text-emerald-300">{appliedNote}</p>}
          {applied && onProvide && <StillNeeded deal={deal} asked={asked} setAsked={setAsked} onProvide={onProvide} onFillAssumptions={onFillAssumptions} />}
          <div className="flex justify-end gap-2 pt-1">
            {onCancel && <button type="button" onClick={onCancel} className={`${btn} text-slate-300 hover:text-white`}>Cancel</button>}
            <button type="button" onClick={apply} disabled={busy || ticked.size === 0} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}>
              {busy ? 'Applying…' : applyLabel(ticked.size)}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

/**
 * What the property still needs after the documents were applied, once the owner's own assumptions are taken into account: the facts only
 * the property can state (the loan's rate and amortization, the price). Each can be typed right here and goes into the form.
 */
const StillNeeded: React.FC<{
  deal: Props['deal'];
  asked: Record<string, string>;
  setAsked: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onProvide: (key: string, value: string) => void;
  onFillAssumptions?: () => void;
}> = ({ deal, asked, setAsked, onProvide, onFillAssumptions }) => {
  const missing = useMemo(() => {
    try { return missingInputsFor({ asset_class: deal.asset_class ?? undefined, purchase_price: deal.purchase_price ?? undefined, inputs: deal.inputs ?? {} } as any); } catch { return []; }
  }, [deal]);
  if (missing.length === 0) return <p className="text-[11px] text-emerald-300">Nothing else is needed to underwrite this property.</p>;
  const facts = missing.filter((m) => m.kind === 'fact');
  const assumptions = missing.filter((m) => m.kind === 'assumption');
  const row = (m: (typeof missing)[number]) => {
    const settable = Boolean(FORM_FIELD_FOR_KEY[m.key]);
    return (
      <li key={m.key} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
        <span className="text-xs font-bold text-slate-100 block">{m.label}</span>
        <span className="text-[11px] text-slate-400 block">{m.why}</span>
        {settable && (
          <span className="flex items-center gap-2 mt-1.5">
            <input type={m.key === 'closingDate' ? 'date' : 'number'} step="any" aria-label={m.label} value={asked[m.key] ?? ''} onChange={(e) => setAsked((a) => ({ ...a, [m.key]: e.target.value }))}
              className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white" />
            <button type="button" disabled={!(asked[m.key] ?? '').trim()} onClick={() => { onProvide(m.key, asked[m.key]); setAsked((a) => { const n = { ...a }; delete n[m.key]; return n; }); }}
              className="px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-40">Add</button>
          </span>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
      <h4 className="text-[11px] uppercase tracking-wider font-black text-amber-200">Still needed ({missing.length})</h4>
      <p className="text-[11px] text-slate-400">The documents did not give these. Type them here, or enter them in the next steps.</p>
      {facts.length > 0 && <ul className="space-y-1.5">{facts.map(row)}</ul>}
      {assumptions.length > 0 && (
        <>
          <p className="text-[11px] text-slate-400">These are assumptions, not facts about the property. {onFillAssumptions ? 'Your investor profile can fill them.' : ''}</p>
          <ul className="space-y-1.5">{assumptions.map(row)}</ul>
          {onFillAssumptions && <button type="button" onClick={onFillAssumptions} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">Fill these from my assumptions</button>}
        </>
      )}
    </div>
  );
};
